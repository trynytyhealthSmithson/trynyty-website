// Open the Stripe billing page (invoices, card, cancel) for the signed-in person, or for their
// team when they are its admin and ask for it. Body: { scope: 'me' | 'team' }.
const { enabled, getStripe, getClerk, siteUrl, sessionOf, ensurePortal, send } = require('./_lib/clients');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Use POST.' }); }
  if (!enabled()) return send(res, 503, { error: 'Billing is not open yet.' });
  const claims = await sessionOf(req);
  if (!claims) return send(res, 401, { error: 'Please sign in first.' });
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  try {
    const clerk = getClerk();
    let customer = null;
    if (b.scope === 'team') {
      const o = claims.o || {}; const org = o.id || claims.org_id; const role = o.rol || claims.org_role || '';
      if (!org || !/admin/.test(role)) return send(res, 403, { error: 'Only a team admin can manage the team’s billing.' });
      customer = ((await clerk.organizations.getOrganization({ organizationId: org })).privateMetadata || {}).stripe_customer;
    } else {
      customer = ((await clerk.users.getUser(claims.sub)).privateMetadata || {}).stripe_customer;
    }
    if (!customer) return send(res, 404, { error: 'There is no billing account here yet.' });
    const returnUrl = `${siteUrl(req)}/account`;
    const configuration = await ensurePortal(returnUrl);
    const session = await getStripe().billingPortal.sessions.create({ customer, configuration, return_url: returnUrl });
    return send(res, 200, { url: session.url });
  } catch (e) {
    console.error('portal', e && e.message);
    return send(res, 502, { error: 'The billing page could not open. Please try again.' });
  }
};
