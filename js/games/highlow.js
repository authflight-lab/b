// HighLow — guess if the next card is higher or lower. /step + /cashout.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  function cardLabel(r) {
    if (r === undefined || r === null) return "?";
    if (typeof r === "string") return r;
    return RANKS[r] || String(r);
  }

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let roundId = null, busy = false, ended = true;

    const cardEl = el("div", { class: "dice-face" }, "▭");
    const track = el("div", { class: "mult-track" });
    const hiBtn = el("button", { class: "btn accent2 grow" }, "▲ Higher");
    const loBtn = el("button", { class: "btn accent2 grow" }, "▼ Lower");
    const playRow = el("div", { class: "row", style: "display:none" }, [hiBtn, loBtn]);
    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const cashBtn = el("button", { class: "btn good block", style: "display:none" }, "Cash out");

    function pushMult(m, on) {
      track.appendChild(el("div", { class: "mult-step" + (on ? " on" : "") }, m ? (Math.round(m * 100) / 100) + "×" : "?"));
      track.scrollLeft = track.scrollWidth;
    }
    function setCard(r) { cardEl.textContent = "▪ " + cardLabel(r); }

    function applyState(resp) {
      // Enable/disable buttons if the server tells us probabilities are 0.
      const os = resp.outcome_step || resp || {};
      if (os.can_hi !== undefined) hiBtn.disabled = !os.can_hi;
      if (os.can_lo !== undefined) loBtn.disabled = !os.can_lo;
      const cur = os.card !== undefined ? os.card : os.rank !== undefined ? os.rank : (resp.params && resp.params.card);
      if (cur !== undefined) setCard(cur);
    }

    startBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; startBtn.disabled = true;
      banner.hide(); seed.reset(); BT.ui.clear(track);
      const resp = await BT.api.gameBet("highlow", { bet: bet.getBet(), client_seed: C.clientSeed(), params: {} });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id; ended = false;
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      hiBtn.disabled = loBtn.disabled = false;
      applyState(resp);
      startBtn.style.display = "none"; playRow.style.display = "flex"; cashBtn.style.display = "block"; bet.input.disabled = true;
    });

    async function guess(dir) {
      if (busy || ended || !roundId) return; busy = true;
      hiBtn.disabled = loBtn.disabled = cashBtn.disabled = true;
      const resp = await BT.api.gameStep("highlow", { round_id: roundId, move: { guess: dir } });
      cashBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); hiBtn.disabled = loBtn.disabled = false; return; }
      const os = resp.outcome_step || {};
      const shown = os.next_card !== undefined ? os.next_card : os.card !== undefined ? os.card : os.result;
      if (shown !== undefined) setCard(shown);
      pushMult(resp.multiplier, !resp.busted);
      if (resp.busted || resp.done) { finish(resp); return; }
      hiBtn.disabled = loBtn.disabled = false;
      applyState(resp);
      BT.ui.haptic("light");
    }
    hiBtn.addEventListener("click", () => guess("hi"));
    loBtn.addEventListener("click", () => guess("lo"));

    cashBtn.addEventListener("click", async () => {
      if (busy || ended || !roundId) return; busy = true; cashBtn.disabled = true;
      const resp = await BT.api.gameCashout("highlow", { round_id: roundId });
      cashBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      finish(resp);
    });

    function finish(resp) {
      ended = true; roundId = null;
      startBtn.style.display = "block"; playRow.style.display = "none"; cashBtn.style.display = "none"; bet.input.disabled = false;
      seed.revealSeed(resp.server_seed);
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { banner.show("win", "Cashed out +" + BT.ui.fmt(payout) + " pts"); BT.ui.haptic("success"); }
      else { banner.show("lose", "Wrong call — round over."); BT.ui.haptic("error"); }
    }

    root.appendChild(el("div", { class: "card" }, [
      el("h3", { class: "game-title" }, [BT.ui.icon("highlow", 22), el("span", null, "HighLow")]),
      el("p", { class: "small muted" }, "Guess whether the next card is higher or lower. Each correct call chains your multiplier. Cash out any time."),
      cardEl,
      track,
      bet.node,
      startBtn,
      playRow,
      el("div", { class: "spacer" }),
      cashBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "highlow", title: "HighLow", render });
})();
