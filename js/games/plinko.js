// Plinko — single settle. Drop a ball; server returns the full path & slot.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let busy = false;

    const rowsSel = el("select", null, [8, 12, 16].map((n) => el("option", { value: String(n) }, n + " rows")));
    rowsSel.value = "12";
    const riskSel = el("select", null, [el("option", { value: "low" }, "Low risk"), el("option", { value: "high" }, "High risk")]);

    const board = el("div", { class: "plinko" });
    const ball = el("div", { class: "plinko-ball", style: "left:50%;top:6px" });
    board.appendChild(ball);
    const slots = el("div", { class: "plinko-slots" });

    function buildSlots(n) {
      BT.ui.clear(slots);
      for (let j = 0; j <= n; j++) slots.appendChild(el("div", { class: "plinko-slot", dataset: { j: String(j) } }, String(j)));
    }
    buildSlots(12);

    const dropBtn = el("button", { class: "btn primary block" }, "Drop");

    async function animatePath(path, n) {
      // path: array of L/R decisions (0/1 or "L"/"R"). Fallback: no animation.
      const steps = Array.isArray(path) ? path : [];
      let pos = n / 2;
      const total = steps.length || n;
      for (let i = 0; i < total; i++) {
        const s = steps[i];
        const goRight = s === 1 || s === "R" || s === "r" || s === true;
        pos += goRight ? 0.5 : -0.5;
        ball.style.left = Math.max(2, Math.min(98, (pos / n) * 100)) + "%";
        ball.style.top = (6 + ((i + 1) / total) * 190) + "px";
        await new Promise((r) => setTimeout(r, 130));
      }
    }

    dropBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; dropBtn.disabled = true;
      banner.hide(); seed.reset();
      const n = parseInt(rowsSel.value, 10);
      buildSlots(n);
      ball.style.left = "50%"; ball.style.top = "6px";

      const betResp = await BT.api.gameBet("plinko", { bet: bet.getBet(), client_seed: C.clientSeed(), params: { rows: n, risk: riskSel.value } });
      if (!betResp || betResp.ok === false) { BT.ui.toast(C.errText(betResp), "error"); busy = false; dropBtn.disabled = false; return; }
      seed.setHash(betResp.server_hash); seed.setNonce(betResp.nonce);
      if (typeof betResp.balance === "number") BT.setBalance(betResp.balance);

      const s = await BT.api.gameSettle("plinko", { round_id: betResp.round_id });
      if (!s || s.ok === false) { BT.ui.toast(C.errText(s), "error"); busy = false; dropBtn.disabled = false; return; }
      seed.revealSeed(s.server_seed);
      const o = s.outcome || {};
      await animatePath(o.path, n);
      const slot = o.slot !== undefined ? o.slot : o.bucket;
      slots.querySelectorAll(".plinko-slot").forEach((el2) => el2.classList.remove("hit"));
      if (slot !== undefined) {
        const hit = slots.querySelector('.plinko-slot[data-j="' + slot + '"]');
        if (hit) { hit.classList.add("hit"); hit.textContent = (o.multiplier ? (Math.round(o.multiplier * 100) / 100) + "×" : slot); ball.style.left = Math.max(2, Math.min(98, (slot / n) * 100)) + "%"; ball.style.top = "196px"; }
      }
      C.syncBalance(s);
      const payout = s.payout || 0;
      if (payout > 0) { banner.show("win", "Win! +" + BT.ui.fmt(payout) + " pts" + (o.multiplier ? " (" + (Math.round(o.multiplier * 100) / 100) + "×)" : "")); BT.ui.haptic("success"); }
      else { banner.show("lose", "No win this drop."); BT.ui.haptic("error"); }
      busy = false; dropBtn.disabled = false;
    });

    root.appendChild(el("div", { class: "card" }, [
      el("h3", null, "▽ Plinko"),
      el("p", { class: "small muted" }, "Drop a ball through the pegs. Where it lands sets your multiplier. More rows and higher risk spread the payouts."),
      el("div", { class: "row" }, [
        el("div", { class: "field grow" }, [el("label", null, "Rows"), rowsSel]),
        el("div", { class: "field grow" }, [el("label", null, "Risk"), riskSel]),
      ]),
      board,
      slots,
      bet.node,
      dropBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "plinko", title: "Plinko", icon: "▽", render });
})();
