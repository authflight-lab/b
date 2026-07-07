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
    let stake = 0;
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let roundId = null, busy = false, ended = true, curFloor = 0, cols = 3, climbedCount = 0, lastBadge = null;

    const diffSel = el("select", null, [
      el("option", { value: "easy" }, "Easy (4 tiles)"),
      el("option", { value: "medium" }, "Medium (3 tiles)"),
      el("option", { value: "hard" }, "Hard (2 tiles)"),
    ]);
    diffSel.value = "medium";

    const tower = el("div", { class: "towers" });
    const shaft = el("div", { class: "tower-shaft" }, tower);
    const overlay = C.resultOverlay(shaft);

    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const cashBtn = el("button", { class: "btn primary block", style: "display:none" }, "Cash out");
    const pickBtn = el("button", { class: "btn block", style: "display:none" }, "Pick Random");

    function buildTower() {
      lastBadge = null;
      BT.ui.clear(tower);
      for (let f = 0; f < FLOORS; f++) {
        const floor = el("div", {
          class: "tower-floor dim",
          style: "grid-template-columns:repeat(" + cols + ",minmax(0,1fr))",
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
      overlay.hide(); banner.hide(); seed.reset();
      cols = DIFF[diffSel.value] || 3; curFloor = 0; buildTower();
      stake = bet.getBet();
      const resp = await BT.api.gameBet("towers", { bet: stake, params: { difficulty: diffSel.value } });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id; ended = false; climbedCount = 0;
      BT.setActiveGame("towers", roundId);
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce); BT.fair.noteBet(resp);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      startBtn.style.display = "none"; cashBtn.style.display = "block"; pickBtn.style.display = "block";
      // Must climb at least one floor before cashing out.
      cashBtn.disabled = true;
      bet.setDisabled(true); diffSel.disabled = true;
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
        if (safe) {
          chosen.classList.add("safe");
          chosen._icon.textContent = GEM;
        } else {
          chosen.classList.add("mine", "hit", "collapse");
          chosen._icon.textContent = "";
          shatterCell(chosen);
        }
      }
      if (resp.multiplier && safe && chosen) {
        if (lastBadge && lastBadge !== chosen) {
          lastBadge.classList.remove("mult-current");
          lastBadge._badge.textContent = "";
        }
        chosen._badge.textContent = resp.multiplier.toFixed(2) + "x";
        chosen.classList.add("mult-current");
        lastBadge = chosen;
      }
      if (resp.busted) {
        ended = true; enableFloor(-1);
        BT.ui.haptic("error");
        await new Promise((r) => setTimeout(r, 820));
        finish(resp);
        return;
      }
      if (resp.done || f >= FLOORS - 1) { finish(resp); return; }
      climbedCount++; cashBtn.disabled = false;
      curFloor = f + 1; enableFloor(curFloor); BT.ui.haptic("light");
    }

    function shatterCell(cell) {
      // Break the trap tile into 8 triangular shards fanned from the center
      // that fall/rotate away, so the red tile appears to crumble and collapse.
      const pts = [[0,0],[50,0],[100,0],[100,50],[100,100],[50,100],[0,100],[0,50]];
      for (let k = 0; k < pts.length; k++) {
        const p1 = pts[k], p2 = pts[(k + 1) % pts.length];
        const poly = "polygon(50% 50%, " + p1[0] + "% " + p1[1] + "%, " + p2[0] + "% " + p2[1] + "%)";
        const sh = document.createElement("div");
        sh.className = "mine-shard";
        sh.style.clipPath = poly;
        sh.style.webkitClipPath = poly;
        const ccx = (50 + p1[0] + p2[0]) / 3, ccy = (50 + p1[1] + p2[1]) / 3;
        const dx = ccx - 50, dy = ccy - 50;
        const mag = Math.hypot(dx, dy) || 1;
        const dist = 8 + Math.random() * 10;
        sh.style.setProperty("--tx", (dx / mag * dist).toFixed(1) + "px");
        sh.style.setProperty("--ty", (dy / mag * dist).toFixed(1) + "px");
        sh.style.setProperty("--rot", (Math.random() * 80 - 40).toFixed(0) + "deg");
        sh.style.animationDelay = (Math.random() * 0.12).toFixed(2) + "s";
        cell.appendChild(sh);
      }
    }

    function pickRandom() {
      if (busy || ended || !roundId) return;
      const floorEl = tower.querySelector('.tower-floor[data-f="' + curFloor + '"]');
      if (!floorEl) return;
      const open = [];
      floorEl.querySelectorAll(".cell").forEach((cell) => {
        if (!cell.classList.contains("safe") && !cell.classList.contains("mine")) {
          open.push(parseInt(cell.dataset.c, 10));
        }
      });
      if (!open.length) return;
      pick(curFloor, open[Math.floor(Math.random() * open.length)]);
    }
    pickBtn.addEventListener("click", pickRandom);

    cashBtn.addEventListener("click", async () => {
      if (busy || ended || !roundId) return; busy = true; cashBtn.disabled = true;
      const resp = await BT.api.gameCashout("towers", { round_id: roundId });
      cashBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      finish(resp);
    });

    function finish(resp) {
      ended = true; roundId = null; BT.clearActiveGame(); enableFloor(-1);
      startBtn.style.display = "block"; cashBtn.style.display = "none"; pickBtn.style.display = "none";
      bet.setDisabled(false); diffSel.disabled = false;
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { overlay.show("win", C.winMult(resp.multiplier, payout, stake), C.winLines(payout, stake)); BT.ui.haptic("success"); }
      else { overlay.show("lose", "0x", "Trapped!"); BT.ui.haptic("error"); }
    }

    buildTower();
    root.appendChild(el("div", { class: "card" }, [
      C.gameHeader("towers", "Towers", "Climb floor by floor. Pick a safe gem on each floor to grow your multiplier; a trap ends the run. Cash out any time."),
      el("div", { class: "field" }, [el("label", null, "Risk"), diffSel]),
      shaft,
      bet.node,
      startBtn,
      cashBtn,
      pickBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "towers", title: "Towers", render });
})();
