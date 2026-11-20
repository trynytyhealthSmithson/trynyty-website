// Stripe tells us here when someone pays, renews, cancels or a payment fails. Each event re-reads
// that customer's subscriptions and rewrites their access in Clerk. A new team plan also creates
// the team (a Clerk organization of up to five, with the buyer as admin).
const { getStripe, getClerk, send } = require('./_lib/clients');
const { syncCustomer } = require('./_lib/access');
const { SEATS, domainOf } = require('./_lib/plans');

const rawBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', c => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

// A move from a 1-user plan to a team: the personal plan was credited at checkout, so end it now.
async function endReplacedPlans(session) {
  const s = getStripe();
  const ids = String((session.metadata || {}).replaces || '').split(',').filter(Boolean);
  for (const id of ids) {
    const sub = await s.subscriptions.retrieve(id);
    if (['active', 'trialing', 'past_due'].includes(sub.status)) await s.subscriptions.cancel(id, { prorate: false });
  }
}

async function setUpTeam(session) {
  const s = getStripe(); const clerk = getClerk();
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription && session.subscription.id;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer && session.customer.id;
  if (!subId || !customerId) return;
  const sub = await s.subscriptions.retrieve(subId);
  if ((sub.metadata || {}).owner_type !== 'pending_org') return;            // already done (Stripe retries events)
  const buyer = sub.metadata.buyer;
  const field = (session.custom_fields || []).find(f => f.key === 'team_name');
  const typed = field && field.text && field.text.value;
  const name = (typed || `${(session.customer_details && session.customer_details.name) || 'TRYNYTY'} team`).slice(0, 80);
  const buyerUser = await clerk.users.getUser(buyer);
  const buyerEmail = (buyerUser.emailAddresses.find(e => e.id === buyerUser.primaryEmailAddressId) || buyerUser.emailAddresses[0] || {}).emailAddress;
  const org = await clerk.organizations.createOrganization({
    name, createdBy: buyer, maxAllowedMemberships: SEATS,
    publicMetadata: { team_domains: [domainOf(buyerEmail)].filter(Boolean) },
    privateMetadata: { stripe_customer: customerId },
  });
  await s.customers.update(customerId, { metadata: { owner_type: 'org', owner_id: org.id } });
  await s.subscriptions.update(subId, { metadata: { ...sub.metadata, owner_type: 'org', owner_id: org.id } });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Use POST.' }); }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return send(res, 503, { error: 'Not set up.' });
  let event;
  try {
    const body = await rawBody(req);
    event = getStripe().webhooks.constructEvent(body, req.headers['stripe-signature'], secret);
  } catch (e) {
    return send(res, 400, { error: 'Signature check failed.' });
  }
  try {
    const obj = event.data.object;
    if (event.type === 'checkout.session.completed') { await setUpTeam(obj); await endReplacedPlans(obj); }
    const customer = typeof obj.customer === 'string' ? obj.customer : obj.customer && obj.customer.id;
    const relevant = ['checkout.session.completed', 'invoice.paid', 'invoice.payment_failed',
      'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'];
    const result = relevant.includes(event.type) && customer ? await syncCustomer(customer) : { ignored: event.type };
    return send(res, 200, { received: true, result });
  } catch (e) {
    console.error('webhook', event.type, e && e.message);
    return send(res, 500, { error: 'Could not update access; Stripe will retry.' });
  }
};
