// Flip — chainable coin flip. /step per flip, /cashout to lock. 1.98^k.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    const seed = C.seedBox();
    const banner = C.resultBanner();
    const coin = el("div", { class: "coin" }, "◎");
    const track = el("div", { class: "mult-track" });
    let roundId = null, busy = false, streak = 0;

    const headsBtn = el("button", { class: "btn accent2 grow" }, "Heads");
    const tailsBtn = el("button", { class: "btn accent2 grow" }, "Tails");
    const cashBtn = el("button", { class: "btn good block" }, "Cash out");
    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const playRow = el("div", { class: "row", style: "display:none" }, [headsBtn, tailsBtn]);

    function setPlaying(on) {
      startBtn.style.display = on ? "none" : "block";
      playRow.style.display = on ? "flex" : "none";
      cashBtn.style.display = on ? "block" : "none";
      bet.input.disabled = on;
    }
    setPlaying(false);

    function pushMult(m, on) {
      const s = el("div", { class: "mult-step" + (on ? " on" : "") }, (m ? (Math.round(m * 100) / 100) + "×" : "?"));
      track.appendChild(s);
      track.scrollLeft = track.scrollWidth;
    }

    startBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; startBtn.disabled = true;
      banner.hide(); seed.reset(); BT.ui.clear(track); streak = 0;
      const resp = await BT.api.gameBet("flip", { bet: bet.getBet(), client_seed: C.clientSeed(), params: {} });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id;
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      setPlaying(true);
    });

    async function step(side) {
      if (busy || !roundId) return; busy = true;
      headsBtn.disabled = tailsBtn.disabled = cashBtn.disabled = true;
      const resp = await BT.api.gameStep("flip", { round_id: roundId, move: side });
      headsBtn.disabled = tailsBtn.disabled = cashBtn.disabled = false;
      busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      const os = resp.outcome_step || {};
      const face = os.result || os.side || (os.win ? side : "?");
      coin.textContent = face === "heads" ? "◉" : (face === "tails" ? "◯" : "◎");
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
      roundId = null; setPlaying(false);
      seed.revealSeed(resp.server_seed);
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { banner.show("win", "Cashed out +" + BT.ui.fmt(payout) + " pts"); BT.ui.haptic("success"); }
      else { banner.show("lose", "Busted — better luck next time."); BT.ui.haptic("error"); }
    }

    root.appendChild(el("div", { class: "card" }, [
      el("h3", { class: "game-title" }, [BT.ui.icon("flip", 22), el("span", null, "Flip")]),
      el("p", { class: "small muted" }, "Pick a side each round. Every correct flip multiplies your bet by 1.98×. Cash out any time before you miss."),
      coin,
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
