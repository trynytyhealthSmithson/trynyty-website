// Sign-in and checkout for the website. Does nothing until /api/config says billing is on for this
// environment (it is off in production until launch), so pages look exactly as before.
(function () {
  const TOOL_NAMES = { ma: 'MA Enrollment Explorer', hospital: 'Hospital Financial Explorer', physician: 'Physician & Practice Explorer' };
  const TOOL_URLS = { ma: 'https://maenroll.trynytyhealth.com', hospital: 'https://hospitals.trynytyhealth.com', physician: 'https://physicians.trynytyhealth.com' };
  let ready = null;

  const loadClerk = pk => new Promise((resolve, reject) => {
    const fapi = atob(pk.split('_')[2]).replace(/\$$/, '');
    const s = document.createElement('script');
    s.src = `https://${fapi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
    s.async = true; s.crossOrigin = 'anonymous';
    s.setAttribute('data-clerk-publishable-key', pk);
    s.onload = () => window.Clerk.load().then(() => resolve(window.Clerk), reject);
    s.onerror = reject;
    document.head.appendChild(s);
  });

  const boot = () => (ready = ready || fetch('/api/config').then(r => r.json()).catch(() => ({ billing: false })).then(cfg => {
    if (!cfg.billing || !cfg.publishableKey) return null;
    document.documentElement.classList.add('billing-on');
    return loadClerk(cfg.publishableKey).catch(() => null);
  }));

  const claimsOf = token => {
    try { return JSON.parse(decodeURIComponent(escape(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return {}; }
  };
  const list = v => Array.isArray(v) ? v : (typeof v === 'string' && v ? (v.startsWith('[') ? JSON.parse(v) : v.split(',').map(s => s.trim())) : []);
  const live = u => !u || u === 'null' || Date.parse(u) > Date.now();

  async function plan(fresh) {
    const clerk = await boot();
    if (!clerk || !clerk.session) return null;
    const c = claimsOf(await clerk.session.getToken(fresh ? { skipCache: true } : undefined));
    const expand = l => (l.includes('all') ? Object.keys(TOOL_NAMES) : l.filter(k => TOOL_NAMES[k]));
    const o = c.o || {};
    return {
      email: clerk.user && clerk.user.primaryEmailAddress && clerk.user.primaryEmailAddress.emailAddress,
      mine: { tools: expand(list(c.tools)), until: c.until, live: live(c.until) },
      team: { id: o.id || c.org_id || null, admin: /admin/.test(o.rol || c.org_role || ''), tools: expand(list(c.org_tools)), until: c.org_until, live: live(c.org_until) },
    };
  }

  async function api(path, body) {
    const clerk = await boot();
    const token = await clerk.session.getToken();
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  }

  async function buy(tool, seats, status) {
    const say = t => { if (status) status.textContent = t; };
    const clerk = await boot();
    if (!clerk) return say('Checkout opens in December.');
    if (!clerk.user) {
      const back = new URL(window.location.href); back.searchParams.set('buy', `${tool}:${seats}`); back.hash = 'plans';
      return clerk.redirectToSignIn({ signInForceRedirectUrl: back.href, signUpForceRedirectUrl: back.href });
    }
    say('Opening secure checkout…');
    try {
      if (Number(seats) === 5 && !clerk.organization) {      // a team admin buying for their existing team
        const mine = await clerk.user.getOrganizationMemberships();
        const admin = (mine.data || mine || []).find(m => /admin/.test(m.role));
        if (admin) await clerk.setActive({ organization: admin.organization.id });
      }
      const { url } = await api('/api/checkout', { tool, seats });
      window.location.href = url;
    } catch (e) { say(e.message); }
  }

  window.TrynytyBilling = { boot, plan, api, buy, TOOL_NAMES, TOOL_URLS };
})();
