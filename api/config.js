// What the website needs to know to show sign-in and checkout. Billing stays hidden until both
// Clerk and Stripe keys are set for this environment (production has neither yet).
const { enabled, send } = require('./_lib/clients');

module.exports = (req, res) => send(res, 200, {
  billing: enabled(),
  publishableKey: enabled() ? process.env.CLERK_PUBLISHABLE_KEY || null : null,
});
