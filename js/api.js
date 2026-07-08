// API client — the ONLY place that talks to /api/. Injects the Telegram
// initData header on every request. No game math, no secrets. Degrades
// gracefully when BT_API_BASE is empty or the network fails.
(function () {
  const BT = (window.BT = window.BT || {});

  function base() {
    return (window.BT_CONFIG && window.BT_CONFIG.BT_API_BASE) || "";
  }

  function hasRealBackend() {
    // A backend is configured whenever BT_API_BASE is a string, INCLUDING the
    // empty string (which means "same-origin proxy" — requests go to /bt/api/*
    // on this origin). Only a missing BT_CONFIG counts as unconfigured/preview.
    return !!(window.BT_CONFIG && typeof window.BT_CONFIG.BT_API_BASE === "string");
  }

  function initData() {
    try {
      return (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || "";
    } catch (e) {
      return "";
    }
  }

  // Core request. Always resolves (never throws) with an object.
  // On handled failures returns { ok:false, error:"<code>", ... }.
  async function request(method, path, body) {
    if (!hasRealBackend()) {
      return { ok: false, error: "api_not_configured", _unconfigured: true };
    }
    let res;
    try {
      res = await fetch(base() + path, {
        method: method,
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": initData(),
        },
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      return { ok: false, error: "network_error", _network: true };
    }

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }

    if (!res.ok) {
      if (data && typeof data === "object") {
        return Object.assign({ ok: false }, data, { _status: res.status });
      }
      return { ok: false, error: "http_" + res.status, _status: res.status };
    }
    // Successful GETs return their payload directly; ensure objects pass through.
    return data === null ? { ok: true } : data;
  }

  const get = (path) => request("GET", path, null);
  const post = (path, body) => request("POST", path, body || {});

  // Short-lived /me memo: boot() warms the top-bar balance and the home screen
  // renders moments later — both call me(). Sharing one in-flight promise (plus
  // a brief result cache) collapses that burst into a single network round-trip.
  // Any balance-changing action (claim/redeem/game*) invalidates it so the next
  // read is always fresh.
  const ME_TTL_MS = 2500;
  let _me = { at: 0, val: null, inflight: null };
  const invalidateMe = () => { _me = { at: 0, val: null, inflight: null }; };
  const me = (opts) => {
    const force = !!(opts && opts.force);
    if (!force) {
      if (_me.inflight) return _me.inflight;
      if (_me.val && (Date.now() - _me.at) < ME_TTL_MS) return Promise.resolve(_me.val);
    }
    const p = get("/bt/api/me").then((v) => {
      if (v && v.ok !== false && !v.error && !v._unconfigured) _me = { at: Date.now(), val: v, inflight: null };
      else _me = { at: 0, val: null, inflight: null };
      return v;
    }).catch((e) => { invalidateMe(); throw e; });
    _me.inflight = p;
    return p;
  };
  // Run a balance-changing call, then drop the /me memo so the next read is fresh.
  const afterMutation = (p) => {
    try { return p.finally(invalidateMe); }
    catch (e) { invalidateMe(); return p; }
  };

  // Endpoint helpers — all paths under /bt/api/... per contract §4.
  const api = {
    isConfigured: hasRealBackend,
    hasRealBackend,
    initData,
    request,
    get,
    post,

    me,
    invalidateMe,
    claim: () => afterMutation(post("/bt/api/claim")),
    ageAck: () => post("/bt/api/age-ack"),
    rewards: () => get("/bt/api/rewards"),
    redeem: (reward_id) => afterMutation(post("/bt/api/redeem", { reward_id })),
    leaderboard: (tab, period) => get("/bt/api/leaderboard?tab=" + encodeURIComponent(tab || "rich") + "&period=" + encodeURIComponent(period || "weekly")),
    history: () => get("/bt/api/history"),

    getSeedState: () => get("/bt/api/game/seeds"),
    rotateSeed: (body) => post("/bt/api/game/seeds/rotate", body || {}),

    backlogClaim: () => afterMutation(post("/bt/api/backlog/claim")),

    gameBet: (name, body) => afterMutation(post("/bt/api/game/" + encodeURIComponent(name) + "/bet", body)),
    gameSettle: (name, body) => afterMutation(post("/bt/api/game/" + encodeURIComponent(name) + "/settle", body)),
    // One-shot open+settle for single-settle games (dice, plinko): one round
    // trip instead of gameBet + gameSettle. Returns the settle payload plus the
    // bet-side server_hash/nonce. Callers should fall back to bet+settle if this
    // 404s (app + API deploy independently, so /play may not be live yet).
    gamePlay: (name, body) => afterMutation(post("/bt/api/game/" + encodeURIComponent(name) + "/play", body)),
    gameStep: (name, body) => afterMutation(post("/bt/api/game/" + encodeURIComponent(name) + "/step", body)),
    gameCashout: (name, body) => afterMutation(post("/bt/api/game/" + encodeURIComponent(name) + "/cashout", body)),
    // Crash liveness poll (~1/s while the curve rises). Plain post — a bust
    // pays 0 so the /me memo need not be dropped on every poll tick.
    crashCheck: (body) => post("/bt/api/game/crash/check", body),
  };

  BT.api = api;
})();
