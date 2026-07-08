// Crash — solo curve. A multiplier climbs from 1.00x; cash out before the
// server's predetermined crash point to win. The rising curve/counter here is
// COSMETIC (mult(t) = e^(0.00006t)); the server never tracks time — it only
// compares the multiplier you claim at cashout against the seeded crash point,
// so the EV is identical (98%) at every cashout target. The crash point is
// committed via the server hash before the bet and revealed only on bust
// (or verifiable after seed rotation).
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const CAP = 25;              // CRASH_CAP (== global MULT_CAP)
  const MAX_CLAIM = 24.99;     // claiming >= CAP always busts, so stop just under
  const GROWTH = 0.00006;      // mult(t) = e^(GROWTH * t_ms) — cosmetic curve speed
  const RESET_S = 3;           // cosmetic between-round countdown

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    let stake = 0;
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let roundId = null, busy = false, running = false;
    let raf = 0, t0 = 0, points = [];

    // --- Stage: curve + dominant counter ---------------------------------
    const W = 320, H = 150;
    const curve = document.createElementNS("http://www.w3.org/2000/svg", "path");
    curve.setAttribute("class", "crash-curve");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "crash-svg");
    svg.appendChild(curve);
    const counter = el("div", { class: "crash-counter" }, "1.00\u00d7");
    const status = el("div", { class: "crash-status" }, "Place a bet to launch.");
    const stage = el("div", { class: "crash-stage" }, [svg, counter, status]);
    const overlay = C.resultOverlay(stage);

    // Auto-cashout (optional): fires the cashout when the cosmetic counter
    // reaches the target. Empty = manual only.
    const autoInput = el("input", {
      type: "number", min: "1.01", max: String(MAX_CLAIM), step: "0.01",
      placeholder: "e.g. 2.00", class: "crash-auto-input",
    });
    const autoField = el("div", { class: "field crash-auto" }, [
      el("label", null, "Auto cash out (optional)"),
      autoInput,
    ]);

    const betBtn = el("button", { class: "btn primary block" }, "Place bet");
    const cashBtn = el("button", { class: "btn primary block crash-cash", style: "display:none" }, "Cash out");

    function autoTarget() {
      const v = parseFloat(autoInput.value);
      if (isNaN(v) || v <= 1.0) return null;
      return Math.min(v, MAX_CLAIM);
    }

    function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    function counterTone(m) {
      // white → yellow → orange → red as the multiplier climbs.
      return m < 2 ? "" : m < 5 ? " warm" : m < 10 ? " hot" : " red";
    }

    function drawCurve() {
      if (points.length < 2) { curve.setAttribute("d", ""); return; }
      const last = points[points.length - 1];
      const tMax = Math.max(last[0], 1200);
      const mMax = Math.max(last[1], 1.5);
      let d = "";
      for (let i = 0; i < points.length; i++) {
        const x = (points[i][0] / tMax) * W;
        const y = H - 6 - ((points[i][1] - 1) / (mMax - 1)) * (H - 14);
        d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }
      curve.setAttribute("d", d);
    }

    // The climb: pure cosmetic motion — the client CANNOT know the crash point
    // (the active server seed is secret), so the curve just rises until the
    // player cashes out (or the cap auto-fires). Nothing is predicted.
    // `reset` starts a fresh round clock; omit it to RESUME after a transient
    // cashout failure without rewinding t0/points.
    function startLoop(reset) {
      stopLoop();
      if (reset) { t0 = C.nowMs(); points = [[0, 1]]; }
      let lastPt = points.length ? points[points.length - 1][0] : 0;
      running = true;
      (function tick() {
        if (!running) return;
        if (!stage.isConnected) { running = false; stopLoop(); return; } // screen torn down
        const t = C.nowMs() - t0;
        const m = Math.min(Math.exp(GROWTH * t), CAP);
        counter.textContent = m.toFixed(2) + "\u00d7";
        counter.className = "crash-counter live" + counterTone(m);
        cashBtn.textContent = "Cash out \u00b7 " + Math.min(m, MAX_CLAIM).toFixed(2) + "\u00d7";
        if (t - lastPt >= 80) { points.push([t, m]); lastPt = t; drawCurve(); }
        const at = autoTarget();
        if (at !== null && m >= at) { cashout(at, true); return; }
        if (m >= CAP) { cashout(MAX_CLAIM, true); return; } // cap: forced claim just under
        raf = requestAnimationFrame(tick);
      })();
    }

    function freezeAt(m, crashed) {
      running = false;
      stopLoop();
      counter.textContent = m.toFixed(2) + "\u00d7";
      counter.className = "crash-counter " + (crashed ? "crashed" : "cashed");
      if (crashed) {
        stage.classList.add("crash-flash");
        setTimeout(() => stage.classList.remove("crash-flash"), 650);
      }
    }

    // Between rounds: cosmetic countdown before the bet form re-enables.
    function resetCountdown() {
      let s = RESET_S;
      betBtn.style.display = "block"; cashBtn.style.display = "none";
      betBtn.disabled = true;
      status.textContent = "Next round in " + s + "s";
      const iv = setInterval(() => {
        s -= 1;
        if (s <= 0 || !stage.isConnected) {
          clearInterval(iv);
          betBtn.disabled = false;
          status.textContent = "Place a bet to launch.";
          return;
        }
        status.textContent = "Next round in " + s + "s";
      }, 1000);
    }

    function finish(resp, claimed) {
      roundId = null;
      BT.clearActiveGame();
      bet.setDisabled(false); autoInput.disabled = false;
      C.syncBalance(resp);
      const o = resp.outcome || {};
      const payout = resp.payout || 0;
      if (payout > 0) {
        freezeAt(typeof resp.multiplier === "number" ? resp.multiplier : claimed, false);
        overlay.show("win", C.winMult(resp.multiplier, payout, stake), C.winLines(payout, stake));
        BT.ui.haptic("success");
      } else {
        const cp = typeof o.crash_point === "number" ? o.crash_point : claimed;
        freezeAt(cp, true);
        overlay.show("lose", cp.toFixed(2) + "\u00d7", "Crashed before your cashout");
        BT.ui.haptic("error");
      }
      resetCountdown();
    }

    async function cashout(m, auto) {
      if (busy || !roundId) return;
      busy = true;
      cashBtn.disabled = true;
      // Freeze the counter on the claimed value while the server verdict is in
      // flight — the claim is what's being judged, not the still-ticking curve.
      running = false; stopLoop();
      counter.textContent = m.toFixed(2) + "\u00d7";
      const resp = await BT.api.gameCashout("crash", { round_id: roundId, mult_at_cashout: m });
      busy = false;
      cashBtn.disabled = false;
      if (!resp || resp.ok === false) {
        const code = resp && resp.error;
        if (code === "no_open_round" || code === "round_not_open") {
          // Round already closed (e.g. swept) — nothing left to claim.
          BT.ui.toast(C.errText(resp), "error");
          roundId = null; BT.clearActiveGame();
          bet.setDisabled(false); autoInput.disabled = false;
          freezeAt(m, true);
          resetCountdown();
          return;
        }
        // Transient failure (network etc.): the round is still open — resume
        // the climb from the same t0 so the player can try again.
        BT.ui.toast(C.errText(resp), "error");
        startLoop(false);
        return;
      }
      finish(resp, m);
    }

    betBtn.addEventListener("click", async () => {
      if (busy || running) return;
      busy = true; betBtn.disabled = true;
      overlay.hide(); banner.hide(); seed.reset();
      counter.className = "crash-counter";
      counter.textContent = "1.00\u00d7";
      curve.setAttribute("d", "");
      stake = bet.getBet();
      const resp = await BT.api.gameBet("crash", { bet: stake, params: {} });
      busy = false; betBtn.disabled = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id;
      BT.setActiveGame("crash", roundId);
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce); BT.fair.noteBet(resp);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      bet.setDisabled(true); autoInput.disabled = true;
      betBtn.style.display = "none";
      cashBtn.style.display = "block"; cashBtn.disabled = false;
      status.textContent = "";
      BT.ui.haptic("light");
      startLoop(true);
    });

    cashBtn.addEventListener("click", () => {
      if (!running || busy || !roundId) return;
      const t = C.nowMs() - t0;
      const m = Math.min(Math.exp(GROWTH * t), MAX_CLAIM);
      cashout(Math.max(1.0, Math.floor(m * 100) / 100), false);
    });

    root.appendChild(el("div", { class: "card" }, [
      C.gameHeader("crash", "Crash", "The multiplier climbs from 1.00\u00d7 — cash out before it crashes to win your bet times the counter. The crash point is fixed and hash-committed before you bet; wait too long and you lose the stake. Optional auto cash out fires for you at a target of your choice."),
      stage,
      autoField,
      bet.node,
      betBtn,
      cashBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "crash", title: "Crash", render });
})();
