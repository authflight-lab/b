// Keno — single settle. Player picks 1..10 of 40 numbers; the server draws 10
// distinct numbers and pays PAYTABLE[picks][hits]. The paytable strip shown is a
// PREVIEW built from the exact same SHAPE + hypergeometric math the server uses
// (see api/game/keno.py) — the actual payout always comes from the settle
// response. Draw reveal is a staggered ~150ms-per-number animation with NOTHING
// predicted (the server seed is secret): the numbers just land in draw order.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const GRID = 40;
  const COLS = 8;
  const MAX_PICKS = 10;
  const EPS = 0.01; // Keno-specific edge — MUST match KENO_EPS in api/game/keno.py.
  const MULT_BOOST = 1.05; // MUST match MULT_BOOST in api/game/keno.py.
  const REVEAL_STAGGER_MS = 150;

  // Relative payout weights per (picks, hits) — an EXACT port of SHAPE in
  // api/game/keno.py (Stake/Rainbet "Classic" curve). Missing hit counts pay 0.
  const SHAPE = {
    1: { 1: 3.96 },
    2: { 1: 1.9, 2: 4.5 },
    3: { 1: 1, 2: 3.1, 3: 10.4 },
    4: { 1: 0.8, 2: 1.8, 3: 5, 4: 22.5 },
    5: { 1: 0.25, 2: 1.4, 3: 4.1, 4: 16.5, 5: 36 },
    6: { 2: 1, 3: 3.68, 4: 7, 5: 16.5, 6: 40 },
    7: { 2: 0.47, 3: 3, 4: 4.5, 5: 14, 6: 31, 7: 60 },
    8: { 3: 2.2, 4: 4, 5: 13, 6: 22, 7: 55, 8: 70 },
    9: { 3: 1.55, 4: 3, 5: 8, 6: 15, 7: 44, 8: 60, 9: 85 },
    10: { 3: 1.4, 4: 2.25, 5: 4.5, 6: 8, 7: 17, 8: 50, 9: 80, 10: 100 },
  };

  // Exact integer binomial (values here are tiny — C(40,10) fits a double).
  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    return Math.round(r);
  }
  // Hypergeometric P(h hits | k picks): C(10,h)C(30,k-h)/C(40,k).
  function pHit(k, h) {
    if (h < 0 || h > k || k - h > GRID - 10) return 0;
    return (comb(10, h) * comb(30, k - h)) / comb(40, k);
  }

  // Build the multiplier row for a given pick-count, rescaled to RTP = 1-EPS —
  // the SAME per-row factor the backend applies, so the preview never contradicts
  // the payout.
  function payRow(k) {
    const shape = SHAPE[k] || {};
    let raw = 0;
    for (const h in shape) raw += pHit(k, +h) * shape[h];
    const factor = ((1 - EPS) * MULT_BOOST) / raw;
    const row = [];
    for (let h = 0; h <= k; h++) row.push((shape[h] || 0) * factor);
    return row;
  }

  // Compact multiplier label: up to 2 decimals, trailing zeros trimmed ("5x",
  // "4.5x", "22.5x", "0x").
  function fmtMult(m) {
    if (!m) return "0x";
    let s = (Math.round(m * 100) / 100).toFixed(2);
    s = s.replace(/\.?0+$/, "");
    return s + "x";
  }

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    const seed = C.seedBox();

    const picks = new Set();          // selected numbers (1..40)
    const tiles = new Map();          // number -> tile element
    let busy = false;

    // --- Grid -------------------------------------------------------------
    const grid = el("div", { class: "keno-grid" });
    for (let n = 1; n <= GRID; n++) {
      const t = el("button", { class: "keno-tile", type: "button" }, String(n));
      t.addEventListener("click", () => toggle(n));
      tiles.set(n, t);
      grid.appendChild(t);
    }

    function clearReveal() {
      tiles.forEach((t) => t.classList.remove("hit", "miss", "faded", "landing"));
    }

    function toggle(n) {
      if (busy) return;
      clearReveal();
      const t = tiles.get(n);
      if (picks.has(n)) {
        picks.delete(n);
        t.classList.remove("selected");
      } else {
        if (picks.size >= MAX_PICKS) {
          BT.ui.toast("You can pick up to 10 numbers.", "error");
          BT.ui.haptic("error");
          return;
        }
        picks.add(n);
        t.classList.add("selected");
      }
      refresh();
    }

    // --- Paytable preview strip ------------------------------------------
    const prompt = el("div", { class: "keno-prompt" }, "Select 1–10 Numbers");
    const payStrip = el("div", { class: "keno-paytable hidden" });
    function renderPaytable() {
      BT.ui.clear(payStrip);
      const k = picks.size;
      if (k < 1) return;
      const row = payRow(k);
      for (let h = 0; h <= k; h++) {
        payStrip.appendChild(
          el("div", { class: "keno-pt-cell" + (row[h] > 0 ? "" : " zero") }, [
            el("div", { class: "keno-pt-mult" }, fmtMult(row[h])),
            el("div", { class: "keno-pt-hits" }, [BT.ui.icon("keno", 13), el("span", null, String(h))]),
          ])
        );
      }
    }

    // In-surface result line ("4/5 hits · 3.0x").
    const banner = C.resultBanner();
    const overlay = C.resultOverlay(grid);

    function refresh() {
      const k = picks.size;
      prompt.classList.toggle("hidden", k >= 1);
      payStrip.classList.toggle("hidden", k < 1);
      renderPaytable();
      betBtn.disabled = busy || k < 1;
      qpBtn.disabled = busy;
      clearBtn.disabled = busy || k < 1;
    }

    // --- Quick Pick / Clear ----------------------------------------------
    function quickPick() {
      if (busy) return;
      clearReveal();
      picks.forEach((n) => tiles.get(n).classList.remove("selected"));
      picks.clear();
      const pool = Array.from({ length: GRID }, (_, i) => i + 1);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      pool.slice(0, MAX_PICKS).forEach((n) => {
        picks.add(n);
        tiles.get(n).classList.add("selected");
      });
      refresh();
    }
    function clearPicks() {
      if (busy) return;
      clearReveal();
      picks.forEach((n) => tiles.get(n).classList.remove("selected"));
      picks.clear();
      banner.hide();
      refresh();
    }
    const qpBtn = el("button", { class: "btn ghost keno-tool", type: "button" }, "Quick Pick");
    const clearBtn = el("button", { class: "btn ghost keno-tool", type: "button" }, "Clear");
    qpBtn.addEventListener("click", quickPick);
    clearBtn.addEventListener("click", clearPicks);
    const tools = el("div", { class: "keno-tools" }, [qpBtn, clearBtn]);

    const betBtn = el("button", { class: "btn primary block" }, "Play");

    // Staggered reveal: land each drawn number in draw order. A drawn number
    // that is one of the player's picks pops green (a hit); other drawn numbers
    // show a neutral marker; the player's picks that were NOT drawn dim at the
    // end. Nothing is predicted — this just animates the server's result.
    function revealDraw(drawn, pickSet) {
      return new Promise((resolve) => {
        let i = 0;
        function step() {
          if (i >= drawn.length) {
            // Dim the picks that missed.
            pickSet.forEach((n) => {
              const t = tiles.get(n);
              if (!t.classList.contains("hit")) t.classList.add("faded");
            });
            resolve();
            return;
          }
          const n = drawn[i++];
          const t = tiles.get(n);
          if (pickSet.has(n)) {
            t.classList.add("hit", "landing");
            BT.ui.haptic("light");
          } else {
            t.classList.add("miss", "landing");
          }
          setTimeout(() => t.classList.remove("landing"), 260);
          setTimeout(step, REVEAL_STAGGER_MS);
        }
        step();
      });
    }

    betBtn.addEventListener("click", async () => {
      if (busy || picks.size < 1) return;
      busy = true;
      betBtn.disabled = qpBtn.disabled = clearBtn.disabled = true;
      bet.setDisabled(true);
      banner.hide();
      overlay.hide();
      seed.reset();
      clearReveal();

      const pickList = Array.from(picks).sort((a, b) => a - b);
      const pickSet = new Set(pickList);
      const stake = bet.getBet();

      try {
        let s = await BT.api.gamePlay("keno", { bet: stake, params: { picks: pickList } });
        if (s && s._status === 404) {
          const betResp = await BT.api.gameBet("keno", { bet: stake, params: { picks: pickList } });
          if (!betResp || betResp.ok === false) {
            BT.ui.toast(C.errText(betResp), "error");
            return;
          }
          seed.setHash(betResp.server_hash);
          seed.setNonce(betResp.nonce);
          BT.fair.noteBet(betResp);
          if (typeof betResp.balance === "number") BT.setBalance(betResp.balance);
          s = await BT.api.gameSettle("keno", { round_id: betResp.round_id });
        }
        if (!s || s.ok === false) {
          BT.ui.toast(C.errText(s), "error");
          return;
        }
        if (s.server_hash) seed.setHash(s.server_hash);
        if (s.nonce !== undefined && s.nonce !== null) { seed.setNonce(s.nonce); BT.fair.noteBet(s); }

        const o = s.outcome || {};
        const drawn = Array.isArray(o.drawn) ? o.drawn : [];
        const hits = typeof o.hits === "number" ? o.hits : 0;
        const mult = typeof o.multiplier === "number" ? o.multiplier : 0;
        const payout = s.payout || 0;
        const win = payout > 0;

        if (drawn.length) await revealDraw(drawn, pickSet);

        banner.show(win ? "win" : "lose", hits + "/" + pickList.length + " hits · " + fmtMult(mult));
        if (win) {
          overlay.show("win", C.winMult(mult, payout, stake), C.winLines(payout, stake));
        }
        C.syncBalance(s);
        BT.ui.haptic(win ? "success" : "error");
      } finally {
        busy = false;
        bet.setDisabled(false);
        refresh();
      }
    });

    refresh();
    root.appendChild(
      el("div", { class: "card" }, [
        C.gameHeader(
          "keno",
          "Keno",
          "Pick 1 to 10 numbers. The server draws 10 of 40 — the more of your numbers it hits, the bigger the payout. Fewer picks win often for less; ten picks chase the jackpot."
        ),
        tools,
        grid,
        prompt,
        payStrip,
        bet.node,
        betBtn,
        banner.node,
        seed.node,
      ])
    );
  }

  C.register({ key: "keno", title: "Keno", render });
})();
