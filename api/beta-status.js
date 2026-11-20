// Whether the signed-in person gets the beta discount at checkout (for the note on the pricing page).
const { enabled, getClerk, sessionOf, send } = require('./_lib/clients');
const { betaStatus } = require('./_lib/beta');

module.exports = async (req, res) => {
  if (!enabled()) return send(res, 200, { apply: false });
  const claims = await sessionOf(req);
  if (!claims) return send(res, 200, { apply: false });
  const user = await getClerk().users.getUser(claims.sub);
  const e = user.emailAddresses.find(x => x.id === user.primaryEmailAddressId) || user.emailAddresses[0];
  return send(res, 200, await betaStatus(e ? e.emailAddress : ''));
};
