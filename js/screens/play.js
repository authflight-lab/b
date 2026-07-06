// Play — game selector for all 6 games. Age gate + disclaimers render first.
// The client renders server outcomes only; no odds/RNG/payout math here.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;

  const ORDER = ["dice", "flip", "mines", "towers", "highlow", "plinko"];
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
      "// Dice — one draw. Win if roll < target (target in 2..98).\n" +
      "const roll = rng(0) * 100;\n" +
      "const win = roll < target;\n" +
      "const multiplier = win ? (0.99 * 100 / target) : 0;   // 1% edge\n",
    flip:
      FAIR_PREAMBLE +
      "\n" +
      "// Flip — one draw per flip; win if u < 0.5. cursor = flip index (0-based).\n" +
      "const win = rng(cursor) < 0.5;\n" +
      "const multiplier = 1.98 ** streak;   // after `streak` straight wins\n",
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

    // Header row: game grid title area with the Provably Fair pill on the right.
    const fairBtn = el("button", { class: "fair-btn", onclick: openFair }, [
      BT.ui.icon("shield", 16),
      el("span", null, "Provably Fair"),
    ]);
    root.appendChild(el("div", { class: "play-head" }, [
      el("span", { class: "play-head-title" }, "Games"),
      fairBtn,
    ]));

    const grid = el("div", { class: "game-grid" });
    ORDER.forEach((key) => {
      const g = BT.games.registry[key];
      if (!g) return;
      grid.appendChild(el("div", {
        class: "game-tile" + (selected === key ? " active" : ""),
        onclick: () => { selected = key; renderGames(root); },
      }, [el("div", { class: "g-ico" }, BT.ui.icon(key, 26)), el("div", { class: "g-name" }, g.title)]));
    });
    root.appendChild(grid);

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

    // VERBATIM legal footer (spec §9). Do not paraphrase.
    root.appendChild(el("div", { class: "legal-footer" }, BT.LEGAL_POINTS));
  }

  // Provably Fair panel: server_hash / nonce / server_seed for the current
  // round of the selected game + the code that reproduces its outcome.
  function openFair() {
    const g = BT.games.registry[selected];
    const state = (BT.games.activeFair && BT.games.activeFair.getState())
      || { hash: "—", nonce: "—", seed: "hidden until settle" };

    const overlay = el("div", { class: "overlay" });
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    const seedRow = (label, value) => el("div", { class: "fair-seed" }, [
      el("span", { class: "k" }, label),
      el("div", { class: "mono" }, value),
    ]);

    // Collapsible code section with a Copy button (matches reference layout).
    const codeText = FAIR_CODE[selected] || FAIR_PREAMBLE;
    const pre = el("pre", null, codeText);
    const copyBtn = el("button", { class: "copy-btn" }, "Copy");
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(codeText);
        copyBtn.textContent = "Copied";
      } catch (e) {
        copyBtn.textContent = "Copy failed";
      }
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
    logicBody.classList.add("open");
    logicHead.classList.add("open");

    overlay.appendChild(el("div", { class: "overlay-card fair-card" }, [
      el("div", { class: "fair-top" }, [
        el("div", { class: "fair-title" }, [BT.ui.icon("shield", 20), el("h2", null, "Provably Fair")]),
        el("button", { class: "fair-x", onclick: close }, "✕"),
      ]),
      el("p", { class: "fair-sub" },
        (g ? g.title : "This game") + " — verify the outcome yourself from the seeds below."),
      seedRow("server_hash", state.hash),
      seedRow("nonce", state.nonce),
      seedRow("server_seed", state.seed),
      el("div", { class: "spacer" }),
      logicHead,
      logicBody,
    ]));

    document.body.appendChild(overlay);
  }

  // Open the Play screen focused on a specific game (used by the home grid so a
  // tile opens that exact game rather than whatever was last selected).
  function openGame(key) {
    if (BT.games.registry[key]) selected = key;
    BT.showScreen("play");
  }
  BT.openGame = openGame;

  BT.screens = BT.screens || {};
  BT.screens.play = { render };
})();
