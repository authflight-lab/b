// Dice — single settle. Client sends a target [2,98]; server rolls & pays.
// Win if roll < target. The Multiplier / Win Chance shown are a PREVIEW using
// the game's published formula (M = 99/target, P(win) = target%); the actual
// payout is always computed server-side and rendered from the settle response.
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
    const overlay = C.resultOverlay(slider);

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
        el("span", null, "Roll Under"),
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
      multOut.textContent = (99 / target).toFixed(4);
      chanceOut.textContent = target.toFixed(2);
    }

    range.addEventListener("input", () => syncTarget(parseInt(range.value, 10)));
    rollInput.addEventListener("input", () => syncTarget(parseInt(rollInput.value, 10), true));
    rollInput.addEventListener("blur", () => (rollInput.value = String(target)));
    syncTarget(50);

    const betBtn = el("button", { class: "btn primary block" }, "Roll");
    let busy = false;

    betBtn.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      betBtn.disabled = true;
      range.disabled = true;
      badge.classList.remove("show");
      overlay.hide(); banner.hide();
      seed.reset();
      const t = target;

      const betResp = await BT.api.gameBet("dice", {
        bet: bet.getBet(),
        client_seed: C.clientSeed(),
        params: { target: t },
      });
      if (!betResp || betResp.ok === false) {
        BT.ui.toast(C.errText(betResp), "error");
        busy = false; betBtn.disabled = false; range.disabled = false; return;
      }
      seed.setHash(betResp.server_hash);
      seed.setNonce(betResp.nonce);
      if (typeof betResp.balance === "number") BT.setBalance(betResp.balance);

      const s = await BT.api.gameSettle("dice", { round_id: betResp.round_id, target: t });
      if (!s || s.ok === false) {
        BT.ui.toast(C.errText(s), "error");
        busy = false; betBtn.disabled = false; range.disabled = false; return;
      }
      seed.revealSeed(s.server_seed);
      const o = s.outcome || {};
      const roll = o.roll !== undefined ? o.roll : o.result;
      const win = o.win !== undefined ? o.win : (s.payout || 0) > 0;

      if (typeof roll === "number") {
        const pos = Math.max(0, Math.min(100, roll));
        badge.textContent = roll.toFixed(2);
        badge.style.left = pos + "%";
        badge.className = "dice-badge show " + (win ? "win" : "lose");
        history.unshift({ roll, win });
        if (history.length > 12) history.pop();
        renderResults();
      }

      C.syncBalance(s);
      const multText = o.multiplier ? o.multiplier.toFixed(2) + "x" : (100 / target).toFixed(2) + "x";
      if (win) {
        overlay.show("win", multText, "+" + BT.ui.fmt(s.payout) + " pts");
        BT.ui.haptic("success");
      } else {
        overlay.show("lose", "0x", "Roll " + (roll !== undefined ? roll.toFixed(2) : "?"));
        BT.ui.haptic("error");
      }
      busy = false; betBtn.disabled = false; range.disabled = false;
    });

    renderResults();
    root.appendChild(
      el("div", { class: "card" }, [
        el("h3", { class: "game-title" }, [BT.ui.icon("dice", 22), el("span", null, "Dice")]),
        el("p", { class: "small muted" }, "Drag the slider to set your target. You win if the roll lands under it — lower target, higher payout."),
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
