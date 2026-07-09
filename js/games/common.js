// Shared helpers for game controllers. Games render server outcomes ONLY —
// no odds, RNG, or payout math lives here.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const fmt = BT.ui.fmt;

  BT.games = BT.games || {};
  BT.games.registry = BT.games.registry || {};

  function register(game) {
    BT.games.registry[game.key] = game;
  }

  // Bet range per contract §3: [1, min(350, balance)].
  function maxBet(balance) {
    const b = Number(balance) || 0;
    return Math.max(1, Math.min(350, b));
  }

  function clientSeed() {
    const a = new Uint8Array(16);
    (window.crypto || {}).getRandomValues
      ? window.crypto.getRandomValues(a)
      : a.forEach((_, i) => (a[i] = Math.floor(Math.random() * 256)));
    return Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  // Provably-fair seed pair (Rainbet-style reuse). The SERVER owns the active
  // client + server seeds; one pair is reused across bets with a per-pair nonce,
  // and it rotates only on demand. Games no longer mint a fresh client seed per
  // bet — this module mirrors the server's public view and drives the Provably
  // Fair panel + rotation. The active server_seed is never exposed here (only its
  // hash); it becomes verifiable only after the pair is rotated out.
  const fair = (function () {
    let state = null;   // { clientSeed, nonce, serverHash, nextServerHash, revealed }
    let loading = null;

    function apply(resp) {
      if (!resp || resp.ok === false) return state;
      state = {
        clientSeed: resp.client_seed || "",
        nonce: typeof resp.nonce === "number" ? resp.nonce : 0,
        serverHash: resp.server_hash || "",
        nextServerHash: resp.next_server_hash || "",
        // A rotate response reveals the retired server seed; keep it for verify.
        revealed: resp.server_seed || (state && state.revealed) || null,
      };
      return state;
    }

    async function load(force) {
      if (state && !force) return state;
      if (!loading) {
        loading = BT.api.getSeedState()
          .then((r) => { loading = null; return apply(r); })
          .catch(() => { loading = null; return state; });
      }
      return loading;
    }

    return {
      getState: () => state,
      load,
      clientSeed: () => (state ? state.clientSeed : ""),
      // Reflect the nonce advancing after a bet without a round-trip.
      noteBet(resp) {
        if (state && resp && typeof resp.nonce === "number") state.nonce = resp.nonce + 1;
      },
      async rotate(newClientSeed) {
        const r = await BT.api.rotateSeed({ client_seed: newClientSeed || "" });
        if (r && r.ok !== false) apply(r);
        return r;
      },
      randomSeed: clientSeed,
    };
  })();
  BT.fair = fair;

  // Standard bet control row shared by all games. Returns { node, getBet }.
  // The 1/2 / 2x / Max buttons edit the value directly in the bet field:
  //   1/2 halves it (floored), 2x doubles it, Max jumps to the cap; both
  //   2x and Max clamp to min(350, balance).
  function betControl(defaultBet) {
    const bal = (BT.state && BT.state.balance) || 0;
    const mx = maxBet(bal);
    const input = el("input", {
      type: "number",
      class: "betbox-input",
      min: "1",
      max: String(mx),
      step: "1",
      value: String(Math.min(defaultBet || 10, mx)),
    });

    // Current value in the field, coerced to a valid integer (>= 1).
    function cur() {
      let v = parseInt(input.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      return v;
    }
    function setVal(v) {
      const cap = maxBet((BT.state && BT.state.balance) || 0);
      if (isNaN(v) || v < 1) v = 1;
      if (v > cap) v = cap;
      input.value = String(v);
    }

    function actionBtn(label, onclick) {
      return el("button", { class: "betbox-btn", type: "button", onclick }, label);
    }
    const curIcon = BT.ui.icon("token", 20);
    curIcon.classList.add("betbox-cur");
    const halveBtn = actionBtn("1/2", () => setVal(Math.floor(cur() / 2)));
    const doubleBtn = actionBtn("2x", () => setVal(cur() * 2));
    const maxBtn = actionBtn("Max", () => setVal(maxBet((BT.state && BT.state.balance) || 0)));
    const box = el("div", { class: "betbox" }, [
      curIcon,
      input,
      halveBtn,
      doubleBtn,
      maxBtn,
    ]);

    const node = el("div", { class: "field" }, [
      el("label", null, "Bet"),
      box,
    ]);
    function getBet() {
      setVal(cur());
      return parseInt(input.value, 10);
    }
    // Block the whole bet UI (field + 1/2 / 2x / Max) while a round is open, so
    // it can't be tapped mid-game. It never actually re-stakes an open round,
    // but leaving it live made it look like it might. The .disabled class dims
    // it and blocks pointer events; the attributes stop keyboard/tap input.
    function setDisabled(on) {
      input.disabled = !!on;
      halveBtn.disabled = doubleBtn.disabled = maxBtn.disabled = !!on;
      box.classList.toggle("disabled", !!on);
    }
    return { node, getBet, input, setDisabled };
  }

  // Provably-fair anchor. The seed pair (client_seed / nonce / server_hash, and
  // any revealed prev server_seed) is owned by BT.fair and shown in the
  // "Provably Fair" panel opened from the Play screen — NOT inline in the game.
  // Games still hold a seedBox and call setHash/setNonce/reset so their existing
  // flow is unchanged, but the values are no longer rendered here; the node is a
  // hidden placeholder kept only so `root.appendChild(seed.node)` stays valid.
  function seedBox() {
    const state = { hash: "—", nonce: "—" };
    const node = el("div", { class: "fair-anchor", "aria-hidden": "true" });
    return {
      node,
      getState: () => state,
      setHash: (h) => (state.hash = h || "—"),
      setNonce: (n) => (state.nonce = n === undefined || n === null ? "—" : String(n)),
      reset: () => { state.hash = "—"; state.nonce = "—"; },
    };
  }

  function resultBanner() {
    const node = el("div", { class: "result neutral hidden" });
    return {
      node,
      show: (kind, text) => {
        node.className = "result " + (kind || "neutral");
        node.textContent = text;
        node.classList.remove("hidden");
      },
      hide: () => node.classList.add("hidden"),
    };
  }

  // Shared result overlay — centered over any container element.
  // Sets position:relative on the container and appends the overlay inside it.
  // Returns { show(kind, multText, labelText), hide() }.
  function resultOverlay(container) {
    container.style.position = "relative";
    const multEl = el("div", { class: "mro-mult" }, "");
    const innerEl = el("div", { class: "mro-inner" }, [multEl]);
    const linesEl = el("div", { class: "mro-lines" });
    const cardEl = el("div", { class: "mro-card" }, [innerEl, linesEl]);
    const wrap = el("div", { class: "game-result-overlay hidden" }, [cardEl]);
    container.appendChild(wrap);
    wrap.addEventListener("click", () => wrap.classList.add("hidden"));
    return {
      node: wrap,
      // `lines` is either a single string (e.g. a loss reason) or an array of
      // strings stacked top-to-bottom. The first line renders as the muted
      // label (Revenue), any following line as the emphasised Profit line.
      show(kind, multText, lines) {
        multEl.textContent = multText;
        BT.ui.clear(linesEl);
        (Array.isArray(lines) ? lines : [lines]).forEach((ln, i) => {
          if (ln === null || ln === undefined) return;
          linesEl.appendChild(el("div", { class: i === 0 ? "mro-label" : "mro-profit" }, String(ln)));
        });
        cardEl.className = "mro-card " + kind;
        wrap.classList.remove("hidden");
      },
      hide() { wrap.classList.add("hidden"); },
    };
  }

  // After any settle/cashout, refresh balance from the response (fallback to /me).
  function syncBalance(resp) {
    if (resp && typeof resp.new_balance === "number") {
      BT.setBalance(resp.new_balance);
    } else if (resp && resp.balance !== undefined && typeof resp.balance === "number") {
      BT.setBalance(resp.balance);
    } else {
      BT.refreshMe && BT.refreshMe();
    }
  }

  // Win-overlay copy: the raw payout is REVENUE (the amount credited to the
  // balance); REVENUE minus the stake is PROFIT (the net gain). New users read a
  // bare "+X" as profit when it is actually gross revenue, so both are spelled
  // out. Returns two lines for the overlay: ["Revenue: X pts", "Profit: +X pts"].
  function winLines(payout, stake) {
    const rev = Number(payout) || 0;
    const profit = rev - (Number(stake) || 0);
    const sign = profit < 0 ? "-" : "+";
    return [
      "Revenue: " + fmt(rev) + " pts",
      "Profit: " + sign + fmt(Math.abs(profit)) + " pts",
    ];
  }

  // Multiplier headline ("Nx") for a WIN overlay. Prefer the server-reported
  // multiplier; if it is missing or non-positive, derive it from payout/stake so
  // the headline is ALWAYS a multiplier, never a bare "Win!".
  function winMult(mult, payout, stake) {
    const s = Number(stake) || 0;
    const m = typeof mult === "number" && mult > 0
      ? mult
      : (s > 0 ? (Number(payout) || 0) / s : 0);
    return (Math.round(m * 100) / 100) + "x";
  }

  // Session stats visibility — shared, module-level toggle so the header
  // button (one per game panel, recreated on every render) and the panel
  // itself (appended once by the play screen) stay in sync. Defaults to
  // Hide; only a click on the header toggle flips it.
  let statsVisible = false;
  const statsSubs = [];
  function statsEmit() {
    statsSubs.slice().forEach((fn) => { try { fn(); } catch (e) {} });
  }
  const statsToggle = {
    isVisible: () => statsVisible,
    toggle() { statsVisible = !statsVisible; statsEmit(); },
    subscribe(fn) {
      statsSubs.push(fn);
      return () => {
        const i = statsSubs.indexOf(fn);
        if (i >= 0) statsSubs.splice(i, 1);
      };
    },
  };

  // Game panel header: icon + title on the left, stats-toggle + ⓘ info
  // buttons on the right. Clicking ⓘ opens a full-screen overlay with the
  // game description, exactly like the Provably Fair panel — nothing shown
  // until the icon is tapped. Clicking the stats icon shows/hides the
  // session stats card below (default Hide); it lights up while active.
  function gameHeader(iconKey, title, desc) {
    const statsBtn = el("button", {
      class: "game-info-btn game-stats-btn",
      type: "button",
      "aria-label": "Toggle session stats",
      "aria-pressed": String(statsToggle.isVisible()),
    }, BT.ui.icon("stats", 15));
    statsBtn.classList.toggle("active", statsToggle.isVisible());
    statsBtn.addEventListener("click", () => statsToggle.toggle());
    const unsubStats = statsToggle.subscribe(() => {
      if (!statsBtn.isConnected) { unsubStats(); return; }
      statsBtn.classList.toggle("active", statsToggle.isVisible());
      statsBtn.setAttribute("aria-pressed", String(statsToggle.isVisible()));
    });

    // Red disclaimer button: opens the points/simulated-gambling notice in an
    // overlay (same pattern as the ⓘ info button below).
    const alertBtn = el("button", {
      class: "game-info-btn game-alert-btn",
      type: "button",
      "aria-label": "Points & fairness disclaimer",
    }, BT.ui.icon("alert", 15));
    alertBtn.addEventListener("click", () => {
      const overlay = el("div", { class: "overlay" });
      const close = () => overlay.remove();
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
      overlay.appendChild(
        el("div", { class: "overlay-card game-desc-card" }, [
          el("div", { class: "game-desc-top" }, [
            el("div", { class: "fair-title" }, [BT.ui.icon("alert", 20), el("h2", null, "Please note")]),
            el("button", { class: "fair-x", type: "button", onclick: close }, "✕"),
          ]),
          el("p", { class: "game-desc-body" }, BT.LEGAL_POINTS),
        ])
      );
      document.body.appendChild(overlay);
    });

    const infoBtn = el("button", {
      class: "game-info-btn",
      type: "button",
      "aria-label": "About this game",
    }, "ⓘ");
    infoBtn.addEventListener("click", () => {
      const overlay = el("div", { class: "overlay" });
      const close = () => overlay.remove();
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
      overlay.appendChild(
        el("div", { class: "overlay-card game-desc-card" }, [
          el("div", { class: "game-desc-top" }, [
            el("div", { class: "fair-title" }, [BT.ui.icon(iconKey, 20), el("h2", null, title)]),
            el("button", { class: "fair-x", type: "button", onclick: close }, "✕"),
          ]),
          el("p", { class: "game-desc-body" }, desc),
        ])
      );
      document.body.appendChild(overlay);
    });
    return el("div", { class: "game-title-wrap" }, [
      el("h3", { class: "game-title" }, [BT.ui.icon(iconKey, 22), el("span", null, title)]),
      el("div", { class: "game-title-actions" }, [statsBtn, alertBtn, infoBtn]),
    ]);
  }

  // Common failure-to-message mapping.
  function errText(resp) {
    const code = (resp && resp.error) || "unknown_error";
    const map = {
      api_not_configured: "The game server isn't set up yet.",
      network_error: "Network error — please try again.",
      insufficient_balance: "Balance too low.",
      bad_init_data: "Open this from Telegram to play.",
      round_open: "You already have a round in progress.",
      no_open_round: "That round has ended.",
      invalid_move: "That move isn't available right now.",
      round_not_open: "That round has ended.",
      must_reveal_first: "Reveal at least one tile before cashing out.",
      must_climb_first: "Climb at least one floor before cashing out.",
      must_pick_first: "Pick at least one card before cashing out.",
      must_win_first: "Win at least one round before cashing out.",
      must_cross_first: "Cross at least one lane before cashing out.",
      skip_limit: "You've used all 5 skips — pick a side to continue.",
      rate_limited: "Slow down a moment, then try again.",
    };
    return map[code] || ("Error: " + code);
  }

  // --- Session P&L tracker ------------------------------------------------
  // Client-side record of settled wagers, scoped to a single game panel: the
  // play screen calls reset() on every render (opening the page, switching
  // games), so the tally covers only the current game since it was opened —
  // never an all-session or cross-game total. Fed centrally by the api client
  // (see api.js noteOpen / noteSettle) — it observes bet + settle responses,
  // so no game controller reports anything itself. Nothing is persisted or
  // sent anywhere. `curve` is the cumulative net profit after each settled
  // bet — the stepped up/down line the panel charts.
  BT.session = (function () {
    const open = {};   // round_id -> stake, remembered between /bet and its settle
    const S = { wagered: 0, returned: 0, wins: 0, losses: 0 };
    let curve = [0];
    const subs = [];

    function emit() {
      subs.slice().forEach((fn) => { try { fn(); } catch (e) {} });
    }
    return {
      // Remember an opened round's stake until its settle arrives.
      open(roundId, stake) {
        if (roundId !== undefined && roundId !== null) open[roundId] = Number(stake) || 0;
      },
      // Pop the stake for a settling round. Returns undefined if unknown
      // (e.g. a round opened before a reload) — that settle is simply not
      // tracked rather than guessed at. Popping also makes settlement
      // observation idempotent: a crash bust seen via /cashout can't be
      // counted again by the /check poll.
      take(roundId) {
        if (roundId !== undefined && roundId !== null && Object.prototype.hasOwnProperty.call(open, roundId)) {
          const v = open[roundId];
          delete open[roundId];
          return v;
        }
        return undefined;
      },
      settle(stake, payout) {
        const st = Number(stake) || 0;
        const po = Number(payout) || 0;
        S.wagered += st;
        S.returned += po;
        // Wins vs losses per net result: a payout at or below the stake is a
        // loss (payout > stake is the win test, so a 1.0x push counts as a
        // loss of nothing but not a win).
        if (po > st) S.wins += 1; else S.losses += 1;
        curve.push(S.returned - S.wagered);
        // Cap the curve; decimate every other point (keeping first and last)
        // so a long session keeps its overall shape with a bounded array.
        if (curve.length > 240) {
          curve = curve.filter((_, i, a) => i % 2 === 0 || i === a.length - 1);
        }
        emit();
      },
      reset() {
        S.wagered = 0; S.returned = 0; S.wins = 0; S.losses = 0;
        curve = [0];
        Object.keys(open).forEach((k) => delete open[k]);
        emit();
      },
      stats: () => ({
        profit: S.returned - S.wagered,
        wagered: S.wagered,
        wins: S.wins,
        losses: S.losses,
        bets: S.wins + S.losses,
      }),
      curve: () => curve.slice(),
      subscribe(fn) {
        subs.push(fn);
        return () => {
          const i = subs.indexOf(fn);
          if (i >= 0) subs.splice(i, 1);
        };
      },
    };
  })();

  // Session stats panel — the shared card shown under every game: a 2×2 stat
  // grid (Profit / Wins / Wagered / Losses) plus a cumulative net-profit
  // curve, green above zero and red below. Purely a view over BT.session.
  const SVG_NS = "http://www.w3.org/2000/svg";
  let sessPanelSeq = 0;
  // The single most recent panel instance. Only one session panel exists at a
  // time (renderGames replaces it wholesale), so each new panel deterministically
  // tears down its detached predecessor's subscription instead of relying on a
  // future emit to notice the node is gone.
  let sessPanelLive = null;
  function svgNode(tag, attrs) {
    const n = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function sessionPanel() {
    const uid = "sess" + (++sessPanelSeq);
    const signed = (v) => (v < 0 ? "-" : "+") + fmt(Math.abs(v));

    function cell(label, cls) {
      const val = el("div", { class: "sess-val " + (cls || "") }, "0");
      return { node: el("div", { class: "sess-cell" }, [el("div", { class: "sess-label" }, label), val]), val };
    }
    const cProfit = cell("Profit", "");
    const cWagered = cell("Wagered", "");
    const stack = el("div", { class: "sess-stack" }, [cProfit.node, cWagered.node]);

    // Chart: fixed viewBox stretched to the box; non-scaling strokes keep the
    // line crisp. The green/red split is two copies of the same line + area,
    // clipped above and below the zero baseline.
    const CW = 100, CH = 34, PAD = 2;
    const svg = svgNode("svg", {
      class: "sess-svg",
      viewBox: "0 0 " + CW + " " + CH,
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    });
    const chartWrap = el("div", { class: "sess-chart" });
    chartWrap.appendChild(svg);
    const emptyMsg = el("div", { class: "sess-empty" }, "Profit over time charts here once you bet.");
    chartWrap.appendChild(emptyMsg);

    function drawCurve(curve) {
      BT.ui.clear(svg);
      let lo = Math.min(0, Math.min.apply(null, curve));
      let hi = Math.max(0, Math.max.apply(null, curve));
      // A flat curve (every settle was a push, so net profit never left 0)
      // would collapse the range; pad it symmetrically so the zero baseline
      // sits centred rather than pinned to an edge.
      if (hi === lo) { hi += 1; lo -= 1; }
      const span = hi - lo;
      const y = (v) => PAD + ((hi - v) / span) * (CH - PAD * 2);
      const x = (i) => (curve.length > 1 ? (i / (curve.length - 1)) * CW : 0);
      const zeroY = y(0);

      const defs = svgNode("defs");
      const mkClip = (id, yTop, h) => {
        const cp = svgNode("clipPath", { id });
        cp.appendChild(svgNode("rect", { x: -1, y: yTop, width: CW + 2, height: Math.max(0, h) }));
        defs.appendChild(cp);
      };
      mkClip(uid + "-up", -1, zeroY + 1);
      mkClip(uid + "-dn", zeroY, CH - zeroY + 1);
      svg.appendChild(defs);

      // Zero baseline.
      svg.appendChild(svgNode("line", {
        x1: 0, y1: zeroY, x2: CW, y2: zeroY, class: "sess-zero",
      }));

      const linePts = curve.map((v, i) => x(i) + "," + y(v)).join(" ");
      const areaD = "M0," + zeroY + " L" + curve.map((v, i) => x(i) + "," + y(v)).join(" L") + " L" + CW + "," + zeroY + " Z";
      [["up", "sess-up"], ["dn", "sess-dn"]].forEach(([side, cls]) => {
        const g = svgNode("g", { "clip-path": "url(#" + uid + "-" + side + ")" });
        g.appendChild(svgNode("path", { d: areaD, class: "sess-area " + cls }));
        g.appendChild(svgNode("polyline", { points: linePts, class: "sess-line " + cls }));
        svg.appendChild(g);
      });
    }

    function update() {
      const s = BT.session.stats();
      cProfit.val.textContent = signed(s.profit);
      cProfit.val.className = "sess-val " + (s.profit > 0 ? "pos" : s.profit < 0 ? "neg" : "");
      cWagered.val.textContent = fmt(s.wagered);
      const curve = BT.session.curve();
      const hasData = s.bets > 0;
      emptyMsg.classList.toggle("hidden", hasData);
      svg.classList.toggle("hidden", !hasData);
      if (hasData) drawCurve(curve);
    }

    const resetBtn = el("button", {
      class: "sess-reset",
      type: "button",
      "aria-label": "Reset session stats",
      onclick: () => BT.session.reset(),
    }, "↺");
    const body = el("div", { class: "sess-body" }, [stack, chartWrap]);
    const node = el("div", { class: "card sess-card" }, [
      el("div", { class: "sess-head" }, [
        el("div", { class: "sess-title" }, "Session stats"),
        resetBtn,
      ]),
      body,
    ]);
    node.classList.toggle("hidden", !statsToggle.isVisible());

    // Deterministic teardown: a new panel replaces the old one wholesale, so
    // creating this one unsubscribes any detached predecessor immediately.
    // The isConnected check on emit remains as a belt-and-braces fallback for
    // a panel that is removed without a successor ever being created.
    if (sessPanelLive && !sessPanelLive.node.isConnected) {
      sessPanelLive.unsub();
      sessPanelLive.unsubVis();
      sessPanelLive = null;
    }
    const unsub = BT.session.subscribe(() => {
      if (!node.isConnected) { unsub(); return; }
      update();
    });
    const unsubVis = statsToggle.subscribe(() => {
      if (!node.isConnected) { unsubVis(); return; }
      node.classList.toggle("hidden", !statsToggle.isVisible());
    });
    sessPanelLive = { node, unsub, unsubVis };
    update();
    return node;
  }

  // --- Snappy-reveal motion helpers --------------------------------------
  // Games start outcome-free motion the instant the user taps and fire the
  // network request behind it. We NEVER know the result ahead of the server
  // (the active server seed is secret, so the client cannot compute the roll),
  // so the pre-reveal window is pure motion — there is nothing predicted to
  // roll back. When the response lands we reveal the real frame with an
  // ease-out. `nowMs` is a monotonic clock; `frame(ms)` resolves after ms;
  // `hold(startedAt, minMs)` waits out whatever remains of a minimum motion
  // window so a fast network never cuts the animation short.
  const nowMs = () => (window.performance && performance.now ? performance.now() : Date.now());
  const frame = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms || 0)));
  const hold = (startedAt, minMs) => frame((minMs || 0) - (nowMs() - startedAt));

  BT.games.common = {
    register,
    maxBet,
    betControl,
    gameHeader,
    seedBox,
    resultBanner,
    resultOverlay,
    sessionPanel,
    statsToggle,
    syncBalance,
    winLines,
    winMult,
    errText,
    nowMs,
    frame,
    hold,
  };
})();
