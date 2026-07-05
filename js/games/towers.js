// Towers — climb floors, avoid the trap on each floor. /step + /cashout.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const DIFF = { easy: 4, medium: 3, hard: 2 };
  const FLOORS = 8;

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let roundId = null, busy = false, ended = true, curFloor = 0, cols = 3;

    const diffSel = el("select", null, [
      el("option", { value: "easy" }, "Easy (4 cols)"),
      el("option", { value: "medium" }, "Medium (3 cols)"),
      el("option", { value: "hard" }, "Hard (2 cols)"),
    ]);
    diffSel.value = "medium";

    const tower = el("div", { class: "towers" });
    const multEl = el("div", { class: "small muted center" }, "");
    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const cashBtn = el("button", { class: "btn good block", style: "display:none" }, "Cash out");

    function buildTower() {
      BT.ui.clear(tower);
      for (let f = 0; f < FLOORS; f++) {
        const floor = el("div", { class: "tower-floor", style: "grid-template-columns:repeat(" + cols + ",1fr)", dataset: { f: String(f) } });
        for (let c = 0; c < cols; c++) {
          const cell = el("div", { class: "cell disabled", dataset: { f: String(f), c: String(c) } }, "");
          cell.addEventListener("click", () => pick(f, c));
          floor.appendChild(cell);
        }
        tower.appendChild(floor);
      }
    }

    function enableFloor(f) {
      tower.querySelectorAll(".cell").forEach((cell) => {
        const cf = parseInt(cell.dataset.f, 10);
        cell.classList.toggle("disabled", cf !== f);
      });
    }

    startBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; startBtn.disabled = true;
      banner.hide(); seed.reset(); multEl.textContent = "";
      cols = DIFF[diffSel.value] || 3; curFloor = 0; buildTower();
      const resp = await BT.api.gameBet("towers", { bet: bet.getBet(), client_seed: C.clientSeed(), params: { difficulty: diffSel.value } });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id; ended = false;
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      startBtn.style.display = "none"; cashBtn.style.display = "block"; bet.input.disabled = diffSel.disabled = true;
      enableFloor(0);
    });

    async function pick(f, c) {
      if (busy || ended || !roundId || f !== curFloor) return;
      busy = true; enableFloor(-1);
      const resp = await BT.api.gameStep("towers", { round_id: roundId, move: { floor: f, choice: c } });
      busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); enableFloor(curFloor); return; }
      const os = resp.outcome_step || {};
      const safe = os.safe !== undefined ? os.safe : !resp.busted;
      const floorEl = tower.querySelector('.tower-floor[data-f="' + f + '"]');
      const chosen = floorEl && floorEl.querySelector('.cell[data-c="' + c + '"]');
      // Mark traps if the server revealed them.
      const traps = os.trap_positions || os.traps || (os.trap !== undefined ? [os.trap] : null);
      if (floorEl && Array.isArray(traps)) {
        traps.forEach((tc) => {
          const tcell = floorEl.querySelector('.cell[data-c="' + tc + '"]');
          if (tcell) { tcell.classList.add("mine"); tcell.textContent = "✕"; }
        });
      }
      if (chosen) { chosen.classList.add(safe ? "safe" : "mine"); chosen.textContent = safe ? "✓" : "✕"; }
      if (resp.multiplier) multEl.textContent = "Current: " + (Math.round(resp.multiplier * 100) / 100) + "×";
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
      startBtn.style.display = "block"; cashBtn.style.display = "none"; bet.input.disabled = diffSel.disabled = false;
      seed.revealSeed(resp.server_seed);
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { banner.show("win", "Cashed out +" + BT.ui.fmt(payout) + " pts"); BT.ui.haptic("success"); }
      else { banner.show("lose", "Trapped! Run over."); BT.ui.haptic("error"); }
    }

    buildTower();
    root.appendChild(el("div", { class: "card" }, [
      el("h3", null, "▲ Towers"),
      el("p", { class: "small muted" }, "Climb floor by floor. Pick a safe tile each floor to grow your multiplier; a trap ends the run. Cash out any time."),
      el("div", { class: "field" }, [el("label", null, "Difficulty"), diffSel]),
      tower,
      multEl,
      bet.node,
      startBtn,
      cashBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "towers", title: "Towers", icon: "▲", render });
})();
