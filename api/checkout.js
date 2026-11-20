// Start a Stripe Checkout for a plan. Body: { tool: 'ma'|'hospital'|'physician'|'all', seats: 1|5 }.
// The buyer must be signed in (Clerk session token in the Authorization header).
const { enabled, getStripe, getClerk, siteUrl, sessionOf, ensureCatalog, ensurePortal, send } = require('./_lib/clients');
const { PLANS, planKey, planOfSub, covers, BETA_COUPON, isWorkEmail } = require('./_lib/plans');
const { betaStatus } = require('./_lib/beta');

const adminOf = claims => {
  const o = claims.o || {};
  const org = o.id || claims.org_id; const role = o.rol || claims.org_role || '';
  return org && /admin/.test(role) ? org : null;
};

// What a person's current 1-user plans are worth toward a team plan that includes them.
async function creditForTeam(s, customer, teamKey) {
  const team = PLANS[teamKey];
  const now = Math.floor(Date.now() / 1000);
  const live = (await s.subscriptions.list({ customer, status: 'active', limit: 100 })).data;
  let cents = 0; let beta = false; const replaces = [];
  for (const sub of live) {
    const key = planOfSub(sub);
    if (!key || PLANS[key].seats !== 1 || !PLANS[key].tools.every(t => team.tools.includes(t))) continue;
    const item = sub.items.data[0];
    const start = item.current_period_start; const end = item.current_period_end;
    // Everything paid toward the current year (the first invoice plus any upgrade charges).
    const invoices = await s.invoices.list({ subscription: sub.id, status: 'paid', created: { gte: start - 3600 }, limit: 20 });
    const paid = invoices.data.reduce((t, inv) => t + (inv.amount_paid || 0), 0);
    if (end > now && end > start) cents += Math.floor(paid * (end - now) / (end - start));
    if ((sub.metadata || {}).beta === 'auto' && start - sub.start_date < 86400) beta = true;
    replaces.push(sub.id);
  }
  if (!replaces.length) return null;
  const off = Math.min(team.amount, cents + (beta ? Math.round(team.amount / 2) : 0));
  if (off <= 0) return { replaces, beta, coupon: null };
  const label = beta ? 'Plan credit plus beta discount' : 'Credit for your current plan';
  const coupon = await s.coupons.create({ amount_off: off, currency: 'usd', duration: 'once', max_redemptions: 1, redeem_by: now + 86400, name: label, metadata: { replaces: replaces.join(',') } });
  return { replaces, beta, coupon: coupon.id };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Use POST.' }); }
  if (!enabled()) return send(res, 503, { error: 'Checkout is not open yet.' });
  const claims = await sessionOf(req);
  if (!claims) return send(res, 401, { error: 'Please sign in first.' });
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const tool = ['ma', 'hospital', 'physician', 'all'].includes(b.tool) ? b.tool : null;
  if (!tool) return send(res, 400, { error: 'Choose an explorer or the all-three plan.' });
  const key = planKey(tool, b.seats); const plan = PLANS[key];

  try {
    const s = getStripe(); const clerk = getClerk();
    const prices = await ensureCatalog();
    const user = await clerk.users.getUser(claims.sub);
    const email = (user.emailAddresses.find(e => e.id === user.primaryEmailAddressId) || user.emailAddresses[0] || {}).emailAddress;

    if (plan.seats > 1 && !isWorkEmail(email)) {
      return send(res, 400, { error: 'Team plans are for organizations. Please sign in with your work email address, or contact us if your team uses personal email.' });
    }

    // Who will own the plan: the person, an existing team they run, or a new team made after payment.
    let ownerType = 'user'; let ownerId = user.id; let customer = (user.privateMetadata || {}).stripe_customer || null;
    if (plan.seats > 1) {
      const org = adminOf(claims);
      if (org) {
        ownerType = 'org'; ownerId = org;
        customer = ((await clerk.organizations.getOrganization({ organizationId: org })).privateMetadata || {}).stripe_customer || null;
      } else { ownerType = 'pending_org'; ownerId = ''; customer = null; }
    }
    if (customer) {
      const live = (await s.subscriptions.list({ customer, status: 'active', limit: 100 })).data.filter(planOfSub);
      if (live.some(sub => covers(planOfSub(sub), key))) {
        return send(res, 409, { error: 'Your plan already includes this. You can manage it from your account page.' });
      }
      // Upgrade: move an existing plan of the same team size to this one, charging only the difference
      // for the rest of the year (Stripe shows the amount and asks to confirm). Plans this one fully
      // includes are ended with credit once the upgrade goes through (see endCoveredPlans).
      const from = live.find(sub => covers(key, planOfSub(sub)));
      if (from) {
        const item = from.items.data[0];
        const firstYear = !item.current_period_start || !from.start_date || item.current_period_start - from.start_date < 86400;
        const beta = (from.metadata || {}).beta === 'auto' && firstYear;      // the beta 50% covers the first year, upgrades included
        const site = siteUrl(req);
        const configuration = await ensurePortal(`${site}/account`, plan.seats === 5 ? 'upgrade5' : 'upgrade1');
        const portal = await s.billingPortal.sessions.create({
          customer, configuration, return_url: `${site}/account`,
          flow_data: {
            type: 'subscription_update_confirm',
            subscription_update_confirm: {
              subscription: from.id,
              items: [{ id: item.id, price: prices[key], quantity: 1 }],
              ...(beta ? { discounts: [{ coupon: BETA_COUPON }] } : {}),
            },
            after_completion: { type: 'redirect', redirect: { return_url: `${site}/welcome?upgraded=1` } },
          },
        });
        return send(res, 200, { url: portal.url, upgrade: true });
      }
    }
    if (!customer && ownerType === 'user') {
      const c = await s.customers.create({ email, name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined, metadata: { owner_type: 'user', owner_id: user.id } });
      customer = c.id;
      await clerk.users.updateUserMetadata(user.id, { privateMetadata: { stripe_customer: customer } });
    }

    const beta = await betaStatus(email);

    // Moving from a 1-user plan to a team: credit the unused part of the personal plan at checkout,
    // keep the beta 50% for the rest of the first year, and end the personal plan once the team plan
    // starts (see the webhook). One single-use coupon carries both.
    let teamCredit = null;
    const personal = (user.privateMetadata || {}).stripe_customer;
    if (plan.seats > 1 && personal) teamCredit = await creditForTeam(s, personal, key);
    const meta = { plan: key, tools: plan.tools.join(','), seats: String(plan.seats), owner_type: ownerType, owner_id: ownerId, buyer: user.id, beta: beta.apply || (teamCredit && teamCredit.beta) ? 'auto' : '', replaces: teamCredit ? teamCredit.replaces.join(',') : '' };
    const site = siteUrl(req);
    const params = {
      mode: 'subscription',
      line_items: [{ price: prices[key], quantity: 1 }],
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      automatic_tax: { enabled: process.env.STRIPE_TAX === 'on' },
      subscription_data: { metadata: meta },
      metadata: meta,
      client_reference_id: user.id,
      success_url: `${site}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/pricing?tool=${tool}#plans`,
    };
    if (teamCredit && teamCredit.coupon) params.discounts = [{ coupon: teamCredit.coupon }];
    else if (beta.apply) params.discounts = [{ coupon: BETA_COUPON }];   // earned by sending feedback
    else params.allow_promotion_codes = true;                         // personal codes for exceptions
    if (customer) { params.customer = customer; params.customer_update = { address: 'auto', name: 'auto' }; }
    else params.customer_email = email;
    if (ownerType === 'pending_org') {
      params.custom_fields = [{ key: 'team_name', type: 'text', label: { type: 'custom', custom: 'Team or organization name' }, text: { maximum_length: 80 } }];
    }
    const session = await s.checkout.sessions.create(params);
    return send(res, 200, { url: session.url });
  } catch (e) {
    console.error('checkout', e && e.message);
    return send(res, 502, { error: 'Checkout could not start. Please try again, or email andrew@trynytyhealth.com.' });
  }
};
