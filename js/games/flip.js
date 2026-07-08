// Flip — chainable coin flip. /step per flip, /cashout to lock. 1.96^k.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    let stake = 0;
    const seed = C.seedBox();
    const banner = C.resultBanner();
    const coinFaceH = el("div", { class: "coin-face heads" }, "H");
    const coinFaceT = el("div", { class: "coin-face tails" }, "T");
    const coin3d = el("div", { class: "coin-3d" }, [coinFaceH, coinFaceT]);
    const coinBob = el("div", { class: "coin-bob" }, coin3d);
    const coinWrap = el("div", { class: "coin-flip-wrap" }, [coinBob, el("div", { class: "coin-shadow" })]);
    const overlay = C.resultOverlay(coinWrap);
    let coinDeg = 0;
    // Always spins forward to the target face (never snaps back), with two
    // extra full turns for a satisfying flip when `animate` is true.
    function flipCoinTo(face, animate) {
      const targetMod = face === "tails" ? 180 : 0;
      const currentMod = ((coinDeg % 360) + 360) % 360;
      const delta = (targetMod - currentMod + 360) % 360;
      coin3d.style.transition = animate ? "" : "none";
      if (animate) {
        coinDeg += 720 + delta;
      } else {
        coinDeg = targetMod; // instant resets have no transition to preserve, so snap + bound the value
      }
      coin3d.style.transform = "rotateY(" + coinDeg + "deg)";
      if (!animate) void coin3d.offsetHeight; // force reflow so the instant reset never animates
    }
    // Kick the coin forward the instant the user taps — outcome-free motion
    // that keeps spinning while /step is in flight. The real face is landed by
    // flipCoinTo() when the response returns; because coinDeg only ever grows
    // forward, that lands smoothly wherever this pre-spin left it.
    function spinCoin() {
      coin3d.style.transition = "";
      coinDeg += 540;
      coin3d.style.transform = "rotateY(" + coinDeg + "deg)";
    }
    const track = el("div", { class: "mult-track" });
    let roundId = null, busy = false, streak = 0;

    const headsBtn = el("button", { class: "btn accent2 grow" }, "Heads");
    const tailsBtn = el("button", { class: "btn accent2 grow" }, "Tails");
    const cashBtn = el("button", { class: "btn primary block" }, "Cash out");
    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const playRow = el("div", { class: "row", style: "display:none" }, [headsBtn, tailsBtn]);

    function setPlaying(on) {
      startBtn.style.display = on ? "none" : "block";
      playRow.style.display = on ? "flex" : "none";
      cashBtn.style.display = on ? "block" : "none";
      bet.setDisabled(on);
    }
    setPlaying(false);

    function pushMult(m, on) {
      const s = el("div", { class: "mult-step" + (on ? " on" : "") }, (m ? (Math.round(m * 100) / 100) + "×" : "?"));
      track.appendChild(s);
      track.scrollLeft = track.scrollWidth;
    }

    startBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; startBtn.disabled = true;
      overlay.hide(); banner.hide(); seed.reset(); BT.ui.clear(track); streak = 0;
      flipCoinTo("heads", false);
      stake = bet.getBet();
      const resp = await BT.api.gameBet("flip", { bet: stake, params: {} });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id;
      BT.setActiveGame("flip", roundId);
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce); BT.fair.noteBet(resp);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      setPlaying(true);
    });

    async function step(side) {
      if (busy || !roundId) return; busy = true;
      headsBtn.disabled = tailsBtn.disabled = cashBtn.disabled = true;
      // Start the flip on tap; the real face lands when /step returns.
      spinCoin();
      const resp = await BT.api.gameStep("flip", { round_id: roundId, move: side });
      headsBtn.disabled = tailsBtn.disabled = cashBtn.disabled = false;
      busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      const os = resp.outcome_step || {};
      // `coin` is the real API's authoritative outcome field (api/main.py); on
      // a losing flip it differs from the player's own guess (`side`), so it
      // must be checked first or the coin would wrongly land on the guess.
      const face = os.coin || os.result || os.side || side;
      flipCoinTo(face === "tails" ? "tails" : "heads", true);
      const busted = !!resp.busted;
      streak += 1;
      pushMult(resp.multiplier, !busted);
      if (busted || resp.done) {
        finish(resp);
      } else {
        BT.ui.haptic("light");
      }
    }
    headsBtn.addEventListener("click", () => step("heads"));
    tailsBtn.addEventListener("click", () => step("tails"));

    cashBtn.addEventListener("click", async () => {
      if (busy || !roundId) return; busy = true; cashBtn.disabled = true;
      const resp = await BT.api.gameCashout("flip", { round_id: roundId });
      cashBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      finish(resp);
    });

    function finish(resp) {
      roundId = null; BT.clearActiveGame(); setPlaying(false);
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { overlay.show("win", C.winMult(resp.multiplier, payout, stake), C.winLines(payout, stake)); BT.ui.haptic("success"); }
      else { overlay.show("lose", "0x", "Busted"); BT.ui.haptic("error"); }
    }

    root.appendChild(el("div", { class: "card" }, [
      C.gameHeader("flip", "Flip", "Pick a side each round. Every correct flip multiplies your bet by 1.96×. Cash out any time before you miss."),
      coinWrap,
      track,
      bet.node,
      startBtn,
      playRow,
      el("div", { class: "spacer" }),
      cashBtn,
      banner.node,
      seed.node,
    ]));
    cashBtn.style.display = "none";
  }

  C.register({ key: "flip", title: "Flip", render });
})();
