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
let catalog = null;
async function ensureCatalog() {
  if (catalog) return catalog;
  const s = getStripe();
  const keys = Object.keys(PLANS);
  const found = await s.prices.list({ lookup_keys: keys, active: true, limit: 100 });
  const byKey = Object.fromEntries(found.data.map(p => [p.lookup_key, p.id]));
  for (const key of keys) {
    if (byKey[key]) continue;
    const plan = PLANS[key];
    const product = await s.products.create({ name: plan.product, tax_code: TAX_CODE, metadata: { plan: key, tools: plan.tools.join(','), seats: String(plan.seats) } });
    const price = await s.prices.create({
      product: product.id, currency: 'usd', unit_amount: plan.amount, recurring: { interval: 'year' },
      tax_behavior: 'exclusive', lookup_key: key, metadata: { plan: key },
    });
    byKey[key] = price.id;
  }
  try { await s.coupons.retrieve(BETA_COUPON); } catch (e) {
    await s.coupons.create({ id: BETA_COUPON, name: 'Beta tester: 50% off the first year', percent_off: 50, duration: 'once' });
  }
  const codes = await s.promotionCodes.list({ code: BETA_CODE, limit: 1 });
  if (!codes.data.length) await s.promotionCodes.create({ code: BETA_CODE, promotion: { type: 'coupon', coupon: BETA_COUPON } });
  catalog = byKey;
  return catalog;
}

let portalConfig = null;
async function ensurePortal(returnUrl) {
  if (portalConfig) return portalConfig;
  const s = getStripe();
  const list = await s.billingPortal.configurations.list({ active: true, limit: 20 });
  const mine = list.data.find(c => c.metadata && c.metadata.app === 'trynyty');
  if (mine) return (portalConfig = mine.id);
  const made = await s.billingPortal.configurations.create({
    name: 'TRYNYTY',
    metadata: { app: 'trynyty' },
    business_profile: { headline: 'TRYNYTY health:enablement: manage your subscription' },
    default_return_url: returnUrl,
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name', 'tax_id'] },
      subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: true, options: ['too_expensive', 'missing_features', 'unused', 'other'] } },
    },
  });
  return (portalConfig = made.id);
}

const send = (res, status, body) => { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); };

module.exports = { enabled, getStripe, getClerk, siteUrl, sessionOf, ensureCatalog, ensurePortal, send };
