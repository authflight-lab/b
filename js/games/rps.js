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
  const HANDS = [
    { key: "rock", emoji: "✊", label: "Rock" },
    { key: "paper", emoji: "✋", label: "Paper" },
    { key: "scissors", emoji: "✌️", label: "Scissors" },
  ];
  const EMOJI = { rock: "✊", paper: "✋", scissors: "✌️" };
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
    const slotFace = el("div", { class: "rps-slot-face" }, "?");
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
        el("span", { class: "rps-hand-emoji" }, h.emoji),
        el("span", { class: "rps-hand-label" }, h.label),
      ]);
      b.addEventListener("click", () => pick(h.key));
      handBtns[h.key] = b;
      return b;
    }));

    const board = el("div", { class: "rps-board" }, [slotWrap, conn, handsEl]);
    const overlay = C.resultOverlay(board);

    function setSlot(kind, text, badge) {
      slotEl.className = "rps-slot" + (kind ? " " + kind : "");
      slotFace.textContent = text;
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
        slotFace.textContent = HANDS[Math.floor(Math.random() * 3)].emoji;
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
      const houseEmoji = EMOJI[os.house] || "?";
      if (os.tie) {
        setSlot("tie", houseEmoji, "TIE — pick again");
        setHandsEnabled(true);
        syncCashout();
        BT.ui.haptic("light");
        return;
      }
      if (resp.busted) {
        setSlot("bust", houseEmoji, EMOJI[os.pick] + " loses");
        renderLadder();
        finish(resp, false);
        return;
      }
      // Win — advance the ladder, flip the newly-won rung.
      wins = typeof os.wins === "number" ? os.wins : wins + 1;
      mult = typeof resp.multiplier === "number" ? resp.multiplier : mult;
      setSlot("win", houseEmoji, EMOJI[os.pick] + " wins");
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
