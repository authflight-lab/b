// RPS — Rock Paper Scissors streak ladder. /step + /cashout.
// Pick a hand; the house hand reveals in the center slot. A win advances one
// rung along the always-visible multiplier ladder (top), a tie replays with no
// change, a loss busts the run. The ladder values are a PREVIEW from the game's
// published formula (factor (1-EPS)/0.5 = 1.96 per win, EPS=0.02, capped 20x);
// the real payout is always the server's multiplier from step/cashout.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const EPS = 0.02;                 // matches api/game/rps.py
  const FACTOR = (1 - EPS) / 0.5;   // 1.96 per straight win
  const RPS_MAX_MULT = 20;          // chain cap (matches RPS_MAX_MULT)
  const RUNGS = 6;                  // wins 0..5 — the 5th win lands on the cap

  // Monochrome (currentColor) line-art icons — themeable via CSS `color`,
  // replacing the old rock/paper/scissors emoji glyphs.
  const ICONS = {
    rock: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M228.813 23L68.75 72.28L39.5 182.095l47.53-21.22l10.44-4.655l2.5 11.155l8.75 39.125l6.405 28.53l-21.75-19.53l-15.72-14.125l-28.218 32.344l140.657 136l9.656-40.69l7.53-31.874l10.407 31.063l54.72 163.592l159.936-26.31l45.75-202.938l-84.563-148.718L228.814 23zm-57.688 49.875l-27.813 39.906l-3.25 73.44l-27.187-88.94l58.25-24.405zm17.844 93.406l113.124 155.25L407 355.407l-107.375-.844l-110.656-128v-60.28zM79.312 330.25l140.125 153.125l-5.563-65.875z"/></svg>',
    paper: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M281.293 94.283a9 9 0 0 1-.23.203c-.027.023-.048.046-.073.07c.113-.103.143-.126.303-.273m.754.62c-.922-.026-1.59.26-1.79.333c-18.276 16.014-26.02 33.42-43.35 51.993c-17.25 18.485-43.688 36.204-96.677 51.225l-31.087 42.13a9 9 0 0 1-7.163 3.657l-50.75.45l-14.69-8.344l-2.622 119.744l14.603-8.426h57.28a9 9 0 0 1 6.934 3.264c13.526 16.35 20.025 32.04 37.946 39.838l200.556 61.878c12.478-.538 22.443-2.015 28.625-5.568c5.266-3.025 8.892-7.468 10.952-16.584c-5.457-2.305-23.53-9.945-47.185-19.853c-13.495-5.652-27.03-11.294-37.236-15.494c-5.103-2.1-9.382-3.842-12.37-5.027a161 161 0 0 0-3.397-1.317c-.208-.077-.253-.09-.367-.13c-.157.023-.3.105-1.897-.677c-.994-.486-4.692-10.586-4.692-10.588c0 0 5.642-6.027 6.47-6.234c2.54-.635 2.98-.25 3.483-.18c.2.028.253.05.388.074c.13.016.294.036.637.073c.89.095 2.327.236 4.183.41c3.713.345 9.13.827 15.67 1.397c13.082 1.14 30.68 2.633 48.37 4.112c17.69 1.477 35.475 2.942 48.945 4.03c6.734.544 12.392.992 16.406 1.3c2.006.155 3.606.275 4.702.352c.445.03.74.05 1 .065c7.954-.59 12.096-2.93 14.38-5.373c2.315-2.48 3.274-5.563 3.075-9.477c-.392-7.7-6.855-16.7-13.162-18.697l-125.047-16.39a9 9 0 0 1 .357-17.886s34.4-3.114 69.246-6.35c17.425-1.62 34.963-3.27 48.35-4.575c6.695-.654 12.355-1.22 16.42-1.652c2.03-.215 3.67-.397 4.798-.533c.516-.062 1.142-.195 1.516-.27c10.906-3.095 16.196-7.17 18.164-10.054c2.01-2.944 1.993-5.088.517-8.644c-2.946-7.1-15.285-15.783-23.27-16.322l-140.36-3.662a9 9 0 0 1-1.555-17.817s30.514-6.195 61.904-12.542c15.695-3.174 31.608-6.386 44.04-8.88c12.434-2.496 20.85-4.184 23.35-4.617c9.49-1.643 13.86-5.275 16.143-9.164c2.282-3.888 2.655-8.88.996-14.175c-2.902-9.267-11.46-17.814-23.172-18.067a26 26 0 0 0-5.204.422l-.19.03l-148.954 23.665c-7.51 10.38-14.5 15.897-23.953 22.977c-2.022 57.078-12.448 85.543-27.33 100.578c-15.283 15.436-34.4 14.424-40.335 15.908l-4.368-17.46c12.134-3.035 21.968-1.066 31.91-11.11s20.786-43.402 22.598-99.302c.383-11.837 5.848-16.428 15.848-24.976c9.72-8.312 22.652-19.383 34.63-42.336c.09-.174.194-.34.31-.5c9.938-13.55 24.09-27.876 35.586-37.72c5.748-4.923 10.85-8.79 14.72-11.25c1.933-1.23 3.55-2.144 4.83-2.71a9 9 0 0 1 1.174-.436z"/></svg>',
    scissors: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M187.125 19.53a44 44 0 0 0-2.188.032c-3.91.152-7.823.84-11.656 2.157c-15.33 5.26-25.474 19.04-29.843 35.218c-4.368 16.177-3.47 35.265 3.125 54.25a109 109 0 0 0 3.532 8.843l9.72 28.22l54.686 18.844c2.874-.326 5.74-.97 8.563-1.938c15.33-5.262 25.475-19.04 29.843-35.22c4.368-16.176 3.47-35.264-3.125-54.25c-6.595-18.983-17.755-34.555-31.218-44.592c-9.465-7.058-20.435-11.42-31.437-11.563zm-1.28 18.657c6.724-.256 14.112 2.322 21.56 7.876c9.933 7.404 19.25 20.007 24.72 35.75s5.93 31.353 2.72 43.25c-3.213 11.896-9.573 19.556-17.876 22.406c-8.303 2.848-18.1.716-28.032-6.69c-3.308-2.464-6.543-5.523-9.594-9.06l-16.125-29.69c-4.522-14.7-4.756-29.12-1.75-40.25c3.21-11.895 9.57-19.524 17.874-22.374a22.7 22.7 0 0 1 6.5-1.218zm-111.595 106c-6.73.138-13.183 1.02-19.25 2.657c-16.178 4.368-29.957 14.544-35.22 29.875c-5.26 15.33-.66 31.786 9.376 45.25c10.037 13.46 25.61 24.653 44.594 31.25c18.985 6.595 38.072 7.46 54.25 3.093c13.807-3.73 25.866-11.66 32.375-23.438l.063.063l14.343-25.72l6.595 3.563c.026.076.036.082.063.157l57.937 31.344l.03.032l251.19 136.344c14.236-41.16-36.206-109.062-143.626-146.22l-228.814-78.905a109 109 0 0 0-8.906-3.56c-11.865-4.124-23.785-6.01-35-5.782zm.344 18.72a74 74 0 0 1 5.437.093c6.374.345 13.134 1.512 19.94 3.594l29.81 16.187c3.54 3.057 6.598 6.288 9.064 9.595c7.405 9.932 9.537 19.73 6.687 28.03c-2.85 8.304-10.51 14.664-22.405 17.876s-27.507 2.752-43.25-2.718s-28.345-14.818-35.75-24.75c-7.405-9.93-9.506-19.728-6.656-28.03c2.85-8.304 10.478-14.664 22.374-17.876c4.46-1.204 9.43-1.896 14.75-2zm115.844 74.187c12.42 36.016 25.524 74.023 38.593 111.812c37.156 107.42 105.06 157.862 146.22 143.625L255.75 272.44l-65.313-35.344z"/></svg>',
  };
  const HAND_LABEL = { rock: "Rock", paper: "Paper", scissors: "Scissors" };
  const HANDS = [
    { key: "rock", label: "Rock" },
    { key: "paper", label: "Paper" },
    { key: "scissors", label: "Scissors" },
  ];
  const rungMult = (i) => Math.min(Math.pow(FACTOR, i), RPS_MAX_MULT);

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    let stake = 0;
    const seed = C.seedBox();
    const banner = C.resultBanner();

    let roundId = null, busy = false, ended = true;
    let wins = 0, mult = 1.0;

    // --- Multiplier ladder (top) -------------------------------------------
    // Always visible so the next win's value is legible before every pick.
    const ladderEl = el("div", { class: "rps-ladder" });
    function renderLadder(flipIdx) {
      BT.ui.clear(ladderEl);
      for (let i = 0; i < RUNGS; i++) {
        const won = !ended && i > 0 && i <= wins;
        const card = el("div", {
          class: "rps-lcard" + (won ? " won" : "") + (i === 0 ? " base" : ""),
        }, won || i === 0 ? rungMult(i).toFixed(2) + "×" : "◆");
        if (flipIdx === i) {
          card.classList.remove("flip"); void card.offsetWidth; card.classList.add("flip");
        }
        const pill = el("div", {
          class: "rps-lmult" + (!ended && i === wins ? " current" : ""),
        }, rungMult(i).toFixed(2) + "×");
        ladderEl.appendChild(el("div", { class: "rps-rung" }, [card, pill]));
      }
    }

    // --- Center reveal slot + connector + hand tiles ------------------------
    const slotFace = el("div", { class: "rps-slot-face", html: "?" });
    const slotBadge = el("div", { class: "rps-slot-badge hidden" }, "");
    const slotEl = el("div", { class: "rps-slot" }, [slotFace, slotBadge]);
    const slotWrap = el("div", { class: "rps-slot-wrap" }, [slotEl]);

    const conn = el("div", { class: "rps-conn" }, [
      el("div", { class: "v" }),
      el("div", { class: "h" }),
      el("div", { class: "stubs" }, [el("span"), el("span"), el("span")]),
    ]);

    const handBtns = {};
    const handsEl = el("div", { class: "rps-hands" }, HANDS.map((h) => {
      const b = el("button", { class: "rps-hand", type: "button", disabled: "disabled" }, [
        el("span", { class: "rps-hand-emoji", html: ICONS[h.key] }),
        el("span", { class: "rps-hand-label" }, h.label),
      ]);
      b.addEventListener("click", () => pick(h.key));
      handBtns[h.key] = b;
      return b;
    }));

    const board = el("div", { class: "rps-board" }, [slotWrap, conn, handsEl]);
    const overlay = C.resultOverlay(board);

    function setSlot(kind, html, badge) {
      slotEl.className = "rps-slot" + (kind ? " " + kind : "");
      slotFace.innerHTML = html;
      if (badge) {
        slotBadge.textContent = badge;
        slotBadge.classList.remove("hidden");
        slotBadge.classList.remove("pop"); void slotBadge.offsetWidth; slotBadge.classList.add("pop");
      } else {
        slotBadge.classList.add("hidden");
      }
    }

    function setHandsEnabled(on, pickedKey) {
      HANDS.forEach((h) => {
        const b = handBtns[h.key];
        b.disabled = !on;
        b.classList.toggle("live", !!on);
        b.classList.toggle("picked", !on && pickedKey === h.key);
      });
    }

    // --- Actions ------------------------------------------------------------
    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const cashBtn = el("button", { class: "btn primary block", style: "display:none" }, "Cash out");

    function syncCashout() {
      cashBtn.disabled = wins < 1 || busy;
      cashBtn.textContent = wins >= 1
        ? "Cash out · " + mult.toFixed(2) + "×"
        : "Cash out";
    }

    startBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; startBtn.disabled = true;
      overlay.hide(); banner.hide(); seed.reset();
      stake = bet.getBet();
      const resp = await BT.api.gameBet("rps", { bet: stake, params: {} });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id; ended = false;
      BT.setActiveGame("rps", roundId);
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce); BT.fair.noteBet(resp);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      wins = 0; mult = 1.0;
      renderLadder();
      setSlot("", "?", null);
      startBtn.style.display = "none"; cashBtn.style.display = "block"; bet.setDisabled(true);
      setHandsEnabled(true);
      syncCashout();
    });

    async function pick(key) {
      if (busy || ended || !roundId) return; busy = true;
      setHandsEnabled(false, key);
      cashBtn.disabled = true;
      // Outcome-free motion the instant of the tap: the slot shuffles through
      // hands while the request is in flight. The active server seed is secret,
      // so nothing is predicted — the real hand is revealed on the response.
      setSlot("spin", "?", null);
      const t0 = C.nowMs();
      const shuffle = setInterval(() => {
        slotFace.innerHTML = ICONS[HANDS[Math.floor(Math.random() * 3)].key];
      }, 90);
      const resp = await BT.api.gameStep("rps", { round_id: roundId, move: { hand: key } });
      await C.hold(t0, 480);
      clearInterval(shuffle);
      busy = false;
      if (!resp || resp.ok === false) {
        BT.ui.toast(C.errText(resp), "error");
        setSlot("", "?", null);
        setHandsEnabled(true);
        syncCashout();
        return;
      }
      const os = resp.outcome_step || {};
      const houseIcon = ICONS[os.house] || "?";
      if (os.tie) {
        setSlot("tie", houseIcon, "TIE — pick again");
        setHandsEnabled(true);
        syncCashout();
        BT.ui.haptic("light");
        return;
      }
      if (resp.busted) {
        setSlot("bust", houseIcon, (HAND_LABEL[os.pick] || "") + " loses");
        renderLadder();
        finish(resp, false);
        return;
      }
      // Win — advance the ladder, flip the newly-won rung.
      wins = typeof os.wins === "number" ? os.wins : wins + 1;
      mult = typeof resp.multiplier === "number" ? resp.multiplier : mult;
      setSlot("win", houseIcon, null);
      renderLadder(wins);
      BT.ui.haptic("light");
      if (resp.done) { finish(resp, true); return; }
      setHandsEnabled(true);
      syncCashout();
    }

    cashBtn.addEventListener("click", async () => {
      if (busy || ended || !roundId) return; busy = true; cashBtn.disabled = true;
      const resp = await BT.api.gameCashout("rps", { round_id: roundId });
      busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); syncCashout(); return; }
      finish(resp, true);
    });

    function finish(resp, won) {
      ended = true; roundId = null; BT.clearActiveGame();
      startBtn.style.display = "block"; cashBtn.style.display = "none"; cashBtn.disabled = false;
      bet.setDisabled(false);
      setHandsEnabled(false);
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { overlay.show("win", C.winMult(resp.multiplier, payout, stake), C.winLines(payout, stake)); BT.ui.haptic("success"); }
      else { overlay.show("lose", "0x", "House wins"); BT.ui.haptic("error"); }
      renderLadder();
    }

    renderLadder();
    root.appendChild(el("div", { class: "card" }, [
      C.gameHeader("rps", "RPS", "Rock beats scissors, scissors beats paper, paper beats rock. Every win advances you one rung along the multiplier ladder (1.96× per win, up to 20×). A tie replays the round with no change. One loss ends the run — cash out any time after your first win."),
      ladderEl,
      board,
      bet.node,
      startBtn,
      cashBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "rps", title: "RPS", render });
})();
