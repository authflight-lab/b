// HighLow — guess if the next card is higher-or-same or lower-or-same. /step + /cashout.
// Ranks are 1..13 (A..K); a TIE counts as a WIN for the picked side (Rainbet rule).
// The per-direction multiplier and probability shown are a PREVIEW from the game's
// published formula (p_hi=(14-r)/13, p_lo=r/13, step factor (1-EPS)/p); the real
// payout is always the server's chain multiplier from the settle/cashout response.
// Both sides are always >= 1/13, so neither is ever 0%. Suit glyphs are decorative.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const EPS = 0.01;
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
    const seed = C.seedBox();
    const banner = C.resultBanner();

    let roundId = null, busy = false, ended = true;
    let rank = 0, mult = 1.0, step = 0;
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

    // --- Probability bar ----------------------------------------------------
    const loPct = el("span", { class: "hl-prob-pct" }, "—");
    const hiPct = el("span", { class: "hl-prob-pct" }, "—");
    const probBar = el("div", { class: "hl-prob" }, [
      el("div", { class: "hl-prob-half lo" }, [el("span", { class: "hl-prob-label" }, "Lower / Same"), loPct]),
      el("div", { class: "hl-prob-half hi" }, [el("span", { class: "hl-prob-label" }, "Higher / Same"), hiPct]),
    ]);

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
        return;
      }
      const ph = pHi(rank), pl = pLo(rank);
      const canHi = ph > 0, canLo = pl > 0;
      hiMult.textContent = canHi ? (mult * stepFactor(ph)).toFixed(2) + "×" : "—";
      loMult.textContent = canLo ? (mult * stepFactor(pl)).toFixed(2) + "×" : "—";
      hiPct.textContent = (ph * 100).toFixed(2) + "%";
      loPct.textContent = (pl * 100).toFixed(2) + "%";
      hiBtn.disabled = !playable || !canHi;
      loBtn.disabled = !playable || !canLo;
      hiBtn.classList.toggle("locked", !playable);
      loBtn.classList.toggle("locked", !playable);
    }

    // --- Actions ------------------------------------------------------------
    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const cashBtn = el("button", { class: "btn primary block", style: "display:none" }, "Cash out");

    startBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; startBtn.disabled = true;
      banner.hide(); seed.reset();
      const resp = await BT.api.gameBet("highlow", { bet: bet.getBet(), client_seed: C.clientSeed(), params: {} });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id; ended = false;
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      rank = (resp.params && resp.params.start_card) || 1;
      mult = 1.0; step = 0;
      history.length = 0;
      history.push({ rank, step, badge: "start", label: "Start", dir: null });
      renderHistory();
      setCard(rank, true);
      refreshOdds(true);
      startBtn.style.display = "none"; cashBtn.style.display = "block"; bet.input.disabled = true;
    });

    async function guess(dir) {
      if (busy || ended || !roundId) return; busy = true;
      hiBtn.disabled = loBtn.disabled = cashBtn.disabled = true;
      const resp = await BT.api.gameStep("highlow", { round_id: roundId, move: { guess: dir } });
      busy = false;
      if (!resp || resp.ok === false) {
        BT.ui.toast(C.errText(resp), "error");
        cashBtn.disabled = false; refreshOdds(true); return;
      }
      const os = resp.outcome_step || {};
      const drawn = os.drawn !== undefined ? os.drawn : os.next_card !== undefined ? os.next_card : os.card;
      const won = os.win !== undefined ? os.win : !resp.busted;
      const newStep = step + 1;
      if (drawn !== undefined) {
        step = newStep;
        setCard(drawn, true);
        if (won) {
          mult = typeof resp.multiplier === "number" ? resp.multiplier : mult;
          history.push({ rank: drawn, step, badge: "win", label: mult.toFixed(2) + "×", dir });
          rank = drawn;
        } else {
          history.push({ rank: drawn, step, badge: "bust", label: "0.00×", dir });
        }
        renderHistory();
      }
      if (resp.busted || resp.done) { finish(resp, won); return; }
      cashBtn.disabled = false;
      refreshOdds(true);
      BT.ui.haptic("light");
    }

    // Direction naming: backend expects "higher"/"lower".
    hiBtn.addEventListener("click", () => guess("higher"));
    loBtn.addEventListener("click", () => guess("lower"));

    cashBtn.addEventListener("click", async () => {
      if (busy || ended || !roundId) return; busy = true; cashBtn.disabled = true;
      const resp = await BT.api.gameCashout("highlow", { round_id: roundId });
      busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); cashBtn.disabled = false; return; }
      finish(resp, true);
    });

    function finish(resp, won) {
      ended = true; roundId = null;
      startBtn.style.display = "block"; cashBtn.style.display = "none"; cashBtn.disabled = false;
      bet.input.disabled = false;
      refreshOdds(false);
      seed.revealSeed(resp.server_seed);
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { banner.show("win", "Cashed out +" + BT.ui.fmt(payout) + " pts"); BT.ui.haptic("success"); }
      else { banner.show("lose", "Wrong call — round over."); BT.ui.haptic("error"); }
    }

    renderHistory();
    refreshOdds(false);
    root.appendChild(el("div", { class: "card" }, [
      el("h3", { class: "game-title" }, [BT.ui.icon("highlow", 22), el("span", null, "HighLow")]),
      el("p", { class: "small muted" }, "Guess whether the next card is higher-or-same or lower-or-same than the current one. Each correct call chains your multiplier — a tie counts in your favor. Cash out any time."),
      histEl,
      board,
      probBar,
      bet.node,
      startBtn,
      cashBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "highlow", title: "HighLow", render });
})();
