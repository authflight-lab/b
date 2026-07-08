// Blackjack — standard hit/stand/double, dealer stands on soft/hard 17 (S17).
// Blackjack (natural 21 on the first two cards) pays 3:2 and settles instantly
// at deal time; a push (equal totals) returns the stake (1.0x). No splitting or
// side bets in v1. The dealer's hole card stays hidden until the hand ends.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const SUITS = [
    { g: "♠", red: false },
    { g: "♥", red: true },
    { g: "♦", red: true },
    { g: "♣", red: false },
  ];
  const rankLabel = (r) => RANKS[r] || "?";
  // Deterministic, cosmetic suit per card position — the backend only tracks
  // ranks 1..13, so suits are purely a client-side visual (matches HighLow).
  const suitFor = (r, idx) => SUITS[(r * 3 + idx * 5 + 1) % 4];

  function cardValue(r) {
    if (r === 1) return 11;
    return r >= 10 ? 10 : r;
  }
  function handTotal(cards) {
    let total = 0, aces = 0;
    cards.forEach((r) => { total += cardValue(r); if (r === 1) aces += 1; });
    while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
    return total;
  }

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    let stake = 0;
    const seed = C.seedBox();
    const banner = C.resultBanner();

    let roundId = null, busy = false, ended = true;
    let player = [], dealer = [], dealerHidden = true;

    // --- Board: dealer row (top) + player row (bottom) ----------------------
    const dealerCards = el("div", { class: "bj-cards" });
    const dealerTotal = el("span", { class: "bj-total" }, "");
    const dealerRow = el("div", { class: "bj-hand" }, [
      el("div", { class: "bj-hand-head" }, [el("span", { class: "bj-hand-label" }, "Dealer"), dealerTotal]),
      dealerCards,
    ]);
    const playerCards = el("div", { class: "bj-cards" });
    const playerTotal = el("span", { class: "bj-total" }, "");
    const playerRow = el("div", { class: "bj-hand" }, [
      el("div", { class: "bj-hand-head" }, [el("span", { class: "bj-hand-label" }, "You"), playerTotal]),
      playerCards,
    ]);
    const table = el("div", { class: "bj-table" }, [dealerRow, playerRow]);
    const overlay = C.resultOverlay(table);

    function cardEl(r, idx, faceDown) {
      if (faceDown) return el("div", { class: "bj-card back" }, "");
      const su = suitFor(r, idx);
      return el("div", { class: "bj-card " + (su.red ? "red" : "black") }, [
        el("span", null, rankLabel(r)),
        el("span", { class: "bj-suit" }, su.g),
      ]);
    }

    function renderHands() {
      BT.ui.clear(dealerCards);
      dealer.forEach((r, i) => dealerCards.appendChild(cardEl(r, i, dealerHidden && i === 1)));
      BT.ui.clear(playerCards);
      player.forEach((r, i) => playerCards.appendChild(cardEl(r, i, false)));
      playerTotal.textContent = player.length ? String(handTotal(player)) : "";
      dealerTotal.textContent = dealer.length ? (dealerHidden ? String(cardValue(dealer[0])) + "+?" : String(handTotal(dealer))) : "";
    }

    // --- Actions --------------------------------------------------------------
    const dealBtn = el("button", { class: "btn primary block" }, "Deal");
    const hitBtn = el("button", { class: "btn primary", style: "display:none" }, "Hit");
    const standBtn = el("button", { class: "btn", style: "display:none" }, "Stand");
    const doubleBtn = el("button", { class: "btn", style: "display:none" }, "Double");
    const actionsRow = el("div", { class: "bj-actions" }, [hitBtn, standBtn, doubleBtn]);

    function syncActions(active) {
      if (!active) { hitBtn.disabled = standBtn.disabled = doubleBtn.disabled = true; return; }
      hitBtn.disabled = false;
      standBtn.disabled = false;
      doubleBtn.disabled = player.length !== 2;
    }

    dealBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; dealBtn.disabled = true;
      overlay.hide(); banner.hide(); seed.reset();
      stake = bet.getBet();
      const resp = await BT.api.gameBet("blackjack", { bet: stake, params: {} });
      dealBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id;
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce); BT.fair.noteBet(resp);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      player = resp.player || [];
      dealer = resp.dealer_up !== undefined ? [resp.dealer_up, 0] : [];
      dealerHidden = true;
      renderHands();

      if (resp.done) {
        // Natural blackjack settled instantly at deal time.
        ended = true; roundId = null;
        dealer = resp.dealer || dealer;
        dealerHidden = false;
        renderHands();
        finish(resp);
        return;
      }

      ended = false;
      BT.setActiveGame("blackjack", roundId);
      dealBtn.style.display = "none"; bet.setDisabled(true);
      hitBtn.style.display = "inline-block"; standBtn.style.display = "inline-block";
      doubleBtn.style.display = "inline-block";
      syncActions(true);
    });

    async function step(action) {
      if (busy || ended || !roundId) return; busy = true;
      hitBtn.disabled = standBtn.disabled = doubleBtn.disabled = true;
      const resp = await BT.api.gameStep("blackjack", { round_id: roundId, move: { action } });
      busy = false;
      if (!resp || resp.ok === false) {
        BT.ui.toast(C.errText(resp), "error");
        syncActions(!ended && !!roundId);
        return;
      }
      const os = resp.outcome_step || {};
      if (os.player) player = os.player;
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      if (resp.done) {
        ended = true; roundId = null;
        if (os.dealer) { dealer = os.dealer; dealerHidden = false; }
        renderHands();
        finish(resp);
        return;
      }
      renderHands();
      syncActions(true);
      BT.ui.haptic("light");
    }

    hitBtn.addEventListener("click", () => step("hit"));
    standBtn.addEventListener("click", () => step("stand"));
    doubleBtn.addEventListener("click", () => step("double"));

    function finish(resp) {
      BT.clearActiveGame();
      dealBtn.style.display = "block"; bet.setDisabled(false);
      hitBtn.style.display = "none"; standBtn.style.display = "none"; doubleBtn.style.display = "none";
      syncActions(false);
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { overlay.show("win", C.winMult(resp.multiplier, payout, stake), C.winLines(payout, stake)); BT.ui.haptic("success"); }
      else { BT.ui.haptic("error"); }
    }

    renderHands();
    root.appendChild(el("div", { class: "card" }, [
      C.gameHeader("blackjack", "Blackjack", "Classic blackjack against the dealer. Hit, stand, or double down on your first two cards. The dealer stands on 17 or higher. A natural blackjack (21 on your first two cards) pays 3:2; a push returns your stake. No splitting or side bets."),
      table,
      actionsRow,
      bet.node,
      dealBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "blackjack", title: "Blackjack", render });
})();
