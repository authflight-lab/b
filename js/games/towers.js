// Towers — climb floors, avoid the trap on each floor. /step + /cashout.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const DIFF = { easy: 4, medium: 3, hard: 2 };
  const FLOORS = 8;
  const GEM = "\uD83D\uDC8E";   // 💎 safe gem
  const TRAP = "\uD83D\uDCA5";  // 💥 shattered trap

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let roundId = null, busy = false, ended = true, curFloor = 0, cols = 3;

    const diffSel = el("select", null, [
      el("option", { value: "easy" }, "Easy (4 tiles)"),
      el("option", { value: "medium" }, "Medium (3 tiles)"),
      el("option", { value: "hard" }, "Hard (2 tiles)"),
    ]);
    diffSel.value = "medium";

    const tower = el("div", { class: "towers" });
    const shaft = el("div", { class: "tower-shaft" }, tower);

    const mpValue = el("div", { class: "mp-value" }, "1.00\u00D7");
    const multPanel = el("div", { class: "mult-panel" }, [mpValue, el("div", { class: "mp-label" }, "Current Multiplier")]);

    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const cashBtn = el("button", { class: "btn primary block", style: "display:none" }, "Cash out");

    function buildTower() {
      BT.ui.clear(tower);
      for (let f = 0; f < FLOORS; f++) {
        const floor = el("div", {
          class: "tower-floor dim",
          style: "grid-template-columns:repeat(" + cols + ",1fr)",
          dataset: { f: String(f) },
        });
        for (let c = 0; c < cols; c++) {
          const icon = el("span", { class: "cell-icon" }, GEM);
          const badge = el("span", { class: "cell-mult" }, "");
          const cell = el("div", { class: "cell tower-cell gem-hidden disabled", dataset: { f: String(f), c: String(c) } }, [icon, badge]);
          cell._icon = icon; cell._badge = badge;
          cell.addEventListener("click", () => pick(f, c));
          floor.appendChild(cell);
        }
        tower.appendChild(floor);
      }
    }

    // Light the active floor, dim floors above, keep climbed floors lit, and
    // only allow clicks on unrevealed tiles of the active floor.
    function enableFloor(f) {
      tower.querySelectorAll(".tower-floor").forEach((floorEl) => {
        const cf = parseInt(floorEl.dataset.f, 10);
        const isActive = cf === f;
        const climbed = !!floorEl.querySelector(".cell.safe, .cell.mine");
        floorEl.classList.toggle("active", isActive);
        floorEl.classList.toggle("dim", !isActive && !climbed);
        floorEl.querySelectorAll(".cell").forEach((cell) => {
          const revealed = cell.classList.contains("safe") || cell.classList.contains("mine");
          cell.classList.toggle("disabled", !isActive || revealed);
        });
      });
    }

    startBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; startBtn.disabled = true;
      banner.hide(); seed.reset();
      mpValue.textContent = "1.00\u00D7"; multPanel.classList.remove("active");
      cols = DIFF[diffSel.value] || 3; curFloor = 0; buildTower();
      const resp = await BT.api.gameBet("towers", { bet: bet.getBet(), client_seed: C.clientSeed(), params: { difficulty: diffSel.value } });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id; ended = false;
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      startBtn.style.display = "none"; cashBtn.style.display = "block";
      bet.input.disabled = diffSel.disabled = true;
      multPanel.classList.add("active");
      enableFloor(0);
    });

    async function pick(f, c) {
      if (busy || ended || !roundId || f !== curFloor) return;
      busy = true; enableFloor(-1);
      const resp = await BT.api.gameStep("towers", { round_id: roundId, move: { floor: f, choice: c } });
      busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); enableFloor(curFloor); return; }
      const os = resp.outcome_step || {};
      const outcome = resp.outcome || {};
      const safe = os.safe !== undefined ? os.safe : !resp.busted;
      const floorEl = tower.querySelector('.tower-floor[data-f="' + f + '"]');
      const chosen = floorEl && floorEl.querySelector('.cell[data-c="' + c + '"]');
      // On a bust the real API discloses the floor's trap columns in the
      // top-level `outcome.traps` (not `outcome_step`), so reveal all of them.
      const traps = os.trap_positions || os.traps || outcome.traps || outcome.trap_positions
        || (os.trap !== undefined ? [os.trap] : null);
      if (floorEl && Array.isArray(traps)) {
        traps.forEach((tc) => {
          const tcell = floorEl.querySelector('.cell[data-c="' + tc + '"]');
          if (tcell && tcell !== chosen) {
            tcell.classList.remove("gem-hidden", "disabled");
            tcell.classList.add("mine");
            tcell._icon.textContent = TRAP;
          }
        });
      }
      if (chosen) {
        chosen.classList.remove("gem-hidden");
        chosen.classList.add(safe ? "safe" : "mine");
        chosen._icon.textContent = safe ? GEM : TRAP;
        if (!safe) chosen.classList.add("hit");
      }
      if (resp.multiplier) {
        const m = Math.round(resp.multiplier * 100) / 100;
        mpValue.textContent = m + "\u00D7";
        if (safe && chosen) chosen._badge.textContent = m + "\u00D7";
      }
      if (resp.busted) { finish(resp); return; }
      if (resp.done || f >= FLOORS - 1) { finish(resp); return; }
      curFloor = f + 1; enableFloor(curFloor); BT.ui.haptic("light");
    }

    cashBtn.addEventListener("click", async () => {
      if (busy || ended || !roundId) return; busy = true; cashBtn.disabled = true;
      const resp = await BT.api.gameCashout("towers", { round_id: roundId });
      cashBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      finish(resp);
    });

    function finish(resp) {
      ended = true; roundId = null; enableFloor(-1);
      startBtn.style.display = "block"; cashBtn.style.display = "none";
      bet.input.disabled = diffSel.disabled = false;
      multPanel.classList.remove("active");
      seed.revealSeed(resp.server_seed);
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { banner.show("win", "Cashed out +" + BT.ui.fmt(payout) + " pts"); BT.ui.haptic("success"); }
      else { banner.show("lose", "Trapped! Run over."); BT.ui.haptic("error"); }
    }

    buildTower();
    root.appendChild(el("div", { class: "card" }, [
      el("h3", { class: "game-title" }, [BT.ui.icon("towers", 22), el("span", null, "Towers")]),
      el("p", { class: "small muted" }, "Climb floor by floor. Pick a safe gem on each floor to grow your multiplier; a trap ends the run. Cash out any time."),
      el("div", { class: "field" }, [el("label", null, "Risk"), diffSel]),
      shaft,
      multPanel,
      bet.node,
      startBtn,
      cashBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "towers", title: "Towers", render });
})();
