// Mines — 5x5 grid. Reveal safe cells; hitting a mine busts. /step + /cashout.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let roundId = null, busy = false, ended = true;

    const mineSel = el("select", null, [1, 3, 5, 10, 24].map((m) => el("option", { value: String(m) }, m + " mines")));
    mineSel.value = "3";

    const cells = [];
    const grid = el("div", { class: "grid-cells", style: "grid-template-columns:repeat(5,1fr)" });
    for (let i = 0; i < 25; i++) {
      const c = el("div", { class: "cell disabled", dataset: { i: String(i) } });
      c.addEventListener("click", () => reveal(i));
      cells.push(c);
      grid.appendChild(c);
    }

    const multEl = el("div", { class: "small muted center" }, "");
    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const cashBtn = el("button", { class: "btn good block", style: "display:none" }, "Cash out");

    function lockGrid(locked) {
      cells.forEach((c) => c.classList.toggle("disabled", locked));
    }
    lockGrid(true);

    startBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; startBtn.disabled = true;
      banner.hide(); seed.reset(); multEl.textContent = "";
      cells.forEach((c) => { c.className = "cell disabled"; c.textContent = ""; });
      const resp = await BT.api.gameBet("mines", { bet: bet.getBet(), client_seed: C.clientSeed(), params: { mines: parseInt(mineSel.value, 10) } });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id; ended = false;
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      startBtn.style.display = "none"; cashBtn.style.display = "block"; bet.input.disabled = mineSel.disabled = true;
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
      cells[i].textContent = isMine ? "⊗" : "◆";
      if (resp.multiplier) multEl.textContent = "Current: " + (Math.round(resp.multiplier * 100) / 100) + "×";
      if (resp.busted || resp.done) { finish(resp); }
      else { BT.ui.haptic("light"); lockGrid(false); }
    }

    cashBtn.addEventListener("click", async () => {
      if (busy || ended || !roundId) return; busy = true; cashBtn.disabled = true;
      const resp = await BT.api.gameCashout("mines", { round_id: roundId });
      cashBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      finish(resp);
    });

    function finish(resp) {
      ended = true; roundId = null; lockGrid(true);
      startBtn.style.display = "block"; cashBtn.style.display = "none"; bet.input.disabled = mineSel.disabled = false;
      seed.revealSeed(resp.server_seed);
      // Reveal full mine layout if provided.
      const o = resp.outcome || {};
      const mines = o.mines || o.mine_positions;
      if (Array.isArray(mines)) {
        mines.forEach((idx) => {
          if (cells[idx] && !cells[idx].classList.contains("mine")) {
            cells[idx].classList.remove("disabled"); cells[idx].classList.add("mine"); cells[idx].textContent = "⊗";
          }
        });
      }
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { banner.show("win", "Cashed out +" + BT.ui.fmt(payout) + " pts"); BT.ui.haptic("success"); }
      else { banner.show("lose", "Boom! Hit a mine."); BT.ui.haptic("error"); }
    }

    root.appendChild(el("div", { class: "card" }, [
      el("h3", { class: "game-title" }, [BT.ui.icon("mines", 22), el("span", null, "Mines")]),
      el("p", { class: "small muted" }, "Reveal gems to grow your multiplier. Hit a mine and you lose. Cash out whenever."),
      el("div", { class: "field" }, [el("label", null, "Mines"), mineSel]),
      grid,
      multEl,
      bet.node,
      startBtn,
      cashBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "mines", title: "Mines", render });
})();
