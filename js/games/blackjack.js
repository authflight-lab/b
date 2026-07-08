// Blackjack — standard hit/stand/double, dealer stands on soft/hard 17 (S17).
// Blackjack (natural 21 on the first two cards) pays 3:2 and settles instantly
// at deal time; a push (equal totals) returns the stake (1.0x). No splitting or
// side bets in v1. The dealer's hole card stays hidden until the hand ends.
//
// Presentation follows the house style (see game-optimistic-motion): the server
// response is the only source of truth, but every card arrives PACED — the
// initial deal staggers player/dealer/player/hole, a hit slides the new card
// in, and at hand end the hole card FLIPS over before the dealer draws out one
// card at a time. Outcomes land ON the table (stamp + hand glow), not in an
// overlay: BUST (red), WIN (green), PUSH (neutral), BLACKJACK (celebratory).
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const DEAL_MS = 160;   // stagger between initial-deal cards
  const DRAW_MS = 430;   // suspense pacing between dealer draws
  const FLIP_MS = 170;   // half of the hole-card rotateY flip

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
  // Returns { total, soft } — soft means an ace is still counted as 11, so the
  // hand reads "7/17" style (the low total is always total - 10).
  function handTotal(cards) {
    let total = 0, aces = 0;
    cards.forEach((r) => { total += cardValue(r); if (r === 1) aces += 1; });
    while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
    return { total, soft: aces > 0 };
  }
  const totalText = (cards) => {
    const t = handTotal(cards);
    return t.soft && t.total <= 21 ? (t.total - 10) + "/" + t.total : String(t.total);
  };

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    let stake = 0;
    const seed = C.seedBox();

    let roundId = null, busy = false, ended = true;
    let player = [], dealer = [];

    // --- Board: dealer row (top) + player row (bottom) ----------------------
    const dealerCards = el("div", { class: "bj-cards" });
    const dealerTotal = el("span", { class: "bj-total" }, "");
    const dealerRow = el("div", { class: "bj-hand" }, [
      el("div", { class: "bj-hand-head" }, [el("span", { class: "bj-hand-label" }, "Dealer"), dealerTotal]),
      dealerCards,
    ]);
    const playerCards = el("div", { class: "bj-cards" });
    const playerTotal = el("span", { class: "bj-total" }, "");
    const wagerChip = el("span", { class: "bj-wager", style: "display:none" }, "");
    const playerRow = el("div", { class: "bj-hand" }, [
      el("div", { class: "bj-hand-head" }, [el("span", { class: "bj-hand-label" }, "You"), playerTotal, wagerChip]),
      playerCards,
    ]);
    const stampEl = el("div", { class: "bj-stamp", style: "display:none" });
    const table = el("div", { class: "bj-table" }, [dealerRow, playerRow, stampEl]);

    function setWager(amount, doubled) {
      wagerChip.style.display = amount > 0 ? "inline-flex" : "none";
      wagerChip.classList.toggle("doubled", !!doubled);
      wagerChip.textContent = amount > 0 ? BT.ui.fmt(amount) + " pts" + (doubled ? " ·2×" : "") : "";
    }

    function cardEl(r, idx, faceDown) {
      if (faceDown) return el("div", { class: "bj-card back" }, "");
      const su = suitFor(r, idx);
      return el("div", { class: "bj-card " + (su.red ? "red" : "black") }, [
        el("span", null, rankLabel(r)),
        el("span", { class: "bj-suit" }, su.g),
      ]);
    }

    // Append one card with the slide-in animation, then update the totals.
    // `holeHidden` keeps the dealer total reading "N+?" while the hole is down.
    let holeHidden = true;
    function updateTotals() {
      playerTotal.textContent = player.length ? totalText(player) : "";
      dealerTotal.textContent = dealer.length
        ? (holeHidden ? String(cardValue(dealer[0])) + "+?" : totalText(dealer))
        : "";
    }
    function addCard(handEl, hand, r, faceDown) {
      hand.push(r);
      handEl.appendChild(cardEl(r, hand.length - 1, faceDown));
      updateTotals();
      BT.ui.haptic("light");
    }

    function clearTable() {
      BT.ui.clear(dealerCards); BT.ui.clear(playerCards);
      player = []; dealer = []; holeHidden = true;
      dealerRow.classList.remove("bj-glow-win", "bj-glow-lose", "bj-glow-push");
      playerRow.classList.remove("bj-glow-win", "bj-glow-lose", "bj-glow-push");
      stampEl.style.display = "none";
      updateTotals();
    }

    // The iconic beat: rotateY the hole card out, swap the face in, then (if
    // the dealer drew) deal each extra card with suspense pacing.
    async function revealDealer(finalDealer) {
      if (!Array.isArray(finalDealer) || finalDealer.length < 2) return;
      const holeNode = dealerCards.children[1];
      if (holeNode) {
        holeNode.classList.add("bj-flip-out");
        await C.frame(FLIP_MS);
        const face = cardEl(finalDealer[1], 1, false);
        face.classList.add("bj-flip-in");
        dealerCards.replaceChild(face, holeNode);
      }
      dealer = finalDealer.slice(0, 2);
      holeHidden = false;
      updateTotals();
      BT.ui.haptic("light");
      for (let i = 2; i < finalDealer.length; i++) {
        await C.frame(DRAW_MS);
        addCard(dealerCards, dealer, finalDealer[i], false);
      }
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
      // Double needs a second stake: gate on the 2-card hand AND affordability.
      const bal = (BT.state && BT.state.balance) || 0;
      doubleBtn.disabled = player.length !== 2 || bal < stake;
    }

    function showActions(on) {
      dealBtn.style.display = on ? "none" : "block";
      hitBtn.style.display = standBtn.style.display = doubleBtn.style.display = on ? "inline-block" : "none";
    }

    // On-table outcome. Quiet for losses; celebratory for wins/naturals.
    function stamp(kind, main, sub) {
      stampEl.className = "bj-stamp " + kind;
      BT.ui.clear(stampEl);
      stampEl.appendChild(el("span", { class: "bj-stamp-main" }, main));
      if (sub) stampEl.appendChild(el("span", { class: "bj-stamp-sub" }, sub));
      stampEl.style.display = "flex";
    }

    function finish(resp, opts) {
      ended = true; roundId = null;
      BT.clearActiveGame();
      busy = false;
      dealBtn.disabled = false;
      showActions(false);
      bet.setDisabled(false);
      syncActions(false);
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      const mult = typeof resp.multiplier === "number" ? resp.multiplier : 0;
      const finalStake = typeof resp.bet === "number" ? resp.bet : stake;
      const busted = !!(opts && opts.busted);
      const natural = !!(opts && opts.natural);
      if (busted) {
        playerRow.classList.add("bj-glow-lose");
        stamp("lose", "BUST", "-" + BT.ui.fmt(finalStake) + " pts");
        BT.ui.haptic("error");
      } else if (natural && mult > 1) {
        playerRow.classList.add("bj-glow-win");
        stamp("natural", "BLACKJACK!", C.winMult(mult, payout, finalStake) + " · +" + BT.ui.fmt(payout - finalStake) + " pts");
        BT.ui.haptic("success");
      } else if (mult === 1) {
        playerRow.classList.add("bj-glow-push");
        dealerRow.classList.add("bj-glow-push");
        stamp("push", "PUSH", "Stake returned");
        BT.ui.haptic("light");
      } else if (payout > 0) {
        playerRow.classList.add("bj-glow-win");
        stamp("win", "WIN " + C.winMult(mult, payout, finalStake), "+" + BT.ui.fmt(payout - finalStake) + " pts");
        BT.ui.haptic("success");
      } else {
        playerRow.classList.add("bj-glow-lose");
        dealerRow.classList.add("bj-glow-win");
        stamp("lose", "Dealer wins", "-" + BT.ui.fmt(finalStake) + " pts");
        BT.ui.haptic("error");
      }
    }

    dealBtn.addEventListener("click", async () => {
      if (busy || !ended) return; busy = true; dealBtn.disabled = true;
      seed.reset();
      stake = bet.getBet();
      const resp = await BT.api.gameBet("blackjack", { bet: stake, params: {} });
      if (!resp || resp.ok === false) {
        busy = false; dealBtn.disabled = false;
        BT.ui.toast(C.errText(resp), "error");
        return;
      }
      roundId = resp.round_id;
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce); BT.fair.noteBet(resp);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      clearTable();
      setWager(stake, false);
      bet.setDisabled(true);

      // Deal sequence: player → dealer up → player → hole, staggered.
      const p = resp.player || [];
      addCard(playerCards, player, p[0], false);
      await C.frame(DEAL_MS);
      addCard(dealerCards, dealer, resp.dealer_up, false);
      await C.frame(DEAL_MS);
      addCard(playerCards, player, p[1], false);
      await C.frame(DEAL_MS);
      dealerCards.appendChild(cardEl(0, 1, true)); // hole, face down
      dealer.push(0);
      updateTotals();
      await C.frame(DEAL_MS);

      if (resp.done) {
        // Natural blackjack settled instantly at deal time — still give it
        // the full reveal: flip the hole, then stamp the celebration/push.
        await revealDealer(resp.dealer || dealer);
        finish(resp, { natural: true });
        return;
      }

      ended = false; busy = false;
      BT.setActiveGame("blackjack", roundId);
      showActions(true);
      syncActions(true);
    });

    async function step(action) {
      if (busy || ended || !roundId) return; busy = true;
      hitBtn.disabled = standBtn.disabled = doubleBtn.disabled = true;
      const resp = await BT.api.gameStep("blackjack", { round_id: roundId, move: { action } });
      if (!resp || resp.ok === false) {
        busy = false;
        BT.ui.toast(C.errText(resp), "error");
        syncActions(!ended && !!roundId);
        return;
      }
      const os = resp.outcome_step || {};
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      if (typeof resp.bet === "number" && resp.bet !== stake) setWager(resp.bet, true);

      // Slide in any new player card(s) — one for hit/double.
      const newPlayer = os.player || player;
      for (let i = player.length; i < newPlayer.length; i++) {
        addCard(playerCards, player, newPlayer[i], false);
        await C.frame(DEAL_MS);
      }

      if (resp.done) {
        if (os.dealer) await revealDealer(os.dealer);
        finish(resp, { busted: !!resp.busted });
        return;
      }
      busy = false;
      syncActions(true);
    }

    hitBtn.addEventListener("click", () => step("hit"));
    standBtn.addEventListener("click", () => step("stand"));
    doubleBtn.addEventListener("click", () => step("double"));

    updateTotals();
    root.appendChild(el("div", { class: "card" }, [
      C.gameHeader("blackjack", "Blackjack", "Classic blackjack against the dealer. Hit, stand, or double down on your first two cards. The dealer stands on 17 or higher. A natural blackjack (21 on your first two cards) pays 3:2; a push returns your stake. No splitting or side bets."),
      table,
      actionsRow,
      bet.node,
      dealBtn,
      seed.node,
    ]));
  }

  C.register({ key: "blackjack", title: "Blackjack", render });
})();
