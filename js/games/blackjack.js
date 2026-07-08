// Blackjack — standard hit/stand/double, dealer stands on soft/hard 17 (S17).
// Natural 21 on the first two cards pays 3:2 and settles at deal time.
// Hitting to exactly 21 auto-settles at 2x. No splitting or side bets in v1.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const DEAL_MS = 160;   // stagger between initial-deal cards
  const DRAW_MS = 430;   // suspense pacing between dealer draws
  const FLIP_MS = 170;   // half of the hole-card rotateY flip
  const FALL_MS = 560;   // loss card fall animation duration

  const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const SUITS = [
    { g: "♠", red: false },
    { g: "♥", red: true },
    { g: "♦", red: true },
    { g: "♣", red: false },
  ];
  const rankLabel = (r) => RANKS[r] || "?";
  const suitFor = (r, idx) => SUITS[(r * 3 + idx * 5 + 1) % 4];

  function cardValue(r) {
    if (r === 1) return 11;
    return r >= 10 ? 10 : r;
  }
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

    // --- Board ---------------------------------------------------------------
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
      el("div", { class: "bj-hand-head" }, [el("span", { class: "bj-hand-label you" }, "You"), playerTotal, wagerChip]),
      playerCards,
    ]);
    const table = el("div", { class: "bj-table" }, [dealerRow, playerRow]);

    // Standard win overlay — shared component used by every other game.
    const overlay = C.resultOverlay(table);

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

    let holeHidden = true;
    function updateTotals() {
      playerTotal.textContent = player.length ? totalText(player) : "";
      dealerTotal.textContent = dealer.length
        ? (holeHidden ? String(cardValue(dealer[0])) : totalText(dealer))
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
      playerCards.classList.remove("bj-losing");
      overlay.hide();
      updateTotals();
    }

    // Rotates hole card out, swaps face in, then deals any extra dealer cards
    // one at a time with suspense pacing.
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

    // --- Actions -------------------------------------------------------------
    const dealBtn = el("button", { class: "btn primary block" }, "Deal");
    const hitBtn = el("button", { class: "btn primary", style: "display:none" }, "Hit");
    const standBtn = el("button", { class: "btn", style: "display:none" }, "Stand");
    const doubleBtn = el("button", { class: "btn", style: "display:none" }, "Double");
    const actionsRow = el("div", { class: "bj-actions" }, [hitBtn, standBtn, doubleBtn]);

    function syncActions(active) {
      if (!active) { hitBtn.disabled = standBtn.disabled = doubleBtn.disabled = true; return; }
      hitBtn.disabled = false;
      standBtn.disabled = false;
      const bal = (BT.state && BT.state.balance) || 0;
      doubleBtn.disabled = player.length !== 2 || bal < stake;
    }

    function showActions(on) {
      dealBtn.style.display = on ? "none" : "block";
      hitBtn.style.display = standBtn.style.display = doubleBtn.style.display = on ? "inline-block" : "none";
    }

    // Losses: player cards glow red then fall — no overlay.
    // Wins / push: standard win overlay.
    async function finish(resp, opts) {
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
      const natural = !!(opts && opts.natural);

      const isLoss = payout === 0 && mult === 0;  // bust or dealer wins
      const isPush = mult === 1;

      if (isLoss) {
        // Red glow, then cards fall off the table — no overlay.
        playerCards.classList.add("bj-losing");
        BT.ui.haptic("error");
        await C.frame(FALL_MS);
      } else if (natural && mult > 1) {
        BT.ui.haptic("success");
        overlay.show("win",
          "BLACKJACK! " + C.winMult(mult, payout, finalStake),
          C.winLines(payout, finalStake));
      } else if (isPush) {
        BT.ui.haptic("light");
        overlay.show("push", "1×", "Stake returned");
      } else {
        BT.ui.haptic("success");
        overlay.show("win",
          C.winMult(mult, payout, finalStake),
          C.winLines(payout, finalStake));
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
        // Natural blackjack settled at deal time — flip hole, show overlay.
        await revealDealer(resp.dealer || dealer);
        await finish(resp, { natural: true });
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

      // Slide in any new player cards.
      const newPlayer = os.player || player;
      for (let i = player.length; i < newPlayer.length; i++) {
        addCard(playerCards, player, newPlayer[i], false);
        await C.frame(DEAL_MS);
      }

      if (resp.done) {
        if (os.dealer) await revealDealer(os.dealer);
        await finish(resp, {});
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
      C.gameHeader("blackjack", "Blackjack", "Classic blackjack against the dealer. Hit, stand, or double down on your first two cards. The dealer stands on 17 or higher. A natural blackjack pays 3:2; hitting to 21 wins at 2x; a push returns your stake. No splitting or side bets."),
      table,
      actionsRow,
      bet.node,
      dealBtn,
      seed.node,
    ]));
  }

  C.register({ key: "blackjack", title: "Blackjack", render });
})();
