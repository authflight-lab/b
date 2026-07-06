// Shared helpers for game controllers. Games render server outcomes ONLY —
// no odds, RNG, or payout math lives here.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const fmt = BT.ui.fmt;

  BT.games = BT.games || {};
  BT.games.registry = BT.games.registry || {};

  function register(game) {
    BT.games.registry[game.key] = game;
  }

  // Bet range per contract §3: [1, min(350, balance)].
  function maxBet(balance) {
    const b = Number(balance) || 0;
    return Math.max(1, Math.min(350, b));
  }

  function clientSeed() {
    const a = new Uint8Array(16);
    (window.crypto || {}).getRandomValues
      ? window.crypto.getRandomValues(a)
      : a.forEach((_, i) => (a[i] = Math.floor(Math.random() * 256)));
    return Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  // Standard bet control row shared by all games. Returns { node, getBet }.
  // The 1/2 / 2x / Max buttons edit the value directly in the bet field:
  //   1/2 halves it (floored), 2x doubles it, Max jumps to the cap; both
  //   2x and Max clamp to min(350, balance).
  function betControl(defaultBet) {
    const bal = (BT.state && BT.state.balance) || 0;
    const mx = maxBet(bal);
    const input = el("input", {
      type: "number",
      class: "betbox-input",
      min: "1",
      max: String(mx),
      step: "1",
      value: String(Math.min(defaultBet || 10, mx)),
    });

    // Current value in the field, coerced to a valid integer (>= 1).
    function cur() {
      let v = parseInt(input.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      return v;
    }
    function setVal(v) {
      const cap = maxBet((BT.state && BT.state.balance) || 0);
      if (isNaN(v) || v < 1) v = 1;
      if (v > cap) v = cap;
      input.value = String(v);
    }

    function actionBtn(label, onclick) {
      return el("button", { class: "betbox-btn", type: "button", onclick }, label);
    }
    const box = el("div", { class: "betbox" }, [
      el("span", { class: "betbox-cur" }, "$"),
      input,
      actionBtn("1/2", () => setVal(Math.floor(cur() / 2))),
      actionBtn("2x", () => setVal(cur() * 2)),
      actionBtn("Max", () => setVal(maxBet((BT.state && BT.state.balance) || 0))),
    ]);

    const node = el("div", { class: "field" }, [
      el("label", null, "Bet (max " + fmt(mx) + ")"),
      box,
    ]);
    function getBet() {
      setVal(cur());
      return parseInt(input.value, 10);
    }
    return { node, getBet, input };
  }

  // Fairness display: shows server_hash pre-round, reveals server_seed after.
  function seedBox() {
    const hashEl = el("div", { class: "mono" }, "—");
    const seedEl = el("div", { class: "mono" }, "hidden until settle");
    const nonceEl = el("div", { class: "mono" }, "—");
    const node = el("div", { class: "seedbox" }, [
      el("div", { class: "row between" }, [el("span", { class: "k" }, "server_hash"), null]),
      hashEl,
      el("div", { class: "spacer" }),
      el("div", { class: "row between" }, [el("span", { class: "k" }, "nonce"), null]),
      nonceEl,
      el("div", { class: "spacer" }),
      el("div", { class: "row between" }, [el("span", { class: "k" }, "server_seed"), null]),
      seedEl,
    ]);
    return {
      node,
      setHash: (h) => (hashEl.textContent = h || "—"),
      setNonce: (n) => (nonceEl.textContent = n === undefined || n === null ? "—" : String(n)),
      revealSeed: (s) => (seedEl.textContent = s || "(not revealed)"),
      reset: () => {
        hashEl.textContent = "—";
        nonceEl.textContent = "—";
        seedEl.textContent = "hidden until settle";
      },
    };
  }

  function resultBanner() {
    const node = el("div", { class: "result neutral hidden" });
    return {
      node,
      show: (kind, text) => {
        node.className = "result " + (kind || "neutral");
        node.textContent = text;
        node.classList.remove("hidden");
      },
      hide: () => node.classList.add("hidden"),
    };
  }

  // After any settle/cashout, refresh balance from the response (fallback to /me).
  function syncBalance(resp) {
    if (resp && typeof resp.new_balance === "number") {
      BT.setBalance(resp.new_balance);
    } else if (resp && resp.balance !== undefined && typeof resp.balance === "number") {
      BT.setBalance(resp.balance);
    } else {
      BT.refreshMe && BT.refreshMe();
    }
  }

  // Common failure-to-message mapping.
  function errText(resp) {
    const code = (resp && resp.error) || "unknown_error";
    const map = {
      api_not_configured: "The game server isn't set up yet.",
      network_error: "Network error — please try again.",
      insufficient_balance: "Not enough points for that bet.",
      bad_init_data: "Open this from Telegram to play.",
      round_open: "You already have a round in progress.",
      no_open_round: "That round has ended.",
      rate_limited: "Slow down a moment, then try again.",
    };
    return map[code] || ("Error: " + code);
  }

  BT.games.common = {
    register,
    maxBet,
    clientSeed,
    betControl,
    seedBox,
    resultBanner,
    syncBalance,
    errText,
  };
})();
