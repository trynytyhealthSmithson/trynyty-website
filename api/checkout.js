// Start a Stripe Checkout for a plan. Body: { tool: 'ma'|'hospital'|'physician'|'all', seats: 1|5 }.
// The buyer must be signed in (Clerk session token in the Authorization header).
const { enabled, getStripe, getClerk, siteUrl, sessionOf, ensureCatalog, send } = require('./_lib/clients');
const { PLANS, planKey, BETA_COUPON } = require('./_lib/plans');
const { betaStatus } = require('./_lib/beta');

const adminOf = claims => {
  const o = claims.o || {};
  const org = o.id || claims.org_id; const role = o.rol || claims.org_role || '';
  return org && /admin/.test(role) ? org : null;
};

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
      const live = await s.subscriptions.list({ customer, status: 'active', price: prices[key], limit: 1 });
      if (live.data.length) return send(res, 409, { error: 'You already have this plan. You can manage it from your account page.' });
    }
    if (!customer && ownerType === 'user') {
      const c = await s.customers.create({ email, name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined, metadata: { owner_type: 'user', owner_id: user.id } });
      customer = c.id;
      await clerk.users.updateUserMetadata(user.id, { privateMetadata: { stripe_customer: customer } });
    }

    const beta = await betaStatus(email);
    const meta = { plan: key, tools: plan.tools.join(','), seats: String(plan.seats), owner_type: ownerType, owner_id: ownerId, buyer: user.id, beta: beta.apply ? 'auto' : '' };
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
    if (beta.apply) params.discounts = [{ coupon: BETA_COUPON }];   // earned by sending feedback
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
