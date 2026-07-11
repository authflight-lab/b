// Play — game selector for all games. Age gate + disclaimers render first.
// The client renders server outcomes only; no odds/RNG/payout math here.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;

  const ORDER = ["dice", "flip", "mines", "towers", "highlow", "plinko", "rps", "chicken", "crash", "blackjack", "keno"];
  const NEW_GAMES = ["rps", "chicken", "crash", "blackjack", "keno"];
  let selected = "dice";

  // ---- Provably Fair: verification code shown per game ----------------------
  // Shared commit-reveal + RNG core (matches api/game/seed.py). Every draw is
  // the first 4 bytes of HMAC-SHA256(server_seed, "client_seed:nonce:cursor").
  const FAIR_PREAMBLE =
    "import { createHmac, createHash } from 'crypto';\n" +
    "\n" +
    "// 1) Commitment: the hash shown BEFORE the round must match the seed.\n" +
    "const fair = createHash('sha256').update(serverSeed).digest('hex') === serverHash;\n" +
    "\n" +
    "// 2) One RNG draw in [0,1): first 4 bytes of HMAC-SHA256.\n" +
    "const rng = (cursor) => {\n" +
    "  const h = createHmac('sha256', serverSeed)\n" +
    "    .update(`${clientSeed}:${nonce}:${cursor}`).digest();\n" +
    "  return [0, 1, 2, 3].reduce((u, i) => u + h[i] / 256 ** (i + 1), 0);\n" +
    "};\n";

  const FAIR_CODE = {
    dice:
      FAIR_PREAMBLE +
      "\n" +
      "// Dice — one draw. Win if roll > target (target in 2..98).\n" +
      "const roll = rng(0) * 100;\n" +
      "const win = roll > target;\n" +
      "const multiplier = win ? (0.98 * 100 / (100 - target)) : 0;   // 2% edge\n",
    flip:
      FAIR_PREAMBLE +
      "\n" +
      "// Flip — one draw per flip; win if u < 0.5. cursor = flip index (0-based).\n" +
      "const win = rng(cursor) < 0.5;\n" +
      "const multiplier = 1.96 ** streak;   // after `streak` straight wins\n",
    mines:
      FAIR_PREAMBLE +
      "\n" +
      "// Mines — Fisher-Yates shuffle of 25 cells; first `mineCount` are mines.\n" +
      "const rngInt = (cursor, n) => Math.floor(rng(cursor) * n);\n" +
      "const cells = [...Array(25).keys()];\n" +
      "let cursor = 0;\n" +
      "for (let i = 24; i > 0; i--) {\n" +
      "  const j = rngInt(cursor++, i + 1);\n" +
      "  [cells[i], cells[j]] = [cells[j], cells[i]];\n" +
      "}\n" +
      "const mines = cells.slice(0, mineCount).sort((a, b) => a - b);\n",
    towers:
      FAIR_PREAMBLE +
      "\n" +
      "// Towers — one trap column per floor. C columns per floor by difficulty.\n" +
      "const rngInt = (cursor, n) => Math.floor(rng(cursor) * n);\n" +
      "const C = { easy: 4, medium: 3, hard: 2 }[difficulty];\n" +
      "const trapOnFloor = (floor) => rngInt(floor, C);   // 0-based floor\n",
    highlow:
      FAIR_PREAMBLE +
      "\n" +
      "// HighLow — cards 1..13. Aces(1) & Kings(13) are wild (never the current\n" +
      "// card); STRIDE=64 draw slots are reserved per step to skip them.\n" +
      "const RANKS = 13, STRIDE = 64;\n" +
      "const card = (u) => Math.floor(u * RANKS) + 1;\n" +
      "const wild = (r) => r <= 1 || r >= RANKS;\n" +
      "const next = card(rng(slot * STRIDE));            // revealed next card\n" +
      "let current;                                       // first non-wild draw\n" +
      "for (let j = 0; j < STRIDE; j++) {\n" +
      "  const r = card(rng(slot * STRIDE + j));\n" +
      "  if (!wild(r)) { current = r; break; }\n" +
      "}\n" +
      "// Ties win: higher -> next >= current ; lower -> next <= current\n",
    plinko:
      FAIR_PREAMBLE +
      "\n" +
      "// Plinko — one draw per row. u < 0.5 bounces right (+1), else left (+0).\n" +
      "let bucket = 0;\n" +
      "for (let cursor = 0; cursor < rows; cursor++) {\n" +
      "  if (rng(cursor) < 0.5) bucket++;\n" +
      "}\n" +
      "// bucket in [0, rows] -> multiplier from the payout table\n",
    rps:
      FAIR_PREAMBLE +
      "\n" +
      "// RPS — one draw per round. cursor = round index (ties consume one too).\n" +
      "const HANDS = ['rock', 'paper', 'scissors'];\n" +
      "const house = HANDS[Math.min(2, Math.floor(rng(cursor) * 3))];\n" +
      "// win: (playerIdx - houseIdx + 3) % 3 === 1 ; a tie replays, no change\n" +
      "const multiplier = Math.min(1.96 ** wins, 20);   // 2% edge, capped 20x\n",
    chicken:
      FAIR_PREAMBLE +
      "\n" +
      "// Chicken — a 25-zone deck with ONE car, drawn without replacement:\n" +
      "// lane k (0-based) has 25 - k zones left; the seeded draw picks the car\n" +
      "// among them. cursor = lane index.\n" +
      "const rngInt = (cursor, n) => Math.floor(rng(cursor) * n);\n" +
      "const car = rngInt(lane, 25 - lane);\n" +
      "// safe if your zone !== car\n" +
      "const multiplier = 0.96 * 25 / (25 - lanes);   // 4% edge; lane 24 = 24x\n",
    crash:
      FAIR_PREAMBLE +
      "\n" +
      "// Crash — ONE draw fixes the round's crash point before you bet.\n" +
      "const u = rng(0);\n" +
      "const crashPoint = Math.min(Math.max(1.0, 0.98 / u), 25);   // 2% edge, 25x cap\n" +
      "// The curve is server-clocked from the bet: mult = e^(0.00006 * ms).\n" +
      "// You win your claimed multiplier iff it is BELOW crashPoint AND your\n" +
      "// cashout arrives before the curve reaches it (wins are clamped to the\n" +
      "// server clock); waiting past crashPoint loses the stake.\n",
    blackjack:
      FAIR_PREAMBLE +
      "\n" +
      "// Blackjack — ranks 1..13 (A..K), drawn in dealing order:\n" +
      "// cursor 0=player c1, 1=dealer up, 2=player c2, 3=dealer hole,\n" +
      "// then 4,5,6... for every hit/dealer draw.\n" +
      "const rank = (u) => Math.floor(u * 13) + 1;\n" +
      "const card = (cursor) => rank(rng(cursor));\n" +
      "// Ace counts 11 (soft) unless it busts the hand, then 1. Dealer hits\n" +
      "// while total < 17 (stands on soft/hard 17 — S17). Natural 21 on the\n" +
      "// first two cards pays 3:2 immediately; a push (equal totals) is 1.0x.\n",
  };

  function render(root) {
    // Gate on age acknowledgement before showing any game.
    BT.requireAge(() => renderGames(root), () => {
      BT.ui.clear(root);
      root.appendChild(BT.ui.notice("You must confirm you are 18+ and accept the disclaimer to play."));
      root.appendChild(el("div", { class: "spacer" }));
      root.appendChild(el("button", { class: "btn primary block", onclick: () => render(root) }, "Review disclaimer"));
    });
  }

  function renderGames(root) {
    BT.ui.clear(root);

    // Header row: game grid title area with the rank badge pill on the right.
    // (Provably Fair now lives inside each game's header, next to the ⓘ icon.)
    const rankBtn = el("button", {
      class: "rank-pill", type: "button", title: "Your rewards", "aria-label": "Your rewards",
      onclick: () => BT.rank.openPanel(),
    }, [el("span", { class: "rank-pill-name" }, "Unranked")]);
    BT.rank.summary().then((s) => { if (rankBtn.isConnected) BT.rank.fillPill(rankBtn, s); });
    // Live balance chip beside the rank pill; kept in sync by BT.setBalance.
    const balChip = el("div", { class: "fair-bal", title: "Your balance" }, [
      BT.ui.icon("token", 17),
      el("span", { id: "play-bal-value" }, BT.ui.fmt(BT.state.balance)),
    ]);
    // Wager history moved out of the navbar to sit beside the balance chip.
    const histBtn = el("button", {
      class: "play-hist-btn", type: "button", title: "Wager history", "aria-label": "Wager history",
      onclick: () => { if (BT.bets) BT.bets.open(); },
    }, [BT.ui.icon("paper", 16)]);
    root.appendChild(el("div", { class: "play-head" }, [
      el("span", { class: "play-head-title" }, "Games"),
      el("div", { class: "play-head-right" }, [balChip, histBtn, rankBtn]),
    ]));

    // Compact horizontal selector strip (scrollable) so the game panel sits
    // right below with minimal scrolling.
    const strip = el("div", { class: "game-strip" });
    ORDER.forEach((key) => {
      const g = BT.games.registry[key];
      if (!g) return;
      strip.appendChild(el("div", {
        class: "game-chip" + (selected === key ? " active" : ""),
        onclick: () => {
          if (BT.activeGame && BT.activeGame.name !== key) {
            BT.ui.toast("Cash out your current game first.", "error");
            try { BT.ui.haptic("error"); } catch (e) {}
            return;
          }
          selected = key; renderGames(root);
        },
      }, [
        el("span", { class: "g-ico" }, BT.ui.icon(key, 18)),
        el("span", { class: "g-name" }, g.title),
        NEW_GAMES.includes(key) ? el("span", { class: "g-new" }, "NEW") : null,
      ]));
    });
    root.appendChild(strip);
    // Keep the selected chip visible without the user hunting for it.
    const act = strip.querySelector(".game-chip.active");
    if (act) requestAnimationFrame(() => {
      try { act.scrollIntoView({ block: "nearest", inline: "center" }); } catch (e) {}
    });

    if (!BT.api.isConfigured()) {
      root.appendChild(BT.ui.notice("The game server isn't connected yet. You can browse the games, but betting is disabled until it's live."));
    }

    const panel = el("div", { id: "game-panel" });
    root.appendChild(panel);
    const g = BT.games.registry[selected];
    if (g) {
      try { g.render(panel); }
      catch (e) { panel.appendChild(BT.ui.notice("Couldn't load that game.")); }
    }

    // Session stats — scoped to THIS game panel only: every render of the
    // play screen (opening the page, switching games) starts a fresh tally,
    // so the card never carries totals across games or navigations. It is
    // still fed centrally (api.js/BT.session) while the panel is mounted.
    BT.session.reset();
    root.appendChild(BT.games.common.sessionPanel());
  }

  // Provably Fair panel (Rainbet-style seed pair). Two sections:
  //   • Seeds  — the ACTIVE pair's client_seed / nonce / server_hash (the active
  //     server seed is never shown; only its hash). If a previous pair has been
  //     rotated out, its revealed server_seed is shown so it can be verified.
  //   • Rotate — set a new client seed (or randomize) and rotate: this reveals
  //     the current server seed and commits the pre-shown next server hash.
  // The panel is driven entirely by BT.fair, not by any per-round game state.
  async function openFair(key) {
    const sel = (key && BT.games.registry[key]) ? key : selected;
    const g = BT.games.registry[sel];

    const overlay = el("div", { class: "overlay" });
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    // A copyable value row with a small inline Copy button.
    const seedRow = (label, value) => {
      const val = el("div", { class: "mono" }, value || "—");
      const btn = el("button", { class: "copy-btn mini" }, "Copy");
      btn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(value || ""); btn.textContent = "Copied"; }
        catch (e) { btn.textContent = "Failed"; }
        setTimeout(() => (btn.textContent = "Copy"), 1200);
      });
      return el("div", { class: "fair-seed-row" }, [
        el("span", { class: "k" }, label),
        el("div", { class: "fair-seed-val" }, [val, btn]),
      ]);
    };

    // --- Section 1: active seeds (re-rendered after a rotation) ---------------
    const seedsBox = el("div", { class: "fair-section" });
    // --- Section 2: rotation controls ----------------------------------------
    const rotateBox = el("div", { class: "fair-section" });

    function renderSeeds() {
      const s = BT.fair.getState() || { clientSeed: "", nonce: 0, serverHash: "", nextServerHash: "", revealed: null };
      BT.ui.clear(seedsBox);
      seedsBox.appendChild(el("div", { class: "fair-section-title" }, "Active Seeds"));
      seedsBox.appendChild(seedRow("client_seed", s.clientSeed));
      seedsBox.appendChild(seedRow("nonce", String(s.nonce)));
      seedsBox.appendChild(seedRow("server_hash (committed)", s.serverHash));
      if (s.revealed) {
        seedsBox.appendChild(el("p", { class: "fair-note" },
          "Previous server_seed (rotated out — verify past bets against it):"));
        seedsBox.appendChild(seedRow("prev server_seed", s.revealed));
      }
    }

    function renderRotate() {
      const s = BT.fair.getState() || { clientSeed: "", nextServerHash: "" };
      BT.ui.clear(rotateBox);
      rotateBox.appendChild(el("div", { class: "fair-section-title" }, "Rotate Seeds"));
      rotateBox.appendChild(el("p", { class: "fair-note" },
        "Rotating reveals your current server seed and activates a new pair. The next server hash below is committed in advance."));

      const input = el("input", {
        type: "text", class: "fair-rotate-input", placeholder: "New client seed (optional)",
        value: s.clientSeed || "",
      });
      const randBtn = el("button", { class: "btn ghost" }, "Randomize");
      randBtn.addEventListener("click", () => { input.value = BT.fair.randomSeed(); });

      rotateBox.appendChild(el("div", { class: "fair-rotate-row" }, [input, randBtn]));
      rotateBox.appendChild(seedRow("next_server_hash", s.nextServerHash));

      const confirm = el("button", { class: "btn primary block" }, "Confirm Rotate");
      confirm.addEventListener("click", async () => {
        confirm.disabled = true; confirm.textContent = "Rotating…";
        const r = await BT.fair.rotate(input.value);
        confirm.disabled = false; confirm.textContent = "Confirm Rotate";
        if (!r || r.ok === false) {
          const code = (r && r.error) || "unknown_error";
          const msg = code === "open_round_exists"
            ? "Finish your current round before rotating seeds."
            : "Couldn't rotate seeds — please try again.";
          BT.ui.toast(msg, "error");
          return;
        }
        BT.ui.toast("Seeds rotated. Previous server seed revealed.", "success");
        renderSeeds();
        renderRotate();
      });
      rotateBox.appendChild(el("div", { class: "spacer" }));
      rotateBox.appendChild(confirm);
    }

    // --- Collapsible verification code (unchanged logic reference) ------------
    const codeText = FAIR_CODE[sel] || FAIR_PREAMBLE;
    const pre = el("pre", null, codeText);
    const copyBtn = el("button", { class: "copy-btn" }, "Copy");
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(codeText); copyBtn.textContent = "Copied"; }
      catch (e) { copyBtn.textContent = "Copy failed"; }
      setTimeout(() => (copyBtn.textContent = "Copy"), 1400);
    });
    const codeBlock = el("div", { class: "code-block" }, [copyBtn, pre]);
    const logicHead = el("button", { class: "logic-head" }, [
      el("span", null, [BT.ui.icon("shield", 15), el("span", null, "Current Logic")]),
      el("span", { class: "chev" }, "▾"),
    ]);
    const logicBody = el("div", { class: "logic-body" }, [codeBlock]);
    logicHead.addEventListener("click", () => {
      const open = logicBody.classList.toggle("open");
      logicHead.classList.toggle("open", open);
    });

    overlay.appendChild(el("div", { class: "overlay-card fair-card" }, [
      el("div", { class: "fair-top" }, [
        el("div", { class: "fair-title" }, [BT.ui.icon("shield", 20), el("h2", null, "Provably Fair")]),
        el("button", { class: "fair-x", onclick: close }, "✕"),
      ]),
      el("p", { class: "fair-sub" },
        (g ? g.title : "This game") + " — one seed pair is reused across bets. Verify outcomes with the seeds below."),
      seedsBox,
      rotateBox,
      el("div", { class: "spacer" }),
      logicHead,
      logicBody,
    ]));
    document.body.appendChild(overlay);

    // Load the live seed state, then populate both sections.
    seedsBox.appendChild(el("p", { class: "fair-note" }, "Loading seeds…"));
    await BT.fair.load(true);
    renderSeeds();
    renderRotate();
  }

  // Open the Play screen focused on a specific game (used by the home grid so a
  // tile opens that exact game rather than whatever was last selected).
  function openGame(key) {
    if (BT.games.registry[key]) selected = key;
    BT.showScreen("play");
  }
  BT.openGame = openGame;
  BT.openFair = openFair;

  BT.screens = BT.screens || {};
  BT.screens.play = { render };
})();
