// The beta offer: 50% off the first year for people who sent feedback through an explorer. The
// discount is applied at checkout when the buyer's sign-in email matches a feedback submission in
// the beta database, so there is no shared code to pass around. One discounted plan per person.
const { neon } = require('@neondatabase/serverless');
const { getStripe } = require('./clients');
const { BETA_COUPON } = require('./plans');

const dbUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

// Did this email send feedback (a feedback note, a data issue, or a beta sign-up with comments)?
async function sentFeedback(email) {
  if (!dbUrl() || !email) return false;
  const sql = neon(dbUrl());
  try { await sql`ALTER TABLE beta_submissions ADD COLUMN IF NOT EXISTS verified_email text`; } catch (e) { /* read-only is fine */ }
  const until = process.env.BETA_FEEDBACK_UNTIL || '2999-12-31';   // set when the beta testing period ends
  const e = email.toLowerCase();
  const rows = await sql`SELECT 1 FROM beta_submissions
    WHERE (lower(email) = ${e} OR verified_email = ${e})
      AND (kind IN ('feedback', 'issue') OR (kind = 'signup' AND coalesce(message, '') <> ''))
      AND created_at < ${until}::date + 1
    LIMIT 1`;
  return rows.length > 0;
}

// Has this email already used the beta discount on any plan?
async function usedDiscount(email) {
  const s = getStripe();
  const customers = await s.customers.list({ email, limit: 20 });
  for (const c of customers.data) {
    const subs = await s.subscriptions.list({ customer: c.id, status: 'all', limit: 50, expand: ['data.discounts'] });
    for (const sub of subs.data) {
      if ((sub.metadata || {}).beta === 'auto') return true;
      for (const d of sub.discounts || []) {
        const coupon = d && (d.coupon || (d.source && d.source.coupon));
        if ((coupon && (coupon.id || coupon)) === BETA_COUPON) return true;
      }
    }
  }
  return false;
}

async function betaStatus(email) {
  try {
    const eligible = await sentFeedback(email);
    const used = eligible ? await usedDiscount(email) : false;
    return { eligible, used, apply: eligible && !used };
  } catch (e) {
    console.error('beta status', e && e.message);
    return { eligible: false, used: false, apply: false };
  }
}

module.exports = { betaStatus };
