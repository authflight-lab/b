// API client — the ONLY place that talks to /api/. Injects the Telegram
// initData header on every request. No game math, no secrets. Degrades
// gracefully when BT_API_BASE is empty or the network fails.
(function () {
  const BT = (window.BT = window.BT || {});

  function base() {
    return (window.BT_CONFIG && window.BT_CONFIG.BT_API_BASE) || "";
  }

  function isConfigured() {
    return !!base();
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
    if (!isConfigured()) {
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

  // Endpoint helpers — all paths under /bt/api/... per contract §4.
  const api = {
    isConfigured,
    initData,
    request,
    get,
    post,

    me: () => get("/bt/api/me"),
    claim: () => post("/bt/api/claim"),
    ageAck: () => post("/bt/api/age-ack"),
    rewards: () => get("/bt/api/rewards"),
    redeem: (reward_id) => post("/bt/api/redeem", { reward_id }),
    leaderboard: (tab) => get("/bt/api/leaderboard?tab=" + encodeURIComponent(tab || "rich")),
    history: () => get("/bt/api/history"),

    gameBet: (name, body) => post("/bt/api/game/" + encodeURIComponent(name) + "/bet", body),
    gameSettle: (name, body) => post("/bt/api/game/" + encodeURIComponent(name) + "/settle", body),
    gameStep: (name, body) => post("/bt/api/game/" + encodeURIComponent(name) + "/step", body),
    gameCashout: (name, body) => post("/bt/api/game/" + encodeURIComponent(name) + "/cashout", body),
  };

  BT.api = api;
})();
