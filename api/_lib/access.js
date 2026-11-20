// Turn a Stripe customer's subscriptions into access in Clerk. Stripe is the record of what was
// paid for; this rewrites the owner's "tools" and "until" (public metadata, which the explorers
// read through the session token) every time a payment or subscription changes.
const { getStripe, getClerk } = require('./clients');
const { PLANS, planOfSub, covers } = require('./plans');

const LIVE = new Set(['active', 'trialing', 'past_due']);
const GRACE_DAYS = 3;   // covers webhook timing and a renewal that is still processing

// Tools come from the plan the subscription is on now (it changes on an upgrade), falling back to
// the tools recorded at checkout.
const toolsOf = sub => {
  const key = planOfSub(sub);
  if (key) return PLANS[key].tools;
  return String((sub.metadata && sub.metadata.tools) || '').split(',').map(t => t.trim()).filter(Boolean);
};
const endOf = sub => Math.max(0, ...((sub.items && sub.items.data) || []).map(i => i.current_period_end || 0), sub.current_period_end || 0);

// After an upgrade, a plan the customer still has may be fully included in the new one (for example
// a separate Hospital plan after moving to all three). End it now, with credit for the unused time.
async function endCoveredPlans(customerId) {
  const s = getStripe();
  const live = (await s.subscriptions.list({ customer: customerId, status: 'active', limit: 100 })).data;
  for (const sub of live) {
    const mine = planOfSub(sub);
    const bigger = live.find(o => o.id !== sub.id && planOfSub(o) && mine && planOfSub(o) !== mine && covers(planOfSub(o), mine));
    if (bigger) await s.subscriptions.cancel(sub.id, { prorate: true, invoice_now: true });
  }
}

async function accessFor(customerId) {
  const s = getStripe();
  const subs = await s.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
  const tools = new Set(); let end = 0;
  for (const sub of subs.data) {
    if (!LIVE.has(sub.status)) continue;
    toolsOf(sub).forEach(t => tools.add(t));
    end = Math.max(end, endOf(sub));
  }
  if (!tools.size || !end) return { tools: [], until: null };
  const until = new Date((end + GRACE_DAYS * 86400) * 1000).toISOString().slice(0, 10);
  return { tools: [...tools].sort(), until };
}

async function syncCustomer(customerId) {
  const s = getStripe(); const clerk = getClerk();
  const customer = await s.customers.retrieve(customerId);
  if (!customer || customer.deleted) return { skipped: 'no customer' };
  const { owner_type: type, owner_id: id } = customer.metadata || {};
  if (!id || (type !== 'user' && type !== 'org')) return { skipped: 'owner not set yet' };
  await endCoveredPlans(customerId);
  const access = await accessFor(customerId);
  if (type === 'user') {
    const user = await clerk.users.getUser(id);
    if (user.publicMetadata && user.publicMetadata.comp) return { skipped: 'complimentary access' };
    await clerk.users.updateUserMetadata(id, { publicMetadata: access });
  } else {
    const org = await clerk.organizations.getOrganization({ organizationId: id });
    if (org.publicMetadata && org.publicMetadata.comp) return { skipped: 'complimentary access' };
    await clerk.organizations.updateOrganizationMetadata(id, { publicMetadata: access });
  }
  return { owner: `${type}:${id}`, ...access };
}

module.exports = { syncCustomer, accessFor };
