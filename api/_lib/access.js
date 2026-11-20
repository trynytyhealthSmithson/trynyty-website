// Turn a Stripe customer's subscriptions into access in Clerk. Stripe is the record of what was
// paid for; this rewrites the owner's "tools" and "until" (public metadata, which the explorers
// read through the session token) every time a payment or subscription changes.
const { getStripe, getClerk } = require('./clients');

const LIVE = new Set(['active', 'trialing', 'past_due']);
const GRACE_DAYS = 3;   // covers webhook timing and a renewal that is still processing

const toolsOf = sub => String((sub.metadata && sub.metadata.tools) || '').split(',').map(s => s.trim()).filter(Boolean);
const endOf = sub => Math.max(0, ...((sub.items && sub.items.data) || []).map(i => i.current_period_end || 0), sub.current_period_end || 0);

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
