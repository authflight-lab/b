// Bootstrap: Telegram init, shared state, navigation, and the age gate.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;

  // VERBATIM legal copy from spec §9 (Play footer). Do not paraphrase.
  BT.LEGAL_POINTS =
    "Points are not currency, cannot be bought or sold. They carry no value outside of this bots shop. This app contains simulated casino-style games. Real gambling has worse odds than what you see here. Winning here does not mean you'll win anywhere else.";

  BT.state = { me: null, balance: 0, ageAck: false };

  // ---- Active-game guard ----------------------------------------------------
  // Set when a multi-step round starts; cleared when it ends.
  // Blocks tab switching and game switching until the round is resolved.
  BT.activeGame = null;

  BT.setActiveGame = function (name, roundId) {
    BT.activeGame = { name, roundId };
  };

  BT.clearActiveGame = function () {
    BT.activeGame = null;
  };

  const tg = (window.Telegram && window.Telegram.WebApp) || null;

  function initTelegram() {
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      // Apply Telegram theme background if provided.
      if (tg.themeParams && tg.themeParams.bg_color) {
        document.documentElement.style.setProperty("--bg", tg.themeParams.bg_color);
      }
      if (typeof tg.setHeaderColor === "function") {
        try { tg.setHeaderColor("#161b26"); } catch (e) {}
      }
    } catch (e) {}
  }

  // ---- Shared state helpers -------------------------------------------------
  BT.setBalance = function (n) {
    if (typeof n === "number" && !isNaN(n)) BT.state.balance = n;
    const bv = document.getElementById("bal-value");
    if (bv) bv.textContent = BT.ui.fmt(BT.state.balance);
    const pbv = document.getElementById("play-bal-value");
    if (pbv) pbv.textContent = BT.ui.fmt(BT.state.balance);
  };

  BT.applyMe = function (me) {
    if (!me) return;
    BT.state.me = me;
    if (typeof me.balance === "number") BT.setBalance(me.balance);
    if (me.age_ack) { BT.state.ageAck = true; try { localStorage.setItem("bt_age_ack", "1"); } catch (e) {} }
  };

  BT.refreshMe = async function () {
    const me = await BT.api.me();
    if (me && me.ok !== false && !me.error && !me._unconfigured) BT.applyMe(me);
    return me;
  };

  // ---- Age gate -------------------------------------------------------------
  function localAck() {
    try { return localStorage.getItem("bt_age_ack") === "1"; } catch (e) { return false; }
  }

  BT.requireAge = function (onOk, onCancel) {
    if (BT.state.ageAck || localAck()) { BT.state.ageAck = true; return onOk(); }
    showAgeGate(onOk, onCancel);
  };

  function showAgeGate(onOk, onCancel) {
    const gate = document.getElementById("age-gate");
    if (!gate) return onOk();
    BT.ui.clear(gate);
    gate.classList.remove("hidden");
    gate.setAttribute("aria-hidden", "false");

    const accept = el("button", { class: "btn primary block" }, "I am 18+ and I accept");
    const decline = el("button", { class: "btn block" }, "Leave");

    accept.addEventListener("click", async () => {
      accept.disabled = true;
      BT.state.ageAck = true;
      try { localStorage.setItem("bt_age_ack", "1"); } catch (e) {}
      // Best-effort server persistence (spec: POST /bt/api/age-ack).
      try { await BT.api.ageAck(); } catch (e) {}
      hideAgeGate();
      onOk();
    });
    decline.addEventListener("click", () => {
      hideAgeGate();
      if (onCancel) onCancel();
      else showScreen("home");
    });

    gate.appendChild(el("div", { class: "overlay-card" }, [
      el("h2", null, "18+ Before you play"),
      el("div", { class: "legal" }, [
        el("p", null, [el("strong", null, "You must be 18 or older to continue.")]),
        el("p", null, BT.LEGAL_POINTS),
        el("p", null, "These are simulated casino-style games with a built-in house edge. They are for entertainment only — points have no monetary value and cannot be exchanged for cash, crypto, or goods outside this bot's shop."),
        el("p", null, "By continuing you confirm you are at least 18 years old and that this simulation is legal where you live."),
      ]),
      el("div", { class: "spacer" }),
      accept,
      el("div", { class: "spacer" }),
      decline,
    ]));
  }

  function hideAgeGate() {
    const gate = document.getElementById("age-gate");
    if (gate) { gate.classList.add("hidden"); gate.setAttribute("aria-hidden", "true"); BT.ui.clear(gate); }
  }
  // Age gate starts hidden until Play requests it.
  hideAgeGate();

  // ---- Navigation -----------------------------------------------------------
  let current = null;

  function showScreen(key) {
    const root = document.getElementById("screen-root");
    if (!root) return;
    // Guard: block navigating away from an in-progress round.
    if (BT.activeGame && key !== "play") {
      BT.ui.toast("Cash out your current game first.", "error");
      try { BT.ui.haptic("error"); } catch (e) {}
      return;
    }
    current = key;
    document.querySelectorAll(".pillnav-link").forEach((t) => t.classList.toggle("active", t.dataset.screen === key));
    moveIndicator();
    const scr = BT.screens && BT.screens[key];
    if (scr && typeof scr.render === "function") {
      try { scr.render(root); }
      catch (e) { BT.ui.clear(root); root.appendChild(BT.ui.notice("Couldn't load this screen.")); }
    } else {
      BT.ui.clear(root);
      root.appendChild(BT.ui.notice("Screen not available."));
    }
    try { root.scrollTop = 0; window.scrollTo(0, 0); } catch (e) {}
  }
  BT.showScreen = showScreen;

  // ---- Pill nav (liquid-glass floating nav bar, always expanded) -----------
  function moveIndicator() {
    const indicator = document.getElementById("pillnav-indicator");
    const active = document.querySelector(".pillnav-link.active");
    if (!indicator || !active) return;
    indicator.style.width = active.offsetWidth + "px";
    indicator.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  function wireNav() {
    document.querySelectorAll(".pillnav-link").forEach((btn) => {
      btn.addEventListener("click", () => showScreen(btn.dataset.screen));
    });
    window.addEventListener("resize", moveIndicator);
  }

  // ---- Session-close auto-cashout -------------------------------------------
  // When the user leaves the WebApp mid-round (visibility:hidden / pagehide),
  // fire a best-effort cashout so the round isn't left permanently open.
  // Uses fetch keepalive so the request survives the page being destroyed.
  function _beaconCashout() {
    const ag = BT.activeGame;
    if (!ag || !ag.roundId) return;
    const apiBase = (window.BT_CONFIG && window.BT_CONFIG.BT_API_BASE) || "";
    if (!apiBase) return;
    let id = "";
    try { id = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) || ""; } catch (e) {}
    try {
      fetch(apiBase + "/bt/api/game/" + ag.name + "/cashout", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": id },
        body: JSON.stringify({ round_id: ag.roundId }),
      });
    } catch (e) {}
  }

  // ---- Boot -----------------------------------------------------------------
  function boot() {
    initTelegram();
    wireNav();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") _beaconCashout();
    });
    window.addEventListener("pagehide", _beaconCashout);
    BT.setBalance(0);
    showScreen("home");
    // Warm the top-bar balance in the background (best effort; home also fetches).
    BT.refreshMe().catch(() => {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
