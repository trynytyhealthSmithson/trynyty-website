// Admin only: bill an organization by invoice (card or bank transfer, net 30 by default) with access
// linked the same way as a checkout purchase. The customer needs a TRYNYTY account first, so the plan
// can be attached to them (or to a new team they run). Access starts when the invoice is paid, unless
// "access before payment" is chosen (for example, against a purchase order).
const { enabled, getStripe, getClerk, sessionOf, ensureCatalog, send } = require('./_lib/clients');
const { PLANS, planKey, planOfSub, covers, BETA_COUPON, SEATS, domainOf, isWorkEmail } = require('./_lib/plans');
const { syncCustomer } = require('./_lib/access');

const admins = () => (process.env.ADMIN_EMAILS || 'andrew@trynytyhealth.com').toLowerCase().split(',').map(s => s.trim());
const primaryEmail = u => ((u.emailAddresses.find(e => e.id === u.primaryEmailAddressId) || u.emailAddresses[0] || {}).emailAddress || '').toLowerCase();

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Use POST.' }); }
  if (!enabled()) return send(res, 503, { error: 'Billing is not set up here.' });
  const claims = await sessionOf(req);
  if (!claims) return send(res, 401, { error: 'Please sign in.' });
  const clerk = getClerk(); const s = getStripe();
  const me = await clerk.users.getUser(claims.sub);
  if (!admins().includes(primaryEmail(me))) return send(res, 403, { error: 'This page is for TRYNYTY admins.' });

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  if (b.check) return send(res, 200, { admin: true });
  const email = String(b.email || '').trim().toLowerCase();
  const tool = ['ma', 'hospital', 'physician', 'all'].includes(b.tool) ? b.tool : null;
  if (!email || !tool) return send(res, 400, { error: 'Enter the customer’s email and choose a plan.' });
  const key = planKey(tool, b.seats); const plan = PLANS[key];
  const days = Math.max(1, Math.min(90, parseInt(b.days, 10) || 30));

  try {
    const prices = await ensureCatalog();
    const found = await clerk.users.getUserList({ emailAddress: [email], limit: 5 });
    const user = (found.data || found || []).find(u => primaryEmail(u) === email) || (found.data || found || [])[0];
    if (!user) return send(res, 404, { error: `No TRYNYTY account uses ${email} yet. Ask them to create one at trynytyhealth.com (Pricing, then Buy, then create an account), then try again.` });

    let ownerType = 'user'; let ownerId = user.id; let customer = (user.privateMetadata || {}).stripe_customer || null;
    if (plan.seats > 1) {
      if (!isWorkEmail(email)) return send(res, 400, { error: 'Team plans need a work email address.' });
      const name = String(b.teamName || '').trim().slice(0, 80);
      if (!name) return send(res, 400, { error: 'Enter the team or organization name.' });
      const org = await clerk.organizations.createOrganization({
        name, createdBy: user.id, maxAllowedMemberships: SEATS,
        publicMetadata: { team_domains: [domainOf(email)] },
      });
      ownerType = 'org'; ownerId = org.id;
      const c = await s.customers.create({ email, name, metadata: { owner_type: 'org', owner_id: org.id } });
      customer = c.id;
      await clerk.organizations.updateOrganizationMetadata(org.id, { privateMetadata: { stripe_customer: customer } });
    } else if (!customer) {
      const c = await s.customers.create({ email, metadata: { owner_type: 'user', owner_id: user.id } });
      customer = c.id;
      await clerk.users.updateUserMetadata(user.id, { privateMetadata: { stripe_customer: customer } });
    } else {
      const live = (await s.subscriptions.list({ customer, status: 'active', limit: 100 })).data.filter(planOfSub);
      if (live.some(sub => covers(planOfSub(sub), key))) return send(res, 409, { error: 'This person already has a plan that includes this.' });
    }
    if (b.po) await s.customers.update(customer, { invoice_settings: { custom_fields: [{ name: 'PO number', value: String(b.po).slice(0, 30) }] } });

    const sub = await s.subscriptions.create({
      customer,
      items: [{ price: prices[key], quantity: 1 }],
      collection_method: 'send_invoice',
      days_until_due: days,
      automatic_tax: { enabled: process.env.STRIPE_TAX === 'on' },
      ...(b.beta ? { discounts: [{ coupon: BETA_COUPON }] } : {}),
      metadata: {
        plan: key, tools: plan.tools.join(','), seats: String(plan.seats), owner_type: ownerType, owner_id: ownerId,
        buyer: user.id, beta: b.beta ? 'auto' : '', access_before_payment: b.accessNow ? 'yes' : '', invoiced_by: primaryEmail(me),
      },
      expand: ['latest_invoice'],
    });
    let invoice = sub.latest_invoice;
    if (invoice && invoice.status === 'draft') invoice = await s.invoices.finalizeInvoice(invoice.id);
    if (invoice && invoice.status === 'open') await s.invoices.sendInvoice(invoice.id);
    await syncCustomer(customer);
    return send(res, 200, {
      ok: true, invoiceUrl: invoice && invoice.hosted_invoice_url, amountDue: invoice ? invoice.amount_due / 100 : null,
      dueDays: days, access: b.accessNow ? 'now' : 'when paid', team: plan.seats > 1,
    });
  } catch (e) {
    console.error('admin invoice', e && e.message);
    return send(res, 502, { error: `Stripe or Clerk refused the request: ${e && e.message}` });
  }
};
