// TRYNYTY paid plans. Prices are created in Stripe from this list (by lookup key) the first time
// checkout runs, so test mode and live mode match exactly. Amounts are in cents, per year.
const TOOLS = {
  ma: 'MA Enrollment Explorer',
  hospital: 'Hospital Financial Explorer',
  physician: 'Physician & Practice Explorer',
};

const PLANS = {};
for (const [code, name] of Object.entries(TOOLS)) {
  PLANS[`trynyty_${code}_1`] = { tools: [code], seats: 1, amount: 50000, product: `${name}, 1 user` };
  PLANS[`trynyty_${code}_5`] = { tools: [code], seats: 5, amount: 150000, product: `${name}, team of up to 5` };
}
PLANS.trynyty_all_1 = { tools: ['ma', 'hospital', 'physician'], seats: 1, amount: 120000, product: 'All three TRYNYTY explorers, 1 user' };
PLANS.trynyty_all_5 = { tools: ['ma', 'hospital', 'physician'], seats: 5, amount: 350000, product: 'All three TRYNYTY explorers, team of up to 5' };

// Stripe's tax code for business-use software as a service. Prices exclude tax.
const TAX_CODE = 'txcd_10103001';
const BETA_COUPON = 'trynyty_beta50';
const BETA_CODE = 'BETA50';
const SEATS = 5;

// Which plan a Stripe subscription is on, from its price's lookup key.
const planOfSub = sub => {
  const item = ((sub && sub.items && sub.items.data) || [])[0];
  const key = item && item.price && item.price.lookup_key;
  return key && PLANS[key] ? key : null;
};
// Does plan a include everything in plan b, at the same team size?
const covers = (a, b) => PLANS[a] && PLANS[b] && PLANS[a].seats === PLANS[b].seats && PLANS[b].tools.every(t => PLANS[a].tools.includes(t));

const planKey = (tool, seats) => `trynyty_${tool === 'all' ? 'all' : tool}_${Number(seats) === 5 ? 5 : 1}`;

module.exports = { TOOLS, PLANS, TAX_CODE, BETA_COUPON, BETA_CODE, SEATS, planKey, planOfSub, covers };
