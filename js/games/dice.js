// Dice — single settle. Client sends a target [2,98]; server rolls & pays.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    const seed = C.seedBox();
    const banner = C.resultBanner();

    const target = el("input", { type: "number", min: "2", max: "98", step: "1", value: "50" });
    const targetOut = el("span", { class: "mono" }, "50");
    target.addEventListener("input", () => {
      let v = parseInt(target.value, 10);
      if (isNaN(v)) v = 50;
      v = Math.max(2, Math.min(98, v));
      targetOut.textContent = String(v);
      marker.style.left = v + "%";
    });

    const face = el("div", { class: "dice-face" }, "🎲");
    const marker = el("div", { class: "dice-marker", style: "left:50%" });
    const meter = el("div", { class: "dice-meter" }, marker);

    const betBtn = el("button", { class: "btn primary block" }, "Roll");
    let busy = false;

    betBtn.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      betBtn.disabled = true;
      banner.hide();
      seed.reset();
      let t = parseInt(target.value, 10);
      t = Math.max(2, Math.min(98, isNaN(t) ? 50 : t));

      const betResp = await BT.api.gameBet("dice", {
        bet: bet.getBet(),
        client_seed: C.clientSeed(),
        params: { target: t },
      });
      if (!betResp || betResp.ok === false) {
        BT.ui.toast(C.errText(betResp), "error");
        busy = false; betBtn.disabled = false; return;
      }
      seed.setHash(betResp.server_hash);
      seed.setNonce(betResp.nonce);
      if (typeof betResp.balance === "number") BT.setBalance(betResp.balance);

      const s = await BT.api.gameSettle("dice", { round_id: betResp.round_id, target: t });
      if (!s || s.ok === false) {
        BT.ui.toast(C.errText(s), "error");
        busy = false; betBtn.disabled = false; return;
      }
      seed.revealSeed(s.server_seed);
      const o = s.outcome || {};
      const roll = o.roll !== undefined ? o.roll : o.result;
      if (typeof roll === "number") {
        marker.style.left = Math.max(0, Math.min(100, roll)) + "%";
        face.textContent = "🎲 " + (Math.round(roll * 100) / 100);
      }
      const win = o.win !== undefined ? o.win : (s.payout || 0) > 0;
      C.syncBalance(s);
      if (win) {
        banner.show("win", "Win! +" + BT.ui.fmt(s.payout) + " pts" + (o.multiplier ? " (" + o.multiplier + "×)" : ""));
        BT.ui.haptic("success");
      } else {
        banner.show("lose", "No win. Roll " + (roll !== undefined ? roll : "?"));
        BT.ui.haptic("error");
      }
      busy = false; betBtn.disabled = false;
    });

    root.appendChild(
      el("div", { class: "card" }, [
        el("h3", null, "🎲 Dice"),
        el("p", { class: "small muted" }, "Pick a target 2–98. You win if the roll lands under your target. Lower target = higher payout."),
        face,
        meter,
        el("div", { class: "field" }, [el("label", null, "Target (win if roll < target)"), target, el("div", { class: "small muted" }, ["Target: ", targetOut])]),
        bet.node,
        betBtn,
        banner.node,
        seed.node,
      ])
    );
  }

  C.register({ key: "dice", title: "Dice", icon: "🎲", render });
})();
