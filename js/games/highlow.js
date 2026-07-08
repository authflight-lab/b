// HighLow — guess if the next card is higher-or-same or lower-or-same. /step + /cashout.
// Ranks are 1..13 (A..K); a TIE counts as a WIN for the picked side (Rainbet rule).
// The per-direction multiplier and probability shown are a PREVIEW from the game's
// published formula (p_hi=(14-r)/13, p_lo=r/13, step factor (1-EPS)/p, EPS=0.02);
// the real payout is always the server's chain multiplier from settle/cashout.
// A direction is disabled when it can't grow the chain (step factor <= 1, i.e. a
// guaranteed win at K-lower / A-higher). Suit glyphs are decorative.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const EPS = 0.02; // HighLow-specific house edge (matches api/game/highlow.py HL_EPS)
  const HL_MAX_MULT = 25; // chain multiplier cap (matches api/game/highlow.py HL_MAX_MULT)
  const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const SUITS = [
    { g: "♠", red: false },
    { g: "♥", red: true },
    { g: "♦", red: true },
    { g: "♣", red: false },
  ];
  const rankLabel = (r) => RANKS[r] || "?";
  const suitFor = (r, step) => SUITS[(r * 3 + step * 5 + 1) % 4]; // deterministic, cosmetic
  const pHi = (r) => (14 - r) / 13;
  const pLo = (r) => r / 13;
  const stepFactor = (p) => (p > 0 ? (1 - EPS) / p : 0);

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    let stake = 0;
    const seed = C.seedBox();
    const banner = C.resultBanner();

    let roundId = null, busy = false, ended = true;
    let rank = 0, mult = 1.0, step = 0;
    let picks = 0, skips = 0; // picks gate cashout; skips capped at MAX_SKIPS in a row
    const MAX_SKIPS = 5;
    const history = []; // { rank, step, badge:"start"|"win"|"bust", label, dir }

    // --- History strip ------------------------------------------------------
    const histEl = el("div", { class: "hl-history" });
    function miniCard(r, st) {
      const su = suitFor(r, st);
      return el("div", { class: "hl-hist-card " + (su.red ? "red" : "black") }, [
        el("span", null, rankLabel(r)),
        el("span", null, su.g),
      ]);
    }
    function renderHistory() {
      BT.ui.clear(histEl);
      if (!history.length) {
        histEl.appendChild(el("span", { class: "small muted" }, "Place a bet to start the run."));
        return;
      }
      history.forEach((h, i) => {
        if (h.dir) {
          histEl.appendChild(el("div", { class: "hl-hist-arrow" }, h.dir === "higher" ? "▲" : "▼"));
        }
        histEl.appendChild(
          el("div", { class: "hl-hist-item" }, [
            el("div", { class: "hl-hist-badge " + h.badge }, h.label),
            miniCard(h.rank, h.step),
          ])
        );
      });
      histEl.scrollLeft = histEl.scrollWidth;
    }

    // --- Board (card + two sides) -------------------------------------------
    const cardRankMain = el("div", { class: "hl-rank-main" }, "?");
    const cornerTL = el("div", { class: "hl-corner tl" }, "?");
    const cornerBR = el("div", { class: "hl-corner br" }, "?");
    const cardEl = el("div", { class: "hl-card" }, [cornerTL, cardRankMain, cornerBR]);

    const loArrow = el("div", { class: "hl-arrow" }, "▼");
    const loMult = el("div", { class: "hl-mult" }, "—");
    const loBtn = el("button", { class: "hl-side lo", type: "button" }, [
      loArrow, el("div", { class: "hl-dir" }, "Lower / Same"), loMult,
    ]);
    const hiArrow = el("div", { class: "hl-arrow" }, "▲");
    const hiMult = el("div", { class: "hl-mult" }, "—");
    const hiBtn = el("button", { class: "hl-side hi", type: "button" }, [
      hiArrow, el("div", { class: "hl-dir" }, "Higher / Same"), hiMult,
    ]);
    const board = el("div", { class: "hl-board" }, [loBtn, cardEl, hiBtn]);
    const overlay = C.resultOverlay(board);

    // --- Probability bar ----------------------------------------------------
    const loPct = el("span", { class: "hl-prob-pct" }, "—");
    const hiPct = el("span", { class: "hl-prob-pct" }, "—");
    const loProb = el("button", { class: "hl-prob-half lo", type: "button" }, [
      el("span", { class: "hl-prob-label" }, "Lower / Same"), loPct,
    ]);
    const hiProb = el("button", { class: "hl-prob-half hi", type: "button" }, [
      el("span", { class: "hl-prob-label" }, "Higher / Same"), hiPct,
    ]);
    const probBar = el("div", { class: "hl-prob" }, [loProb, hiProb]);

    function setCard(r, animate) {
      const su = suitFor(r, step);
      cardEl.className = "hl-card " + (su.red ? "red" : "black");
      cardRankMain.innerHTML = "";
      cardRankMain.appendChild(el("span", null, rankLabel(r)));
      cardRankMain.appendChild(el("span", { class: "hl-suit" }, su.g));
      cornerTL.innerHTML = ""; cornerBR.innerHTML = "";
      cornerTL.appendChild(el("span", null, rankLabel(r)));
      cornerTL.appendChild(el("span", { class: "hl-suit" }, su.g));
      cornerBR.appendChild(el("span", null, rankLabel(r)));
      cornerBR.appendChild(el("span", { class: "hl-suit" }, su.g));
      if (animate) {
        cardEl.classList.remove("flip");
        void cardEl.offsetWidth;
        cardEl.classList.add("flip");
      }
    }

    // Refresh the side previews + probability bar for the current rank/mult.
    function refreshOdds(playable) {
      if (rank < 1) {
        hiMult.textContent = loMult.textContent = "—";
        hiPct.textContent = loPct.textContent = "—";
        hiBtn.disabled = loBtn.disabled = true;
        hiBtn.classList.add("locked"); loBtn.classList.add("locked");
        hiProb.disabled = loProb.disabled = true;
        return;
      }
      const ph = pHi(rank), pl = pLo(rank);
      const fHi = stepFactor(ph), fLo = stepFactor(pl);
      // A side is playable only if it can grow the chain (factor > 1) AND would
      // not push the multiplier past the cap.
      const capHi = mult * fHi <= HL_MAX_MULT + 1e-9;
      const capLo = mult * fLo <= HL_MAX_MULT + 1e-9;
      const okHi = fHi > 1 && capHi, okLo = fLo > 1 && capLo;
      hiMult.textContent = fHi <= 1 ? "Sure win" : !capHi ? "Max reached" : (mult * fHi).toFixed(2) + "×";
      loMult.textContent = fLo <= 1 ? "Sure win" : !capLo ? "Max reached" : (mult * fLo).toFixed(2) + "×";
      hiPct.textContent = (ph * 100).toFixed(2) + "%";
      loPct.textContent = (pl * 100).toFixed(2) + "%";
      hiBtn.disabled = !playable || !okHi;
      loBtn.disabled = !playable || !okLo;
      hiBtn.classList.toggle("locked", !playable || !okHi);
      loBtn.classList.toggle("locked", !playable || !okLo);
      hiProb.disabled = !playable || !okHi;
      loProb.disabled = !playable || !okLo;
    }

    // --- Actions ------------------------------------------------------------
    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const cashBtn = el("button", { class: "btn primary block", style: "display:none" }, "Cash out");
    const skipBtn = el("button", { class: "btn block", style: "display:none" }, "Skip card");

    // Cashout needs >= 1 real pick; skip is capped at MAX_SKIPS in a row. Called
    // whenever the round is idle-and-active to reflect both limits in the buttons.
    function syncActions(active) {
      if (!active) { cashBtn.disabled = true; skipBtn.disabled = true; return; }
      cashBtn.disabled = picks < 1;
      const left = MAX_SKIPS - skips;
      skipBtn.disabled = left <= 0;
      skipBtn.textContent = left > 0 ? "Skip card · " + left + " left" : "No skips left";
    }

    startBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; startBtn.disabled = true;
      overlay.hide(); banner.hide(); seed.reset();
      stake = bet.getBet();
      const resp = await BT.api.gameBet("highlow", { bet: stake, params: {} });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id; ended = false;
      BT.setActiveGame("highlow", roundId);
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce); BT.fair.noteBet(resp);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      rank = (resp.params && resp.params.start_card) || 1;
      mult = 1.0; step = 0;
      history.length = 0;
      history.push({ rank, step, badge: "start", label: "Start", dir: null });
      renderHistory();
      setCard(rank, true);
      refreshOdds(true);
      startBtn.style.display = "none"; cashBtn.style.display = "block"; bet.setDisabled(true);
      skipBtn.style.display = "block";
      picks = 0; skips = 0;
      syncActions(true);
    });

    async function guess(dir) {
      if (busy || ended || !roundId) return; busy = true;
      hiBtn.disabled = loBtn.disabled = cashBtn.disabled = skipBtn.disabled = true;
      hiProb.disabled = loProb.disabled = true;
      const resp = await BT.api.gameStep("highlow", { round_id: roundId, move: { guess: dir } });
      busy = false;
      if (!resp || resp.ok === false) {
        BT.ui.toast(C.errText(resp), "error");
        syncActions(true); refreshOdds(true); return;
      }
      const os = resp.outcome_step || {};
      const drawn = os.drawn !== undefined ? os.drawn : os.next_card !== undefined ? os.next_card : os.card;
      const won = os.win !== undefined ? os.win : !resp.busted;
      // On a win the server tells us the new current card; a wild reveal (Ace/King)
      // passes through, so `current` may differ from the revealed `drawn` card.
      const current = os.current !== undefined ? os.current : drawn;
      const wild = won && current !== drawn;
      const newStep = step + 1;
      if (drawn !== undefined) {
        step = newStep;
        setCard(drawn, true);
        if (won) {
          picks += 1; skips = 0; // a real pick resets the skip allowance
          mult = typeof resp.multiplier === "number" ? resp.multiplier : mult;
          history.push({ rank: drawn, step, badge: "win", label: mult.toFixed(2) + "×", dir });
          rank = current;
        } else {
          history.push({ rank: drawn, step, badge: "bust", label: "0.00×", dir });
        }
        renderHistory();
      }
      if (resp.busted || resp.done) { finish(resp, won); return; }
      syncActions(true);
      BT.ui.haptic("light");
      if (wild) {
        // Reveal the wild card, then flip through to the fresh current card.
        hiBtn.disabled = loBtn.disabled = hiProb.disabled = loProb.disabled = true;
        setTimeout(() => { if (!ended && roundId) { setCard(current, true); refreshOdds(true); } }, 550);
      } else {
        refreshOdds(true);
      }
    }

    // Direction naming: backend expects "higher"/"lower".
    hiBtn.addEventListener("click", () => guess("higher"));
    loBtn.addEventListener("click", () => guess("lower"));
    hiProb.addEventListener("click", () => guess("higher"));
    loProb.addEventListener("click", () => guess("lower"));

    cashBtn.addEventListener("click", async () => {
      if (busy || ended || !roundId) return; busy = true; cashBtn.disabled = true;
      const resp = await BT.api.gameCashout("highlow", { round_id: roundId });
      busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); cashBtn.disabled = false; return; }
      finish(resp, true);
    });

    // Skip: swap the current card for a fresh one without wagering. The chain
    // multiplier is unchanged; useful when the current card gives a poor edge.
    // Capped at MAX_SKIPS in a row — after that a side must be picked.
    async function skipCard() {
      if (busy || ended || !roundId) return; busy = true;
      hiBtn.disabled = loBtn.disabled = cashBtn.disabled = skipBtn.disabled = true;
      hiProb.disabled = loProb.disabled = true;
      const resp = await BT.api.gameStep("highlow", { round_id: roundId, move: { skip: true } });
      busy = false;
      if (!resp || resp.ok === false) {
        BT.ui.toast(C.errText(resp), "error");
        syncActions(true); refreshOdds(true); return;
      }
      const os = resp.outcome_step || {};
      const current = os.current;
      if (typeof current === "number") {
        step += 1;
        skips += 1;
        rank = current;
        setCard(current, true);
        history.push({ rank: current, step, badge: "skip", label: "Skip", dir: null });
        renderHistory();
      }
      syncActions(true);
      BT.ui.haptic("light");
      refreshOdds(true);
    }
    skipBtn.addEventListener("click", skipCard);

    function finish(resp, won) {
      ended = true; roundId = null; BT.clearActiveGame();
      startBtn.style.display = "block"; cashBtn.style.display = "none"; cashBtn.disabled = false;
      skipBtn.style.display = "none"; skipBtn.disabled = false;
      bet.setDisabled(false);
      refreshOdds(false);
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { overlay.show("win", C.winMult(resp.multiplier, payout, stake), C.winLines(payout, stake)); BT.ui.haptic("success"); }
      else { banner.show("lose", "Wrong call \u00b7 0\u00d7"); BT.ui.haptic("error"); }
    }

    renderHistory();
    refreshOdds(false);
    root.appendChild(el("div", { class: "card" }, [
      C.gameHeader("highlow", "HighLow", "Guess whether the next card is higher-or-same or lower-or-same. Each correct call chains your multiplier and a tie counts in your favor. Aces and Kings are wild — they pass through to a fresh card. Skip up to 5 times in a row to swap the current card without betting, then you must pick a side. Cash out any time after your first pick."),
      histEl,
      board,
      probBar,
      skipBtn,
      bet.node,
      startBtn,
      cashBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "highlow", title: "HighLow", render });
})();
