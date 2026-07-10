// Crash — solo curve. A multiplier climbs from 1.00x; cash out before the
// server's predetermined crash point to win. The round is SERVER-clocked:
// the bet anchors a server t0 and the round autonomously crashes the moment
// e^(GROWTH * elapsed) reaches the seeded crash point. This client animates
// the same formula and polls /crash/check (~1/s) to learn of the crash the
// moment it happens — it can never predict it (the crash point stays secret
// until settle; committed via the server hash before the bet, verifiable
// after seed rotation). Wins are clamped server-side to the server clock, so
// the animation can safely lag a little; claims can never run ahead.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const CAP = 25;              // CRASH_CAP (== global MULT_CAP)
  const MAX_CLAIM = 24.99;     // claiming >= CAP always busts, so stop just under
  const GROWTH = 0.00006;      // mult(t) = e^(GROWTH * t_ms) — MUST match api/game/crash.py
  const RESET_S = 3;           // cosmetic between-round countdown
  const CHECK_MS = 1000;       // /crash/check poll interval while the curve rises

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    let stake = 0;
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let roundId = null, busy = false, running = false;
    let raf = 0, t0 = 0, points = [];
    let checking = false, lastCheckT = 0;
    let skewT0 = null; // server t0_ms translated into client clock units (see startLoop)

    // --- Stage: exponential curve + top-left counter ----------------------
    // One SVG path (glowing stroke) + one fill path (gradient area) + one
    // leading-tip dot, all redrawn per frame — single-path GPU-cheap drawing.
    // W/H track the stage's actual rendered pixel size (not a fixed design
    // size) so the viewBox always matches its real aspect ratio — otherwise
    // preserveAspectRatio="none" stretches the fixed-ratio curve to fit
    // whatever height the flex layout gives the stage (looks distorted on
    // tall mobile screens). Re-synced on attach and on resize.
    let W = 320, H = 150;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "crash-svg");
    const defs = document.createElementNS(NS, "defs");
    const grad = document.createElementNS(NS, "linearGradient");
    // Unique per render: a stale duplicate of this screen in the DOM must
    // never capture the gradient url() reference of the live one.
    const gradId = "crash-fill-grad-" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    grad.setAttribute("id", gradId);
    grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0");
    grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
    const stop1 = document.createElementNS(NS, "stop");
    stop1.setAttribute("offset", "0"); stop1.setAttribute("class", "crash-fill-s1");
    const stop2 = document.createElementNS(NS, "stop");
    stop2.setAttribute("offset", "1"); stop2.setAttribute("class", "crash-fill-s2");
    grad.appendChild(stop1); grad.appendChild(stop2);
    defs.appendChild(grad);
    const fillPath = document.createElementNS(NS, "path");
    fillPath.setAttribute("class", "crash-fill");
    fillPath.setAttribute("fill", "url(#" + gradId + ")");
    const curve = document.createElementNS(NS, "path");
    curve.setAttribute("class", "crash-curve");
    const tip = document.createElementNS(NS, "circle");
    tip.setAttribute("class", "crash-tip");
    tip.setAttribute("r", "4");
    tip.style.display = "none";
    svg.appendChild(defs); svg.appendChild(fillPath); svg.appendChild(curve); svg.appendChild(tip);
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

    // Plot the multiplier as a visibly exponential sweep: x is linear time,
    // y bends the normalised multiplier with a power curve so the trace sits
    // near-flat along the baseline and steepens toward the leading tip. The
    // tip keeps a little headroom from the corner so the dot always rides
    // inside the frame.
    const CURVE_POW = 1.7;
    function clearCurve() {
      curve.setAttribute("d", "");
      fillPath.setAttribute("d", "");
      tip.style.display = "none";
    }
    function syncSize() {
      const w = Math.round(stage.clientWidth);
      const h = Math.round(stage.clientHeight);
      if (w > 0 && h > 0 && (w !== W || h !== H)) {
        W = w; H = h;
        svg.setAttribute("viewBox", "0 0 " + W + " " + H);
        drawCurve();
      }
    }
    function drawCurve() {
      if (points.length < 2) { clearCurve(); return; }
      const last = points[points.length - 1];
      const tMax = Math.max(last[0], 1200) * 1.06;
      const mMax = Math.max(last[1], 1.5);
      const X0 = 6, XR = 12;            // left origin / right headroom
      const Y0 = H - 8, YT = 18;        // baseline / top headroom
      let d = "", x = X0, y = Y0;
      for (let i = 0; i < points.length; i++) {
        x = X0 + (points[i][0] / tMax) * (W - X0 - XR);
        const n = Math.max(0, (points[i][1] - 1) / (mMax - 1));
        y = Y0 - Math.pow(n, CURVE_POW) * (Y0 - YT);
        d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }
      curve.setAttribute("d", d);
      fillPath.setAttribute("d", d + "L" + x.toFixed(1) + " " + Y0 + "L" + X0 + " " + Y0 + "Z");
      tip.setAttribute("cx", x.toFixed(1));
      tip.setAttribute("cy", y.toFixed(1));
      tip.style.display = "";
    }

    // The climb: the client CANNOT know the crash point (the active server
    // seed is secret), so the curve rises on the shared formula while a ~1/s
    // poll of /crash/check asks the server-clocked truth "has it crashed?".
    // The moment it has, the server settles the round (payout 0, crash point
    // revealed) and the curve drops right here — no cashout needed.
    // `reset` starts a fresh round clock; omit it to RESUME after a transient
    // cashout failure without rewinding t0/points.
    function startLoop(reset) {
      stopLoop();
      // t0 is in CLIENT clock units: t0 = (server t0_ms) + (estimated skew),
      // where skew = clientNow-at-response - server_now_ms, i.e. how far
      // ahead the client's clock is of the server's at the moment the bet
      // response arrived. Elapsed-since-t0 in client time then lines up with
      // elapsed-since-t0_ms on the server clock, instead of resetting a local
      // "now" on arrival (which always lags the server by the bet round trip
      // and compounds into a large multiplier gap under the exponential
      // curve — never in the player's favor).
      if (reset) { t0 = skewT0 != null ? skewT0 : C.nowMs(); points = [[0, 1]]; lastCheckT = 0; }
      let lastPt = points.length ? points[points.length - 1][0] : 0;
      running = true;
      (function tick() {
        if (!running) return;
        if (!stage.isConnected) { running = false; stopLoop(); return; } // screen torn down
        const t = C.nowMs() - t0;
        const m = Math.min(Math.exp(GROWTH * t), CAP);
        counter.textContent = m.toFixed(2) + "\u00d7";
        counter.className = "crash-counter live" + counterTone(m);
        svg.setAttribute("class", "crash-svg live" + counterTone(m));
        cashBtn.textContent = "Cash out \u00b7 " + Math.min(m, MAX_CLAIM).toFixed(2) + "\u00d7";
        if (t - lastPt >= 80) { points.push([t, m]); lastPt = t; drawCurve(); }
        if (t - lastCheckT >= CHECK_MS && !checking) { lastCheckT = t; pollCrash(); }
        const at = autoTarget();
        if (at !== null && m >= at) { cashout(at, true); return; }
        if (m >= CAP) { cashout(MAX_CLAIM, true); return; } // cap: forced claim just under
        raf = requestAnimationFrame(tick);
      })();
    }

    // Ask the server whether the round has crashed. Fire-and-forget from the
    // rAF loop; results arriving after a cashout started (busy) or after the
    // round ended are ignored — the cashout response is then the authority.
    function pollCrash() {
      const rid = roundId;
      checking = true;
      BT.api.crashCheck({ round_id: rid }).then((r) => {
        checking = false;
        if (!running || busy || !roundId || roundId !== rid || !stage.isConnected) return;
        if (r && r.crashed) { finish(r, 1.0, "Crashed"); return; }
        if (r && (r.error === "no_open_round" || r.error === "round_not_open" || r.error === "round_not_found")) {
          // Round closed elsewhere (e.g. swept while backgrounded) — end it.
          roundId = null; BT.clearActiveGame();
          bet.setDisabled(false); autoInput.disabled = false;
          freezeAt(parseFloat(counter.textContent) || 1.0, true);
          rearmNow();
        }
        // Any other error (network blip, rate limit): ignore — next poll retries.
      }).catch(() => { checking = false; });
    }

    function freezeAt(m, crashed) {
      running = false;
      stopLoop();
      counter.textContent = m.toFixed(2) + "\u00d7";
      counter.className = "crash-counter " + (crashed ? "crashed" : "cashed");
      svg.setAttribute("class", "crash-svg " + (crashed ? "crashed" : "cashed"));
      if (crashed) {
        stage.classList.add("crash-flash");
        setTimeout(() => stage.classList.remove("crash-flash"), 650);
      }
    }

    // After a LOSS the bet form re-arms instantly — no countdown, so the next
    // round is a single tap away. Wins keep the cosmetic countdown below.
    function rearmNow() {
      betBtn.style.display = "block"; cashBtn.style.display = "none";
      betBtn.disabled = false;
      status.textContent = "Place a bet to launch.";
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

    function finish(resp, claimed, loseMsg) {
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
        resetCountdown();
      } else {
        // crash_point ships nested under `outcome` from /cashout but at the
        // top level from /crash/check — accept either shape.
        const cp = typeof o.crash_point === "number" ? o.crash_point
                 : typeof resp.crash_point === "number" ? resp.crash_point
                 : claimed;
        freezeAt(cp, true);
        BT.ui.haptic("error");
        rearmNow();
      }
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
      svg.setAttribute("class", "crash-svg");
      clearCurve();
      stake = bet.getBet();
      const resp = await BT.api.gameBet("crash", { bet: stake, params: {} });
      busy = false; betBtn.disabled = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id;
      BT.setActiveGame("crash", roundId);
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce); BT.fair.noteBet(resp);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      // Anchor the animation to the server's true round clock instead of a
      // local "now" reset (see startLoop for why that always lags).
      skewT0 = (typeof resp.t0_ms === "number" && typeof resp.server_now_ms === "number")
        ? C.nowMs() - (resp.server_now_ms - resp.t0_ms)
        : null;
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

    // Measure once attached (detached geometry is always 0) and again on any
    // resize/orientation change; disconnect when the screen is torn down.
    syncSize();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => syncSize());
      ro.observe(stage);
      const stopObserving = () => { if (!stage.isConnected) { ro.disconnect(); } else { requestAnimationFrame(stopObserving); } };
      requestAnimationFrame(stopObserving);
    }
  }

  C.register({ key: "crash", title: "Crash", render });
})();
