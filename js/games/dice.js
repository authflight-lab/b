// Dice — single settle. Client sends a target [2,98]; server rolls & pays.
// Win if roll > target. The Multiplier / Win Chance shown are a PREVIEW using
// the game's published formula (M = 99/(100-target), P(win) = (100-target)%); the
// actual payout is always computed server-side and rendered from the settle response.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const T_MIN = 2;
  const T_MAX = 98;
  const clampTarget = (v) => Math.max(T_MIN, Math.min(T_MAX, isNaN(v) ? 50 : v));

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    const seed = C.seedBox();
    const banner = C.resultBanner();

    let target = 50;
    const history = [];

    // Recent results pills.
    const results = el("div", { class: "dice-results" });
    function renderResults() {
      BT.ui.clear(results);
      if (!history.length) {
        results.appendChild(el("span", { class: "small muted" }, "No rolls yet."));
        return;
      }
      history.forEach((h) => {
        results.appendChild(
          el("div", { class: "dice-pill " + (h.win ? "win" : "lose") }, [
            el("span", { class: "dot" }),
            el("span", null, h.roll.toFixed(2)),
          ])
        );
      });
    }

    // Slider.
    const badge = el("div", { class: "dice-badge" }, "—");
    const ticks = el(
      "div",
      { class: "dice-ticks" },
      [25, 50, 75].map((t) => el("div", { class: "dice-tick", style: "left:" + t + "%" }, String(t)))
    );
    const range = el("input", {
      type: "range",
      class: "dice-range",
      min: String(T_MIN),
      max: String(T_MAX),
      step: "1",
      value: "50",
    });
    const valueOut = el("span", null, "50.00");
    const slider = el("div", { class: "dice-slider" }, [
      badge,
      ticks,
      el("div", { class: "dice-track-wrap" }, range),
      el("div", { class: "dice-value" }, valueOut),
    ]);

    // Stat fields.
    const multOut = el("div", { class: "val" }, "1.9800");
    const rollInput = el("input", { type: "number", min: String(T_MIN), max: String(T_MAX), step: "1", value: "50" });
    const chanceOut = el("div", { class: "val" }, "50.00");
    const stats = el("div", { class: "dice-stats" }, [
      el("div", { class: "dice-stat" }, [
        el("span", null, "Multiplier"),
        el("div", { class: "dice-stat-box" }, [multOut, el("span", { class: "unit" }, "×")]),
      ]),
      el("div", { class: "dice-stat" }, [
        el("span", null, ["Roll ", el("strong", null, "Over")]),
        el("div", { class: "dice-stat-box" }, rollInput),
      ]),
      el("div", { class: "dice-stat" }, [
        el("span", null, "Win Chance"),
        el("div", { class: "dice-stat-box" }, [chanceOut, el("span", { class: "unit" }, "%")]),
      ]),
    ]);

    function syncTarget(v, fromInput) {
      target = clampTarget(v);
      range.style.setProperty("--t", target + "%");
      if (String(range.value) !== String(target)) range.value = String(target);
      if (!fromInput) rollInput.value = String(target);
      valueOut.textContent = target.toFixed(2);
      valueOut.style.left = target + "%";
      multOut.textContent = (99 / (100 - target)).toFixed(4);
      chanceOut.textContent = (100 - target).toFixed(2);
    }

    range.addEventListener("input", () => syncTarget(parseInt(range.value, 10)));
    rollInput.addEventListener("input", () => syncTarget(parseInt(rollInput.value, 10), true));
    rollInput.addEventListener("blur", () => (rollInput.value = String(target)));
    syncTarget(50);

    const betBtn = el("button", { class: "btn primary block" }, "Roll");
    let busy = false;

    // The roll runs entirely on outcome-free "velocity" motion: the number
    // churns fast then decelerates while the badge wobbles with a decaying
    // amplitude — momentum with NOTHING predicted (the active server seed is
    // secret, so the client can't know the roll), so there is nothing to undo
    // when the real value lands. REVEAL_MIN_MS is the spin/coast floor before
    // the true roll may land; SETTLE_MS is the final eased count onto it.
    // Together they mask the network round trip behind a snappy ~600ms animation.
    const REVEAL_MIN_MS = 340;
    const SETTLE_MS = 260;
    let rollRaf = 0;
    function cancelRaf() { if (rollRaf) { cancelAnimationFrame(rollRaf); rollRaf = 0; } }

    // Start the instant the user taps: a fast, decelerating number flicker plus
    // a decaying centre wobble. Returns { t0, stop }.
    function startRolling() {
      cancelRaf();
      badge.textContent = "";
      // `rolling` drops the CSS `left` transition so the rAF wobble stays crisp.
      badge.className = "dice-badge show rolling";
      const t0 = C.nowMs();
      let nextFlip = 0;
      function tick() {
        const t = C.nowMs() - t0;
        if (t >= nextFlip) {
          badge.textContent = (2 + Math.random() * 96).toFixed(2);
          // cadence widens (~28ms -> ~120ms) so the churn visibly decelerates
          nextFlip = t + 28 + Math.min(92, t * 0.35);
        }
        const wob = 34 * Math.exp(-t / 220);
        const pos = 50 + Math.sin(t / 42) * wob;
        badge.style.left = Math.max(2, Math.min(98, pos)) + "%";
        rollRaf = requestAnimationFrame(tick);
      }
      rollRaf = requestAnimationFrame(tick);
      return { t0, stop: cancelRaf };
    }

    function stopRolling(anim) {
      if (anim) anim.stop(); else cancelRaf();
      badge.classList.remove("show", "rolling");
    }

    // Land it: hold out the rest of the spin window, then ease-count the number
    // from wherever the flicker left it onto the true roll while the CSS `left`
    // transition slides the badge home — the velocity "settle" that reads as a
    // real roll decelerating onto its value. Reuses rollRaf so the finally-guard
    // can still cancel it if something goes wrong mid-settle.
    function revealRoll(anim, roll, win) {
      anim.stop();
      return C.hold(anim.t0, REVEAL_MIN_MS).then(() => new Promise((resolve) => {
        const from = parseFloat(badge.textContent);
        const start = isNaN(from) ? roll : from;
        const pos = Math.max(0, Math.min(100, roll));
        badge.className = "dice-badge show " + (win ? "win" : "lose");
        void badge.offsetWidth; // re-enable the CSS left transition before moving
        badge.style.left = pos + "%";
        const t0 = C.nowMs();
        const ease = (k) => 1 - Math.pow(1 - k, 3); // cubic ease-out
        (function step() {
          const k = Math.min(1, (C.nowMs() - t0) / SETTLE_MS);
          badge.textContent = (start + (roll - start) * ease(k)).toFixed(2);
          if (k < 1) { rollRaf = requestAnimationFrame(step); }
          else { badge.textContent = roll.toFixed(2); rollRaf = 0; resolve(); }
        })();
      }));
    }

    betBtn.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      betBtn.disabled = true;
      range.disabled = true;
      banner.hide();
      seed.reset();
      const t = target;
      const stake = bet.getBet();

      const anim = startRolling();
      try {
        // One-shot open+settle: a single round trip instead of /bet then
        // /settle. If the API hasn't shipped the /play route yet (app + API
        // deploy independently, so it can 404), fall back to the two-call flow.
        let s = await BT.api.gamePlay("dice", { bet: stake, params: { target: t } });
        if (s && s._status === 404) {
          const betResp = await BT.api.gameBet("dice", { bet: stake, params: { target: t } });
          if (!betResp || betResp.ok === false) {
            BT.ui.toast(C.errText(betResp), "error");
            return;
          }
          seed.setHash(betResp.server_hash);
          seed.setNonce(betResp.nonce);
          BT.fair.noteBet(betResp);
          if (typeof betResp.balance === "number") BT.setBalance(betResp.balance);
          s = await BT.api.gameSettle("dice", { round_id: betResp.round_id, target: t });
        }
        if (!s || s.ok === false) {
          BT.ui.toast(C.errText(s), "error");
          return;
        }

        // /play returns the hash + nonce alongside the settle; note them for the
        // Provably Fair panel. (In the fallback path these were already set from
        // the bet response and the settle carries no nonce, so the guard skips.)
        if (s.server_hash) seed.setHash(s.server_hash);
        if (s.nonce !== undefined && s.nonce !== null) { seed.setNonce(s.nonce); BT.fair.noteBet(s); }

        const o = s.outcome || {};
        const roll = o.roll !== undefined ? o.roll : o.result;
        const win = o.win !== undefined ? o.win : (s.payout || 0) > 0;

        if (typeof roll === "number") {
          await revealRoll(anim, roll, win);
          history.unshift({ roll, win });
          if (history.length > 12) history.pop();
          renderResults();
        }
        C.syncBalance(s);
        BT.ui.haptic(win ? "success" : "error");
      } finally {
        // Whatever the exit (early return, error toast, or unexpected throw):
        // if the roll never reached its reveal (rAF still live) cancel it and
        // clear the badge; a completed reveal already stopped it and kept its
        // final frame. Always unlock the controls so the UI can't get stuck.
        if (rollRaf) stopRolling(anim);
        busy = false; betBtn.disabled = false; range.disabled = false;
      }
    });

    renderResults();
    root.appendChild(
      el("div", { class: "card" }, [
        C.gameHeader("dice", "Dice", "Drag the slider to set your target. You win if the roll lands over it — higher target, higher payout."),
        results,
        slider,
        stats,
        bet.node,
        betBtn,
        banner.node,
        seed.node,
      ])
    );
  }

  C.register({ key: "dice", title: "Dice", render });
})();
