// Shared clients and helpers for the billing functions.
const Stripe = require('stripe');
const { createClerkClient, verifyToken } = require('@clerk/backend');
const { PLANS, TAX_CODE, BETA_COUPON, BETA_CODE } = require('./plans');

const enabled = () => !!(process.env.STRIPE_SECRET_KEY && process.env.CLERK_SECRET_KEY);
let stripe; let clerk;
const getStripe = () => (stripe = stripe || new Stripe(process.env.STRIPE_SECRET_KEY));
const getClerk = () => (clerk = clerk || createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY }));

const siteUrl = req => {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${req.headers['x-forwarded-proto'] || 'https'}://${host}`;
};

// The signed-in Clerk session behind a request (Authorization: Bearer <session token>).
async function sessionOf(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try { return await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY }); } catch (e) { return null; }
}

// Make sure every plan, the beta coupon and the billing portal exist in Stripe. Safe to repeat.
let catalog = null; let catalogProducts = null;
async function ensureCatalog() {
  if (catalog) return catalog;
  const productsByKey = {};
  const s = getStripe();
  const keys = Object.keys(PLANS);
  const found = await s.prices.list({ lookup_keys: keys, active: true, limit: 100 });
  const byKey = Object.fromEntries(found.data.map(p => [p.lookup_key, p.id]));
  found.data.forEach(p => { productsByKey[p.lookup_key] = typeof p.product === 'string' ? p.product : p.product.id; });
  for (const key of keys) {
    if (byKey[key]) continue;
    const plan = PLANS[key];
    const product = await s.products.create({ name: plan.product, tax_code: TAX_CODE, metadata: { plan: key, tools: plan.tools.join(','), seats: String(plan.seats) } });
    const price = await s.prices.create({
      product: product.id, currency: 'usd', unit_amount: plan.amount, recurring: { interval: 'year' },
      tax_behavior: 'exclusive', lookup_key: key, metadata: { plan: key },
    });
    byKey[key] = price.id; productsByKey[key] = product.id;
  }
  try { await s.coupons.retrieve(BETA_COUPON); } catch (e) {
    await s.coupons.create({ id: BETA_COUPON, name: 'Beta tester: 50% off the first year', percent_off: 50, duration: 'once' });
  }
  // The shared BETA50 code is retired: the discount now applies automatically to people who sent
  // feedback, and exceptions get personal one-time codes made in the Stripe dashboard.
  const codes = await s.promotionCodes.list({ code: BETA_CODE, active: true, limit: 5 });
  for (const c of codes.data) await s.promotionCodes.update(c.id, { active: false });
  catalog = byKey; catalogProducts = productsByKey;
  return catalog;
}

// Billing portal setups: "manage" (invoices, card, cancel) and one per team size for upgrades, so
// an upgrade can change explorers but never move a plan between a person and a team.
const portalConfigs = {};
async function ensurePortal(returnUrl, kind = 'manage') {
  if (portalConfigs[kind]) return portalConfigs[kind];
  const s = getStripe();
  await ensureCatalog();
  const seats = kind === 'upgrade5' ? 5 : 1;
  const features = {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name', 'tax_id'] },
    subscription_cancel: { enabled: kind === 'manage', mode: 'at_period_end', cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'unused', 'other'] } },
    subscription_update: kind === 'manage' ? { enabled: false } : {
      enabled: true, default_allowed_updates: ['price'], proration_behavior: 'always_invoice',
      products: Object.keys(PLANS).filter(k => PLANS[k].seats === seats).map(k => ({ product: catalogProducts[k], prices: [catalog[k]] })),
    },
  };
  const list = await s.billingPortal.configurations.list({ active: true, limit: 50 });
  const tag = kind === 'manage' ? 'trynyty' : `trynyty-${kind}`;
  const mine = list.data.find(c => c.metadata && c.metadata.app === tag);
  const params = { features, business_profile: { headline: 'TRYNYTY health:enablement: manage your subscription' }, default_return_url: returnUrl };
  const cfg = mine ? await s.billingPortal.configurations.update(mine.id, params)
    : await s.billingPortal.configurations.create({ ...params, name: `TRYNYTY ${kind}`, metadata: { app: tag } });
  return (portalConfigs[kind] = cfg.id);
}

const send = (res, status, body) => { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); };

module.exports = { enabled, getStripe, getClerk, siteUrl, sessionOf, ensureCatalog, ensurePortal, send };
