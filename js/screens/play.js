// Play — game selector for all 6 games. Age gate + disclaimers render first.
// The client renders server outcomes only; no odds/RNG/payout math here.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;

  const ORDER = ["dice", "flip", "mines", "towers", "highlow", "plinko"];
  let selected = "dice";

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

    const grid = el("div", { class: "game-grid" });
    ORDER.forEach((key) => {
      const g = BT.games.registry[key];
      if (!g) return;
      grid.appendChild(el("div", {
        class: "game-tile" + (selected === key ? " active" : ""),
        onclick: () => { selected = key; renderGames(root); },
      }, [el("div", { class: "g-ico" }, g.icon || "▶"), el("div", { class: "g-name" }, g.title)]));
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
    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "legal-footer" }, BT.LEGAL_POINTS),
    ]));
  }

  BT.screens = BT.screens || {};
  BT.screens.play = { render };
})();
