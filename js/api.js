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
    seedPair: null,
  };

  // Economy guards — mirror the real backend (api/game/__init__.py). MULT_CAP
  // is the global ceiling on any round's win multiplier; P_MAX caps the final
  // payout in points. Kept in lockstep with the server so the preview matches.
  const MULT_CAP = 25;
  const P_MAX = 2000;
  function capPayout(bet, mult) {
    return Math.min(Math.round(bet * mult), P_MAX);
  }

  // Mines front-loads its house edge so early cash-outs (esp. at low mine counts)
  // start below 1x and only profit after a few reveals — mirrors api/game/mines.py.
  const MINES_EPS = 0.01, MINES_EDGE_RAMP = 0.13, MINES_EDGE_DECAY = 0.6;
  // Flat 10% reduction on every mines multiplier (mirrors MULT_SCALE in mines.py).
  const MINES_MULT_SCALE = 0.90;
  function minesEdge(k) {
    if (k <= 0) return 0;
    return MINES_EPS + MINES_EDGE_RAMP * Math.pow(MINES_EDGE_DECAY, k - 1);
  }
  function minesMultiplier(k, m) {
    let prod = 1;
    for (let i = 0; i < k; i++) prod *= (25 - i) / (25 - m - i);
    return MINES_MULT_SCALE * (1 - minesEdge(k)) * prod;
  }

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

  // ---- Provably-fair seed pair (Rainbet-style reuse) ------------------------
  // Mirrors the server: one active pair reused across bets with a per-pair nonce
  // and a pre-committed next server seed. Hashes are REAL sha256 of the seeds, so
  // a revealed (rotated-out) server seed genuinely verifies against the hash the
  // panel showed while it was active. The active server seed is never returned
  // by a bet/settle — only on rotation.
  async function sha256hex(s) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      return fakeHash(); // preview fallback where SubtleCrypto is unavailable
    }
  }
  async function makeSeedPair(clientSeed) {
    const cs = (clientSeed && String(clientSeed).trim()) || rndHex(16);
    const ss = rndHex(64), nx = rndHex(64);
    return {
      client_seed: cs,
      server_seed: ss,
      server_hash: await sha256hex(ss),
      nonce: 0,
      next_server_seed: nx,
      next_server_hash: await sha256hex(nx),
    };
  }
  async function ensureSeedPair() {
    if (!MOCK.seedPair) MOCK.seedPair = await makeSeedPair();
    return MOCK.seedPair;
  }
  async function mockGetSeedState() {
    await loadSample();
    const p = await ensureSeedPair();
    return { ok: true, client_seed: p.client_seed, nonce: p.nonce, server_hash: p.server_hash, next_server_hash: p.next_server_hash };
  }
  async function mockRotateSeed(body) {
    await loadSample();
    // Block rotation mid-round so a revealed seed can't leak an open round.
    if (Object.keys(MOCK.rounds).length) return { ok: false, error: "open_round_exists" };
    const p = await ensureSeedPair();
    const revealed = p.server_seed;
    const nx = rndHex(64);
    const cs = (body && body.client_seed && String(body.client_seed).trim()) || p.client_seed;
    MOCK.seedPair = {
      client_seed: cs,
      server_seed: p.next_server_seed,   // promote the pre-committed next seed
      server_hash: p.next_server_hash,   // whose hash was already shown
      nonce: 0,
      next_server_seed: nx,
      next_server_hash: await sha256hex(nx),
    };
    const np = MOCK.seedPair;
    return { ok: true, server_seed: revealed, client_seed: np.client_seed, nonce: np.nonce, server_hash: np.server_hash, next_server_hash: np.next_server_hash };
  }

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

  async function mockLeaderboard(tabKey, period) {
    await loadSample();
    const src = (tabKey === "chatters") ? MOCK.leaderboard.chatters : MOCK.leaderboard.rich;
    return { ok: true, period: period || "weekly", rows: src.rows, you: src.you };
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
    // The current decision card is always non-wild (Aces/Kings are wild).
    if (name === "highlow") {
      round.__card = hlDrawCurrent();
      params.start_card = round.__card;
    }
    // Reuse the active seed pair: return its committed hash and the current
    // nonce, then advance the nonce for the next bet. The active server seed is
    // never disclosed here — only on rotation.
    const p = await ensureSeedPair();
    const usedNonce = p.nonce;
    p.nonce += 1;
    return { ok: true, round_id: round_id, server_hash: p.server_hash, nonce: usedNonce, balance: MOCK.profile.balance, params: params };
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

    if (name === "dice") {
      const target = Math.max(2, Math.min(98, parseInt(body.target ?? round.params.target, 10) || 50));
      const roll = round2(Math.random() * 100);
      const win = roll < target;
      const multiplier = win ? round2(99 / target) : 0;
      const payout = win ? capPayout(round.bet, multiplier) : 0;
      settlePayout(round, payout);
      return { ok: true, outcome: { roll, win, multiplier }, payout, balance: MOCK.profile.balance };
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
      const payout = capPayout(round.bet, multiplier);
      settlePayout(round, payout);
      return { ok: true, outcome: { path, slot, bucket: slot, multiplier }, payout, balance: MOCK.profile.balance };
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
        settlePayout(round, 0);
        return { ok: true, outcome_step: { result }, multiplier: round.multiplier, busted: true, payout: 0, balance: MOCK.profile.balance };
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
        settlePayout(round, 0);
        return { ok: true, outcome_step: { cell, is_mine: true }, multiplier: round.multiplier, busted: true, payout: 0, outcome: { mines: layout, hit: cell }, balance: MOCK.profile.balance };
      }
      round.step++;
      const k = round.step;
      // Compute from the reveal count k using the front-loaded edge (mirrors
      // api/game/mines.py) rather than a flat per-step incremental factor, so
      // early reveals at low mine counts start below 1x.
      const raw = round2(minesMultiplier(k, mines));
      round.multiplier = Math.min(raw, MULT_CAP);
      // Auto-cash on a full clear OR once the cap is reached (mirrors backend).
      const done = k >= (totalCells - mines) || raw >= MULT_CAP;
      if (done) {
        const payout = capPayout(round.bet, round.multiplier);
        settlePayout(round, payout);
        return { ok: true, outcome_step: { cell, is_mine: false }, multiplier: round.multiplier, busted: false, done: true, payout, outcome: { mines: layout, cleared: true }, balance: MOCK.profile.balance };
      }
      return { ok: true, outcome_step: { cell, is_mine: false }, multiplier: round.multiplier, busted: false, done: false, balance: MOCK.profile.balance };
    }

    if (name === "towers") {
      const DIFF = { easy: 4, medium: 3, hard: 2 };
      const cols = DIFF[round.params.difficulty] || 3;
      const safe = Math.random() >= (1 / cols);
      if (!safe) {
        settlePayout(round, 0);
        return { ok: true, outcome_step: { safe: false }, multiplier: round.multiplier, busted: true, payout: 0, balance: MOCK.profile.balance };
      }
      const raw = round2(round.multiplier * (cols / (cols - 1)));
      round.multiplier = Math.min(raw, MULT_CAP);
      round.step++;
      // Auto-cash on the top floor OR once the cap is reached (mirrors backend);
      // keeps hard's doubling ladder from running away past the ceiling.
      const done = round.step >= 8 || raw >= MULT_CAP;
      if (done) {
        const payout = capPayout(round.bet, round.multiplier);
        settlePayout(round, payout);
        return { ok: true, outcome_step: { safe: true }, multiplier: round.multiplier, busted: false, done: true, payout, balance: MOCK.profile.balance };
      }
      return { ok: true, outcome_step: { safe: true }, multiplier: round.multiplier, busted: false, done: false, balance: MOCK.profile.balance };
    }

    if (name === "highlow") {
      // Mirror the real API (api/game/highlow.py): TIE counts as a WIN for the
      // picked side; the revealed card is on the full 1..13 deck while the current
      // decision card is always non-wild (Aces/Kings are wild and pass through);
      // the per-step factor is (1 - EPS) / p_dir(r); HighLow uses its own larger
      // house edge and caps the chain multiplier at MAXM.
      const EPS = 0.05, MAXM = MULT_CAP;
      // Accept object-shaped moves ({guess}/{skip}) or a bare string, matching
      // the real API (api/game highlow step).
      const raw = body.move;
      const move = raw && typeof raw === "object" ? raw : { guess: raw };
      const cur = round.__card || (round.__card = hlDrawCurrent());
      // Skip: swap the current card for a fresh one, no wager, multiplier
      // unchanged. EV-neutral, so unlimited skips are safe (mirrors backend).
      if (move.skip || move.guess === "skip") {
        const current = hlDrawCurrent();
        round.__card = current;
        round.step++;
        return { ok: true, outcome_step: { current: current, prev: cur, guess: "skip", skipped: true, win: true }, multiplier: round.multiplier, can_cashout: true, busted: false, done: false, balance: MOCK.profile.balance };
      }
      const dir = move.guess === "higher" ? "higher" : "lower";
      const p = dir === "higher" ? (14 - cur) / 13 : cur / 13;
      const factor = (1 - EPS) / p;
      // Reject picks that can't grow the chain or would exceed the multiplier cap.
      if (p <= 0 || factor <= 1 || round.multiplier * factor > MAXM + 1e-9) {
        return { ok: false, error: "invalid_move" };
      }
      const next = hlDrawCard(); // revealed card, full 1..13 deck
      const win = dir === "higher" ? next >= cur : next <= cur; // tie => win
      if (!win) {
        settlePayout(round, 0);
        return { ok: true, outcome_step: { drawn: next, prev: cur, guess: dir, win: false }, multiplier: 0.0, busted: true, done: true, payout: 0, balance: MOCK.profile.balance };
      }
      round.multiplier = round2(round.multiplier * factor);
      round.step++;
      // A wild reveal (Ace/King) passes through to the next non-wild card.
      const current = (next <= 1 || next >= 13) ? hlDrawCurrent() : next;
      round.__card = current;
      return { ok: true, outcome_step: { drawn: next, current: current, prev: cur, guess: dir, win: true }, multiplier: round.multiplier, busted: false, done: false, balance: MOCK.profile.balance };
    }

    return { ok: false, error: "unknown_game" };
  }

  // HighLow: Aces (1) and Kings (13) are wild; the current decision card is always
  // non-wild (2..12). Mirrors api/game/highlow.py.
  function hlDrawCard() { return 1 + Math.floor(Math.random() * 13); }
  function hlDrawCurrent() { let r; do { r = hlDrawCard(); } while (r <= 1 || r >= 13); return r; }

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
    // Must take at least one step before cashing out (mirrors backend guard).
    if (name === "mines" && (round.step || 0) < 1) return { ok: false, error: "must_reveal_first" };
    if (name === "towers" && (round.step || 0) < 1) return { ok: false, error: "must_climb_first" };
    const payout = capPayout(round.bet, round.multiplier);
    settlePayout(round, payout);
    let outcome;
    if (name === "mines") {
      const minesCount = parseInt(round.params.mines, 10) || 3;
      // Mirror the real API: cashout discloses the mine layout so the UI can
      // reveal the board — commit one if the player cashed out before any reveal,
      // otherwise reuse the committed layout. (The server seed stays secret.)
      if (!round.__mineSet) round.__mineSet = new Set(sampleMinePositions(minesCount));
      outcome = { mines: Array.from(round.__mineSet).sort((a, b) => a - b), multiplier: round.multiplier };
    }
    // Return the cashed-out multiplier at top level (mirrors step responses) so
    // the UI shows the real value instead of 0×; also nested in outcome for mines.
    return { ok: true, multiplier: round.multiplier, payout, outcome, balance: MOCK.profile.balance };
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
    leaderboard: (tab, period) => (hasRealBackend()
      ? get("/bt/api/leaderboard?tab=" + encodeURIComponent(tab || "rich") + "&period=" + encodeURIComponent(period || "weekly"))
      : mockLeaderboard(tab || "rich", period || "weekly")),
    history: () => (hasRealBackend() ? get("/bt/api/history") : mockHistory()),

    getSeedState: () => (hasRealBackend() ? get("/bt/api/game/seeds") : mockGetSeedState()),
    rotateSeed: (body) => (hasRealBackend() ? post("/bt/api/game/seeds/rotate", body || {}) : mockRotateSeed(body || {})),

    gameBet: (name, body) => (hasRealBackend() ? post("/bt/api/game/" + encodeURIComponent(name) + "/bet", body) : mockGameBet(name, body)),
    gameSettle: (name, body) => (hasRealBackend() ? post("/bt/api/game/" + encodeURIComponent(name) + "/settle", body) : mockGameSettle(name, body)),
    gameStep: (name, body) => (hasRealBackend() ? post("/bt/api/game/" + encodeURIComponent(name) + "/step", body) : mockGameStep(name, body)),
    gameCashout: (name, body) => (hasRealBackend() ? post("/bt/api/game/" + encodeURIComponent(name) + "/cashout", body) : mockGameCashout(name, body)),
  };

  BT.api = api;
})();
