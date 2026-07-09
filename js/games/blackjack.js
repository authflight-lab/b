// Blackjack — a real-table layout (dealer on top, player on the bottom, felt +
// pays-3-to-2 band), standard hit / stand / double, plus SPLIT on two
// identical-rank cards. Dealer stands on 17 (S17). A natural 21 pays 3:2 and
// settles at deal time; hitting to 21 wins at 2x.
//
// Split rules (server-authoritative, mirrored here): only two IDENTICAL ranks
// (8+8 yes, K+Q no), one split max → two hands, double-after-split allowed,
// split aces get one card each then auto-stand. Each hand resolves independently
// against the single dealer play-out; the credited win is the sum of both hands.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const DEAL_MS = 170;   // stagger between initial-deal cards
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

  // Small inline action-button icons (Rainbet-style). currentColor so each
  // button can tint its own icon.
  function actIcon(kind) {
    const wrap = el("span", { class: "bj-act-ic" });
    const svgs = {
      double: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.4"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
      hit: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="4" width="11" height="15" rx="2"/><path d="M4 8v11a2 2 0 0 0 2 2h9"/></svg>',
      stand: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10.5V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M15 10.5V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1.5a5 5 0 0 1-3.6-1.5L4 15.2a1.6 1.6 0 0 1 2.3-2.2L9 15"/></svg>',
      split: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="8" height="13" rx="1.6" transform="rotate(-9 7 11.5)"/><rect x="13" y="5" width="8" height="13" rx="1.6" transform="rotate(9 17 11.5)"/></svg>',
    };
    wrap.innerHTML = svgs[kind] || "";
    return wrap;
  }

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    let stake = 0;
    const seed = C.seedBox();

    let roundId = null, busy = false, ended = true;
    let mode = "single";       // "single" | "split"
    let player = [], dealer = [];
    let holeHidden = true;
    // Split client state: one object per hand.
    let hands = [];            // [{ cards, done, cardsEl, totalEl, seatEl }]
    let active = 0;
    let acesSplit = false;

    // --- Board: dealer (top) · band · player (bottom) on a felt --------------
    const dealerCards = el("div", { class: "bj-cards" });
    const dealerTotal = el("span", { class: "bj-total", style: "display:none" }, "");
    const dealerArea = el("div", { class: "bj-dealer" }, [
      dealerCards,
      el("div", { class: "bj-total-row" }, [dealerTotal]),
    ]);

    const band = el("div", { class: "bj-band" }, [
      el("div", { class: "bj-band-main" }, "t.me/partygc"),
    ]);

    // Single-hand seat (default). Rebuilt into two seats on a split.
    const playerArea = el("div", { class: "bj-player" });

    const felt = el("div", { class: "bj-felt" }, [dealerArea, band, playerArea]);
    const overlay = C.resultOverlay(felt);

    // ---- Seat construction --------------------------------------------------
    function makeSeat(labelText, isYou) {
      const cardsEl = el("div", { class: "bj-cards" });
      const totalEl = el("span", { class: "bj-total", style: "display:none" }, "");
      const seatEl = el("div", { class: "bj-seat" }, [
        el("div", { class: "bj-total-row" }, [totalEl]),
        cardsEl,
      ]);
      return { cardsEl, totalEl, seatEl, cards: [], done: false };
    }

    // Default single seat.
    let single = makeSeat("You", true);
    function mountSingle() {
      BT.ui.clear(playerArea);
      playerArea.classList.remove("split");
      single = makeSeat("You", true);
      playerArea.appendChild(single.seatEl);
    }
    mountSingle();

    // No-op: the per-seat wager pill was removed from the layout, but call
    // sites are kept (harmless) so the deal/double/split flow doesn't need
    // touching elsewhere.
    function setWager() {}

    function cardEl(r, idx, faceDown) {
      if (faceDown) return el("div", { class: "bj-card back" }, [el("span", { class: "bj-card-crest" }, "")]);
      const su = suitFor(r, idx);
      return el("div", { class: "bj-card " + (su.red ? "red" : "black") }, [
        el("span", { class: "bj-rank" }, rankLabel(r)),
        el("span", { class: "bj-suit" }, su.g),
      ]);
    }

    function updateTotals() {
      if (mode === "single") {
        single.totalEl.style.display = player.length ? "inline-flex" : "none";
        single.totalEl.textContent = player.length ? totalText(player) : "";
      } else {
        hands.forEach((h, i) => {
          h.totalEl.style.display = h.cards.length ? "inline-flex" : "none";
          h.totalEl.textContent = h.cards.length ? totalText(h.cards) : "";
          h.seatEl.classList.toggle("active", i === active && !ended && !h.done);
          h.seatEl.classList.toggle("done", h.done);
        });
      }
      dealerTotal.style.display = dealer.length ? "inline-flex" : "none";
      dealerTotal.textContent = dealer.length
        ? (holeHidden ? String(cardValue(dealer[0])) : totalText(dealer))
        : "";
    }

    function addCard(seat, r, faceDown) {
      seat.cards.push(r);
      seat.cardsEl.appendChild(cardEl(r, seat.cards.length - 1, faceDown));
      updateTotals();
      BT.ui.haptic("light");
    }
    function addDealer(r, faceDown) {
      dealer.push(r);
      dealerCards.appendChild(cardEl(r, dealer.length - 1, faceDown));
      updateTotals();
      BT.ui.haptic("light");
    }

    function clearTable() {
      mode = "single";
      hands = [];
      active = 0;
      acesSplit = false;
      BT.ui.clear(dealerCards);
      dealer = []; player = []; holeHidden = true;
      mountSingle();
      dealerTotal.classList.remove("bust");
      overlay.hide();
      updateTotals();
    }

    // Rotate the hole card out, swap the face in, then deal any extra dealer
    // cards one at a time with suspense pacing.
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
        addDealer(finalDealer[i], false);
      }
    }

    // --- Actions -------------------------------------------------------------
    const dealBtn = el("button", { class: "btn primary block" }, "Deal");
    const hitBtn = actBtn("hit", "Hit", "bj-hit");
    const standBtn = actBtn("stand", "Stand", "bj-stand");
    const doubleBtn = actBtn("double", "Double", "bj-double");
    const splitBtn = actBtn("split", "Split", "bj-split");
    // Order matches the reference: Double · Hit · Stand · Split.
    const actionsRow = el("div", { class: "bj-actions" }, [doubleBtn, hitBtn, standBtn, splitBtn]);

    function actBtn(kind, label, cls) {
      const b = el("button", { class: "bj-act " + cls, type: "button", style: "display:none" }, [
        actIcon(kind),
        el("span", { class: "bj-act-label" }, label),
      ]);
      return b;
    }

    function canSplitNow() {
      if (mode !== "single" || player.length !== 2) return false;
      if (player[0] !== player[1]) return false;      // identical rank only
      const bal = (BT.state && BT.state.balance) || 0;
      return bal >= stake;
    }

    function syncActions(activeOn) {
      const bal = (BT.state && BT.state.balance) || 0;
      if (!activeOn) {
        hitBtn.disabled = standBtn.disabled = doubleBtn.disabled = splitBtn.disabled = true;
        return;
      }
      if (mode === "single") {
        hitBtn.disabled = standBtn.disabled = false;
        doubleBtn.disabled = player.length !== 2 || bal < stake;
        doubleBtn.style.display = "inline-flex";
        // Split shows only when eligible; hides otherwise.
        const showSplit = canSplitNow();
        splitBtn.style.display = showSplit ? "inline-flex" : "none";
        splitBtn.disabled = !showSplit;
      } else {
        // Post-split: no split button; aces auto-stand so no per-hand actions.
        splitBtn.style.display = "none";
        const h = hands[active];
        const live = h && !h.done && !acesSplit;
        hitBtn.disabled = !live;
        standBtn.disabled = !live;
        doubleBtn.style.display = "inline-flex";
        doubleBtn.disabled = !h || h.done || h.cards.length !== 2 || acesSplit || bal < (stake || 0);
      }
    }

    function showActions(on) {
      dealBtn.style.display = on ? "none" : "block";
      const disp = on ? "inline-flex" : "none";
      hitBtn.style.display = standBtn.style.display = doubleBtn.style.display = disp;
      if (!on) splitBtn.style.display = "none";
    }

    // Losses: player cards glow red then fall. Wins / push: the shared overlay.
    async function finish(resp, opts) {
      ended = true; roundId = null;
      BT.clearActiveGame();
      busy = false;
      dealBtn.disabled = false;
      showActions(false);
      bet.setDisabled(false);
      syncActions(false);
      updateTotals();
      C.syncBalance(resp);

      const payout = resp.payout || 0;
      const mult = typeof resp.multiplier === "number" ? resp.multiplier : 0;
      const finalStake = typeof resp.bet === "number" ? resp.bet : stake;
      const natural = !!(opts && opts.natural);
      const busted = !!(opts && opts.busted);
      const isLoss = payout === 0 && mult === 0;
      const isPush = mult === 1;

      const losingNodes = mode === "single"
        ? [single.cardsEl]
        : hands.map((h) => h.cardsEl);

      if (busted) {
        if (mode === "single") {
          single.totalEl.classList.add("bust");
          single.totalEl.textContent = "BUST";
        }
        losingNodes.forEach((n) => n.classList.add("bj-losing"));
        BT.ui.haptic("error");
        await C.frame(FALL_MS);
      } else if (isLoss) {
        losingNodes.forEach((n) => n.classList.add("bj-losing"));
        BT.ui.haptic("error");
        await C.frame(FALL_MS);
      } else if (natural && mult > 1) {
        BT.ui.haptic("success");
        overlay.show("win", "BLACKJACK! " + C.winMult(mult, payout, finalStake), C.winLines(payout, finalStake));
      } else if (isPush) {
        BT.ui.haptic("light");
        overlay.show("push", "1×", "Stake returned");
      } else {
        BT.ui.haptic("success");
        overlay.show("win", C.winMult(mult, payout, finalStake), C.winLines(payout, finalStake));
      }
    }

    // --- Deal ----------------------------------------------------------------
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
      setWager(single, stake, false);
      bet.setDisabled(true);

      // Deal sequence: player → dealer up → player → hole, staggered.
      const p = resp.player || [];
      addCard(single, p[0], false);
      player = single.cards;
      await C.frame(DEAL_MS);
      addDealer(resp.dealer_up, false);
      await C.frame(DEAL_MS);
      addCard(single, p[1], false);
      await C.frame(DEAL_MS);
      dealerCards.appendChild(cardEl(0, 1, true)); // hole, face down
      dealer.push(0);
      updateTotals();
      await C.frame(DEAL_MS);

      if (resp.done) {
        await revealDealer(resp.dealer || dealer);
        await finish(resp, { natural: true });
        return;
      }

      ended = false; busy = false;
      BT.setActiveGame("blackjack", roundId);
      showActions(true);
      syncActions(true);
    });

    // --- Single-hand step (hit / stand / double) -----------------------------
    async function step(action) {
      if (busy || ended || !roundId) return; busy = true;
      syncActions(false);
      const resp = await BT.api.gameStep("blackjack", { round_id: roundId, move: { action } });
      if (!resp || resp.ok === false) {
        busy = false;
        BT.ui.toast(C.errText(resp), "error");
        syncActions(!ended && !!roundId);
        return;
      }
      const os = resp.outcome_step || {};
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      if (typeof resp.bet === "number" && resp.bet !== stake) setWager(single, resp.bet, true);

      const newPlayer = os.player || player;
      for (let i = single.cards.length; i < newPlayer.length; i++) {
        addCard(single, newPlayer[i], false);
        await C.frame(DEAL_MS);
      }
      player = single.cards;

      if (resp.done) {
        if (os.dealer && !resp.busted) await revealDealer(os.dealer);
        await finish(resp, { busted: !!resp.busted });
        return;
      }
      busy = false;
      syncActions(true);
    }

    // --- Split ---------------------------------------------------------------
    async function doSplit() {
      if (busy || ended || !roundId || mode !== "single") return; busy = true;
      syncActions(false);
      const resp = await BT.api.gameStep("blackjack", { round_id: roundId, move: { action: "split" } });
      if (!resp || resp.ok === false) {
        busy = false;
        BT.ui.toast(C.errText(resp), "error");
        syncActions(!ended && !!roundId);
        return;
      }
      const os = resp.outcome_step || {};
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);

      // Rebuild the player area into two seats. The two original cards become
      // the first card of each hand; the dealt second cards slide in.
      mode = "split";
      acesSplit = !!os.aces;
      BT.ui.clear(playerArea);
      playerArea.classList.add("split");
      hands = [makeSeat("Hand 1", true), makeSeat("Hand 2", true)];
      hands.forEach((h) => playerArea.appendChild(h.seatEl));
      const serverHands = os.hands || [];
      // Place each hand's first card immediately, then animate the rest.
      hands.forEach((h, i) => {
        const cards = serverHands[i] || [];
        if (cards.length) addCard(h, cards[0], false);
        setWager(h, stake, false);
      });
      await C.frame(DEAL_MS);
      for (let i = 0; i < hands.length; i++) {
        const cards = serverHands[i] || [];
        for (let j = hands[i].cards.length; j < cards.length; j++) {
          addCard(hands[i], cards[j], false);
          await C.frame(DEAL_MS);
        }
      }
      active = typeof os.active === "number" ? os.active : 0;

      if (resp.done) {
        // Split aces (or both auto-21) settled immediately.
        applyServerHands(os.hands);
        if (os.dealer && !resp.busted) await revealDealer(os.dealer);
        await finish(resp, { busted: !!resp.busted });
        return;
      }
      busy = false;
      updateTotals();
      syncActions(true);
    }

    function applyServerHands(serverHands) {
      if (!Array.isArray(serverHands)) return;
      serverHands.forEach((cards, i) => {
        const h = hands[i];
        if (!h) return;
        for (let j = h.cards.length; j < cards.length; j++) {
          addCard(h, cards[j], false);
        }
      });
    }

    // --- Post-split step (hit / stand / double on the active hand) -----------
    async function stepSplit(action) {
      if (busy || ended || !roundId || mode !== "split") return; busy = true;
      syncActions(false);
      const prevActive = active;
      const resp = await BT.api.gameStep("blackjack", { round_id: roundId, move: { action } });
      if (!resp || resp.ok === false) {
        busy = false;
        BT.ui.toast(C.errText(resp), "error");
        syncActions(!ended && !!roundId);
        return;
      }
      const os = resp.outcome_step || {};
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      if (action === "double" && hands[prevActive]) {
        hands[prevActive].done = true;
        setWager(hands[prevActive], stake * 2, true);
      }

      // Slide in any new cards on the hand that just acted.
      const serverHands = os.hands || [];
      const acted = serverHands[prevActive] || [];
      for (let j = hands[prevActive].cards.length; j < acted.length; j++) {
        addCard(hands[prevActive], acted[j], false);
        await C.frame(DEAL_MS);
      }

      if (resp.done) {
        applyServerHands(os.hands);
        // Mark all hands done for styling.
        hands.forEach((h) => (h.done = true));
        if (os.dealer && !resp.busted) await revealDealer(os.dealer);
        await finish(resp, { busted: !!resp.busted });
        return;
      }

      // Advance to the next hand.
      applyServerHands(os.hands);
      if (typeof os.active === "number") active = os.active;
      if (hands[prevActive] && prevActive !== active) hands[prevActive].done = true;
      busy = false;
      updateTotals();
      syncActions(true);
    }

    // Route the shared buttons to single- or split-mode handlers.
    hitBtn.addEventListener("click", () => (mode === "split" ? stepSplit("hit") : step("hit")));
    standBtn.addEventListener("click", () => (mode === "split" ? stepSplit("stand") : step("stand")));
    doubleBtn.addEventListener("click", () => (mode === "split" ? stepSplit("double") : step("double")));
    splitBtn.addEventListener("click", () => doSplit());

    updateTotals();
    root.appendChild(el("div", { class: "card bj-card-panel" }, [
      C.gameHeader("blackjack", "Blackjack",
        "Classic blackjack against the dealer. Hit, stand, or double down on your first two cards. Split two identical-rank cards into two hands (one split, double-after-split allowed; split aces get one card each). The dealer stands on 17 or higher. A natural blackjack pays 3:2; hitting to 21 wins at 2x; a push returns your stake."),
      felt,
      actionsRow,
      bet.node,
      dealBtn,
      seed.node,
    ]));
  }

  C.register({ key: "blackjack", title: "Blackjack", render });
})();
