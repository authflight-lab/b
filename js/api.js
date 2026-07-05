// API client — the ONLY place that talks to /api/. Injects the Telegram
// initData header on every request. No game math, no secrets. Degrades
// gracefully when BT_API_BASE is empty or the network fails.
//
// TEMP DEV MODE: when BT_API_BASE is empty, this file falls back to a
// local mock backed by sample.json so the UI can be exercised end-to-end
// without a live server. This is for design/preview testing only — see
// the "---- MOCK MODE ----" section below. Remove once a real API base
// is configured.
(function () {
  const BT = (window.BT = window.BT || {});

  function base() {
    return (window.BT_CONFIG && window.BT_CONFIG.BT_API_BASE) || "";
  }

  function hasRealBackend() {
    return !!base();
  }

  function initData() {
    try {
      return (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || "";
    } catch (e) {
      return "";
    }
  }

  // ---- MOCK MODE (temporary, for design preview only) -----------------------
  const MOCK = {
    dataPromise: null,
    profile: null,
    rewards: null,
    leaderboard: null,
    history: null,
    rounds: {},
    nonce: 0,
  };

  function loadSample() {
    if (!MOCK.dataPromise) {
      MOCK.dataPromise = fetch("sample.json")
        .then((r) => r.json())
        .then((d) => {
          MOCK.profile = Object.assign({}, d.me);
          MOCK.rewards = JSON.parse(JSON.stringify(d.rewards));
          MOCK.leaderboard = JSON.parse(JSON.stringify(d.leaderboard));
          MOCK.history = (d.history && d.history.rows) ? d.history.rows.slice() : [];
          return d;
        })
        .catch(() => {
          MOCK.profile = { display_name: "Guest", balance: 0, streak_days: 0, member_status: "member", can_redeem: false, quest: {} };
          MOCK.rewards = { period: "", rewards: [] };
          MOCK.leaderboard = { rich: { rows: [] }, chatters: { rows: [] } };
          MOCK.history = [];
          return null;
        });
    }
    return MOCK.dataPromise;
  }

  function rndHex(len) {
    let s = "";
    for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }
  function fakeHash() { return rndHex(64); }
  function newRoundId() { return "mock_" + Date.now().toString(36) + "_" + rndHex(6); }
  function round2(n) { return Math.round(n * 100) / 100; }

  function pushHistory(kind, amount) {
    MOCK.history.unshift({ kind: kind, amount: amount, created_at: new Date().toISOString() });
  }

  async function mockMe() {
    await loadSample();
    return Object.assign({ ok: true }, MOCK.profile);
  }

  async function mockClaim() {
    await loadSample();
    if (MOCK.profile.quest.claimed) return { ok: false, error: "already_claimed" };
    const awarded = 40 + Math.floor(Math.random() * 20);
    MOCK.profile.balance += awarded;
    MOCK.profile.streak_days += 1;
    MOCK.profile.quest.claimed = true;
    MOCK.profile.last_claim_at = new Date().toISOString();
    pushHistory("daily", awarded);
    return { ok: true, new_balance: MOCK.profile.balance, awarded: awarded, streak_days: MOCK.profile.streak_days };
  }

  async function mockAgeAck() {
    await loadSample();
    MOCK.profile.age_ack = true;
    return { ok: true };
  }

  async function mockRewards() {
    await loadSample();
    return Object.assign({ ok: true }, MOCK.rewards);
  }

  async function mockRedeem(reward_id) {
    await loadSample();
    const rw = (MOCK.rewards.rewards || []).find((r) => r.id === reward_id);
    if (!rw || !rw.active) return { ok: false, error: "reward_inactive" };
    if (!MOCK.profile.can_redeem) return { ok: false, error: "activity_floor_not_met" };
    const unlimited = !rw.monthly_limit || rw.monthly_limit === 0;
    if (!unlimited && rw.remaining !== null && rw.remaining <= 0) return { ok: false, error: "monthly_limit_reached" };
    if (MOCK.profile.balance < rw.cost) return { ok: false, error: "insufficient_balance" };
    MOCK.profile.balance -= rw.cost;
    if (!unlimited) rw.remaining -= 1;
    pushHistory("redeem", -rw.cost);
    return { ok: true, new_balance: MOCK.profile.balance };
  }

  async function mockLeaderboard(tabKey) {
    await loadSample();
    const src = (tabKey === "chatters") ? MOCK.leaderboard.chatters : MOCK.leaderboard.rich;
    return { ok: true, rows: src.rows, you: src.you };
  }

  async function mockHistory() {
    await loadSample();
    return { ok: true, rows: MOCK.history };
  }

  async function mockGameBet(name, body) {
    await loadSample();
    const bet = Math.max(1, parseInt(body && body.bet, 10) || 10);
    if (bet > MOCK.profile.balance) return { ok: false, error: "insufficient_balance" };
    MOCK.profile.balance -= bet;
    pushHistory("game_bet", -bet);
    const round_id = newRoundId();
    const params = (body && body.params) || {};
    const round = MOCK.rounds[round_id] = {
      game: name,
      bet: bet,
      params: params,
      multiplier: 1,
      step: 0,
    };
    // HighLow: commit a starting card at bet (mirrors real API params.start_card).
    if (name === "highlow") {
      round.__card = 1 + Math.floor(Math.random() * 13);
      params.start_card = round.__card;
    }
    return { ok: true, round_id: round_id, server_hash: fakeHash(), nonce: ++MOCK.nonce, balance: MOCK.profile.balance, params: params };
  }

  function settlePayout(round, payout) {
    delete MOCK.rounds[round.__id];
    if (payout > 0) { MOCK.profile.balance += payout; pushHistory("game_win", payout); }
    return payout;
  }

  async function mockGameSettle(name, body) {
    await loadSample();
    const round = MOCK.rounds[body.round_id];
    if (!round) return { ok: false, error: "no_open_round" };
    round.__id = body.round_id;
    const server_seed = fakeHash();

    if (name === "dice") {
      const target = Math.max(2, Math.min(98, parseInt(body.target ?? round.params.target, 10) || 50));
      const roll = round2(Math.random() * 100);
      const win = roll < target;
      const multiplier = win ? round2(99 / target) : 0;
      const payout = win ? Math.round(round.bet * multiplier) : 0;
      settlePayout(round, payout);
      return { ok: true, server_seed, outcome: { roll, win, multiplier }, payout, balance: MOCK.profile.balance };
    }

    if (name === "plinko") {
      const rows = parseInt(round.params.rows, 10) || 12;
      const risk = round.params.risk === "high" ? "high" : "low";
      const path = [];
      let rightCount = 0;
      for (let i = 0; i < rows; i++) {
        const r = Math.random() < 0.5 ? 0 : 1;
        path.push(r);
        if (r === 1) rightCount++;
      }
      const slot = rightCount;
      const center = rows / 2;
      const dist = Math.abs(slot - center) / center;
      const base = risk === "high" ? [0, 0.2, 0.5, 1, 2, 5, 12] : [0.3, 0.5, 0.8, 1, 1.3, 1.8, 3];
      const idx = Math.min(base.length - 1, Math.floor(dist * (base.length - 1)));
      const multiplier = base[idx];
      const payout = Math.round(round.bet * multiplier);
      settlePayout(round, payout);
      return { ok: true, server_seed, outcome: { path, slot, bucket: slot, multiplier }, payout, balance: MOCK.profile.balance };
    }

    return { ok: false, error: "unknown_game" };
  }

  async function mockGameStep(name, body) {
    await loadSample();
    const round = MOCK.rounds[body.round_id];
    if (!round) return { ok: false, error: "no_open_round" };
    round.__id = body.round_id;

    if (name === "flip") {
      const move = body.move;
      const result = Math.random() < 0.5 ? "heads" : "tails";
      const win = move === result;
      if (!win) {
        const server_seed = fakeHash();
        settlePayout(round, 0);
        return { ok: true, outcome_step: { result }, multiplier: round.multiplier, busted: true, payout: 0, server_seed, balance: MOCK.profile.balance };
      }
      round.multiplier = round2(round.multiplier * 1.98);
      round.step++;
      return { ok: true, outcome_step: { result }, multiplier: round.multiplier, busted: false, done: false, balance: MOCK.profile.balance };
    }

    if (name === "mines") {
      const mines = parseInt(round.params.mines, 10) || 3;
      const totalCells = 25;
      // Commit a fixed mine layout for the round on the first reveal, so the
      // outcome is consistent: cells revealed safe can never later be shown as
      // mines. Membership is checked against the committed layout, not a fresh
      // per-step coin flip.
      if (!round.__mineSet) round.__mineSet = new Set(sampleMinePositions(mines));
      const layout = Array.from(round.__mineSet).sort((a, b) => a - b);
      const cell = body.move && typeof body.move.cell === "number" ? body.move.cell : -1;
      if (round.__mineSet.has(cell)) {
        const server_seed = fakeHash();
        settlePayout(round, 0);
        return { ok: true, outcome_step: { cell, is_mine: true }, multiplier: round.multiplier, busted: true, payout: 0, server_seed, outcome: { mines: layout, hit: cell }, balance: MOCK.profile.balance };
      }
      const remaining = totalCells - round.step;
      round.multiplier = round2(round.multiplier * (remaining / (remaining - mines)));
      round.step++;
      const done = round.step >= (totalCells - mines);
      if (done) {
        const server_seed = fakeHash();
        const payout = Math.round(round.bet * round.multiplier);
        settlePayout(round, payout);
        return { ok: true, outcome_step: { cell, is_mine: false }, multiplier: round.multiplier, busted: false, done: true, payout, server_seed, outcome: { mines: layout, cleared: true }, balance: MOCK.profile.balance };
      }
      return { ok: true, outcome_step: { cell, is_mine: false }, multiplier: round.multiplier, busted: false, done: false, balance: MOCK.profile.balance };
    }

    if (name === "towers") {
      const DIFF = { easy: 4, medium: 3, hard: 2 };
      const cols = DIFF[round.params.difficulty] || 3;
      const safe = Math.random() >= (1 / cols);
      if (!safe) {
        const server_seed = fakeHash();
        settlePayout(round, 0);
        return { ok: true, outcome_step: { safe: false }, multiplier: round.multiplier, busted: true, payout: 0, server_seed, balance: MOCK.profile.balance };
      }
      round.multiplier = round2(round.multiplier * (cols / (cols - 1)));
      round.step++;
      const done = round.step >= 8;
      if (done) {
        const server_seed = fakeHash();
        const payout = Math.round(round.bet * round.multiplier);
        settlePayout(round, payout);
        return { ok: true, outcome_step: { safe: true }, multiplier: round.multiplier, busted: false, done: true, payout, server_seed, balance: MOCK.profile.balance };
      }
      return { ok: true, outcome_step: { safe: true }, multiplier: round.multiplier, busted: false, done: false, balance: MOCK.profile.balance };
    }

    if (name === "highlow") {
      // Mirror the real API: ranks 1..13, TIE counts as a loss, and the per-step
      // multiplier is (1 - EPS) / p_dir(r) so the UI's preview matches payouts.
      const EPS = 0.01;
      const dir = (body.move && body.move.guess) === "higher" ? "higher" : "lower";
      const cur = round.__card || (round.__card = 1 + Math.floor(Math.random() * 13));
      const p = dir === "higher" ? (13 - cur) / 13 : (cur - 1) / 13;
      if (p <= 0) return { ok: false, error: "invalid_move" };
      const next = 1 + Math.floor(Math.random() * 13);
      const win = dir === "higher" ? next > cur : next < cur; // tie => loss
      round.__card = next;
      if (!win) {
        const server_seed = fakeHash();
        settlePayout(round, 0);
        return { ok: true, outcome_step: { drawn: next, prev: cur, guess: dir, win: false }, multiplier: 0.0, busted: true, done: true, payout: 0, server_seed, balance: MOCK.profile.balance };
      }
      round.multiplier = round2(round.multiplier * ((1 - EPS) / p));
      round.step++;
      return { ok: true, outcome_step: { drawn: next, prev: cur, guess: dir, win: true }, multiplier: round.multiplier, busted: false, done: false, balance: MOCK.profile.balance };
    }

    return { ok: false, error: "unknown_game" };
  }

  function sampleMinePositions(count) {
    const set = new Set();
    while (set.size < count) set.add(Math.floor(Math.random() * 25));
    return Array.from(set);
  }

  async function mockGameCashout(name, body) {
    await loadSample();
    const round = MOCK.rounds[body.round_id];
    if (!round) return { ok: false, error: "no_open_round" };
    round.__id = body.round_id;
    const server_seed = fakeHash();
    const payout = Math.round(round.bet * round.multiplier);
    settlePayout(round, payout);
    let outcome;
    if (name === "mines") {
      const minesCount = parseInt(round.params.mines, 10) || 3;
      // Mirror the real API: cashout reveals server_seed anyway, so the mine
      // layout is already derivable — commit one if the player cashed out
      // before any reveal, otherwise reuse the committed layout.
      if (!round.__mineSet) round.__mineSet = new Set(sampleMinePositions(minesCount));
      outcome = { mines: Array.from(round.__mineSet).sort((a, b) => a - b) };
    }
    return { ok: true, server_seed, payout, outcome, balance: MOCK.profile.balance };
  }
  // ---- END MOCK MODE ---------------------------------------------------------

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

  // Endpoint helpers — all paths under /bt/api/... per contract §4.
  // Each falls back to the local mock when no real backend is configured.
  const api = {
    isConfigured: () => true,
    hasRealBackend,
    initData,
    request,
    get,
    post,

    me: () => (hasRealBackend() ? get("/bt/api/me") : mockMe()),
    claim: () => (hasRealBackend() ? post("/bt/api/claim") : mockClaim()),
    ageAck: () => (hasRealBackend() ? post("/bt/api/age-ack") : mockAgeAck()),
    rewards: () => (hasRealBackend() ? get("/bt/api/rewards") : mockRewards()),
    redeem: (reward_id) => (hasRealBackend() ? post("/bt/api/redeem", { reward_id }) : mockRedeem(reward_id)),
    leaderboard: (tab) => (hasRealBackend() ? get("/bt/api/leaderboard?tab=" + encodeURIComponent(tab || "rich")) : mockLeaderboard(tab || "rich")),
    history: () => (hasRealBackend() ? get("/bt/api/history") : mockHistory()),

    gameBet: (name, body) => (hasRealBackend() ? post("/bt/api/game/" + encodeURIComponent(name) + "/bet", body) : mockGameBet(name, body)),
    gameSettle: (name, body) => (hasRealBackend() ? post("/bt/api/game/" + encodeURIComponent(name) + "/settle", body) : mockGameSettle(name, body)),
    gameStep: (name, body) => (hasRealBackend() ? post("/bt/api/game/" + encodeURIComponent(name) + "/step", body) : mockGameStep(name, body)),
    gameCashout: (name, body) => (hasRealBackend() ? post("/bt/api/game/" + encodeURIComponent(name) + "/cashout", body) : mockGameCashout(name, body)),
  };

  BT.api = api;
})();
