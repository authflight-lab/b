// Mines — 5x5 grid. Reveal safe cells; hitting a mine busts. /step + /cashout.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const TOTAL = 25;
  const MIN_MINES = 1;
  const MAX_MINES = 24;

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let roundId = null, busy = false, ended = true, minesCount = 3, revealedCount = 0, lastBadge = null;

    // Mine-count slider — gems on one end, bombs on the other (arbitrary 1-24, server-validated).
    const gemsEnd = el("span", { class: "msr-end gems" }, "\uD83D\uDC8E " + (TOTAL - minesCount));
    const bombsEnd = el("span", { class: "msr-end bombs" }, minesCount + " \uD83D\uDCA3");
    const range = el("input", {
      type: "range", min: String(MIN_MINES), max: String(MAX_MINES), step: "1",
      value: String(minesCount), class: "mines-range",
    });
    function syncSliderVisual() {
      const pct = ((minesCount - MIN_MINES) / (MAX_MINES - MIN_MINES)) * 100;
      range.style.setProperty("--fill", pct + "%");
      gemsEnd.textContent = "\uD83D\uDC8E " + (TOTAL - minesCount);
      bombsEnd.textContent = minesCount + " \uD83D\uDCA3";
    }
    syncSliderVisual();
    range.addEventListener("input", () => {
      minesCount = parseInt(range.value, 10) || MIN_MINES;
      syncSliderVisual();
    });
    const sliderRow = el("div", { class: "mines-slider-row" }, [gemsEnd, range, bombsEnd]);

    const cells = [];
    const grid = el("div", { class: "grid-cells", style: "grid-template-columns:repeat(5,1fr)" });
    for (let i = 0; i < TOTAL; i++) {
      const icon = el("span", { class: "cell-icon" }, "");
      const badge = el("div", { class: "cell-mult" }, "");
      const c = el("div", { class: "cell disabled", dataset: { i: String(i) } }, [icon, badge]);
      c._icon = icon; c._badge = badge;
      c.addEventListener("click", () => reveal(i));
      cells.push(c);
      grid.appendChild(c);
    }

    // Result overlay — shown centred over the grid after each round ends.
    const overlayMult = el("div", { class: "mro-mult" }, "");
    const overlayInner = el("div", { class: "mro-inner" }, [overlayMult]);
    const overlayLabel = el("div", { class: "mro-label" }, "");
    const overlayCard = el("div", { class: "mro-card" }, [overlayInner, overlayLabel]);
    const overlay = el("div", { class: "mines-result-overlay hidden" }, [overlayCard]);
    const gridWrap = el("div", { class: "mines-grid-wrap" }, [grid, overlay]);
    overlay.addEventListener("click", () => overlay.classList.add("hidden"));

    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const cashBtn = el("button", { class: "btn primary block", style: "display:none" }, "Cash out");
    const pickBtn = el("button", { class: "btn block", style: "display:none" }, "Pick Random");

    function lockGrid(locked) {
      cells.forEach((c) => c.classList.toggle("disabled", locked));
    }
    lockGrid(true);

    function resetCells() {
      cells.forEach((c) => {
        c.className = "cell disabled";
        c._icon.textContent = "";
        c._badge.textContent = "";
      });
      lastBadge = null;
      grid.classList.remove("flash-bust", "flash-win");
    }

    startBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; startBtn.disabled = true;
      banner.hide(); overlay.classList.add("hidden"); seed.reset();
      resetCells();
      const resp = await BT.api.gameBet("mines", { bet: bet.getBet(), client_seed: C.clientSeed(), params: { mines: minesCount } });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id; ended = false; revealedCount = 0;
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      startBtn.style.display = "none"; cashBtn.style.display = "block"; pickBtn.style.display = "block";
      // Must reveal at least one tile before cashing out.
      cashBtn.disabled = true;
      bet.input.disabled = range.disabled = true;
      lockGrid(false);
    });

    async function reveal(i) {
      if (busy || ended || !roundId) return;
      if (cells[i].classList.contains("safe") || cells[i].classList.contains("mine")) return;
      busy = true; lockGrid(true);
      const resp = await BT.api.gameStep("mines", { round_id: roundId, move: { cell: i } });
      busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); lockGrid(false); return; }
      const os = resp.outcome_step || {};
      const isMine = os.is_mine !== undefined ? os.is_mine : !!resp.busted;
      cells[i].classList.remove("disabled");
      cells[i].classList.add(isMine ? "mine" : "safe");
      cells[i]._icon.textContent = isMine ? "\uD83D\uDCA3" : "\uD83D\uDC8E";
      if (isMine) cells[i].classList.add("hit");
      // Show the running multiplier as a pill under the last-clicked gem only —
      // clear the previous gem's pill so exactly one is visible at a time.
      if (!isMine && typeof resp.multiplier === "number") {
        if (lastBadge && lastBadge !== cells[i]) {
          lastBadge.classList.remove("mult-current");
          lastBadge._badge.textContent = "";
        }
        cells[i]._badge.textContent = resp.multiplier.toFixed(2) + "x";
        cells[i].classList.add("mult-current");
        lastBadge = cells[i];
      }
      if (resp.busted || resp.done) { finish(resp); }
      else { revealedCount++; cashBtn.disabled = false; BT.ui.haptic("light"); lockGrid(false); }
    }

    function pickRandom() {
      if (busy || ended || !roundId) return;
      const open = [];
      for (let idx = 0; idx < TOTAL; idx++) {
        if (!cells[idx].classList.contains("safe") && !cells[idx].classList.contains("mine")) open.push(idx);
      }
      if (!open.length) return;
      reveal(open[Math.floor(Math.random() * open.length)]);
    }
    pickBtn.addEventListener("click", pickRandom);

    cashBtn.addEventListener("click", async () => {
      if (busy || ended || !roundId) return; busy = true; cashBtn.disabled = true;
      const resp = await BT.api.gameCashout("mines", { round_id: roundId });
      cashBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      finish(resp);
    });

    function finish(resp) {
      ended = true; roundId = null; lockGrid(true);
      startBtn.style.display = "block"; cashBtn.style.display = "none"; pickBtn.style.display = "none";
      bet.input.disabled = range.disabled = false;
      seed.revealSeed(resp.server_seed);
      // Reveal the FULL board: the mine layout tells us every cell's truth —
      // any index not in `mines` is guaranteed safe, so we can show the whole
      // board (like Rainbet's post-round reveal), dimming cells the player
      // never actually clicked so their real picks stay visually distinct.
      const o = resp.outcome || {};
      const mines = o.mines || o.mine_positions;
      const busted = !!resp.busted;
      if (Array.isArray(mines)) {
        const mineSet = new Set(mines);
        for (let idx = 0; idx < TOTAL; idx++) {
          const c = cells[idx];
          if (!c || c.classList.contains("mine") || c.classList.contains("safe")) continue;
          const isMine = mineSet.has(idx);
          c.classList.remove("disabled");
          c.classList.add(isMine ? "mine" : "safe", "reveal-only");
          c._icon.textContent = isMine ? "\uD83D\uDCA3" : "\uD83D\uDC8E";
        }
      }
      grid.classList.add(busted ? "flash-bust" : "flash-win");
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      // A bust wins nothing, so force 0× regardless of the last accumulated value.
      // Otherwise: cashout responses carry the multiplier inside `outcome`, while
      // step-driven auto-cashouts include it at the top level — prefer either.
      const mult = busted ? 0
                 : (typeof resp.multiplier === "number" ? resp.multiplier
                 : (typeof o.multiplier === "number" ? o.multiplier : 0));
      overlayMult.textContent = (Math.round(mult * 100) / 100) + "x";
      if (payout > 0) {
        overlayLabel.textContent = "+" + BT.ui.fmt(payout) + " pts";
        overlayCard.className = "mro-card win";
        BT.ui.haptic("success");
      } else {
        overlayLabel.textContent = "Hit a mine!";
        overlayCard.className = "mro-card lose";
        BT.ui.haptic("error");
      }
      overlay.classList.remove("hidden");
    }

    root.appendChild(el("div", { class: "card" }, [
      el("h3", { class: "game-title" }, [BT.ui.icon("mines", 22), el("span", null, "Mines")]),
      el("p", { class: "small muted" }, "Reveal gems to grow your multiplier. Hit a mine and you lose. Cash out whenever."),
      bet.node,
      el("div", { class: "field" }, [el("label", null, "Number of Mines"), sliderRow]),
      gridWrap,
      startBtn,
      cashBtn,
      pickBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "mines", title: "Mines", render });
})();
