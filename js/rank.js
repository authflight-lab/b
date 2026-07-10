// Shared VIP-rank helpers: names, per-rank colours, badge <img>, and a cached
// summary fetch so the Home rank card and the Play-header rank pill can both
// show the player's current tier without each screen re-implementing it.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;

  // Level → display name (server tiers override this when available).
  const NAMES = { 0: "Unranked", 1: "Bronze", 2: "Silver", 3: "Gold", 4: "Platinum", 5: "Diamond" };
  // Level → signature colour, taken from the badge SVGs in files.zip so the UI
  // colour always matches the badge art.
  const COLORS = { 1: "#C88A4B", 2: "#C4CED8", 3: "#F0C04E", 4: "#6FD8D4", 5: "#A6C8FF" };

  function color(level) { return COLORS[level] || "var(--text-dim)"; }

  // The rank badge as an <img> pointing at the SVG art. Unranked → null (no badge).
  function badgeImg(level, size) {
    if (!level || level < 1) return null;
    const s = size || 24;
    return el("img", {
      class: "rank-badge-img",
      src: "assets/vip/tier" + level + ".svg",
      width: String(s), height: String(s),
      alt: (NAMES[level] || "") + " rank",
    });
  }

  // Cached VIP summary. Level rarely changes within a session, so one fetch is
  // shared by every surface; pass force=true to refresh.
  let _cache = null;
  async function summary(force) {
    if (_cache && !force) return _cache;
    const data = await BT.api.vip();
    if (data && data.ok !== false && !data.error && Array.isArray(data.tiers)) {
      const st = data.state || {};
      const lvl = st.current_level || 0;
      const tier = data.tiers.find((t) => t.level === lvl) || {};
      _cache = { level: lvl, state: st, tiers: data.tiers, name: tier.name || NAMES[lvl] || "Unranked" };
      return _cache;
    }
    // Unconfigured / error → a safe Unranked shape (not cached, so it retries).
    return { level: 0, state: {}, tiers: [], name: "Unranked", _unavailable: true };
  }

  // Fill a host node with [badge?] + name and set --rank-color for styling.
  function fillPill(node, s) {
    BT.ui.clear(node);
    const lvl = (s && s.level) || 0;
    const badge = badgeImg(lvl, 18);
    if (badge) node.appendChild(badge);
    node.appendChild(el("span", { class: "rank-pill-name" }, (s && s.name) || NAMES[lvl] || "Unranked"));
    node.style.setProperty("--rank-color", color(lvl));
    node.classList.toggle("ranked", lvl >= 1);
  }

  // ── Rewards popup ────────────────────────────────────────────────────────
  // Tapping the Play-header rank pill opens this quick rewards sheet first (a
  // glance at claimable rakeback/weekly/monthly) with an "All Rewards" button
  // that then opens the full VIP page. Claim maths mirror screens/vip.js.
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const MONTH_MS = 30 * 24 * 3600 * 1000;
  function nextAt(claimedIso, intervalMs) {
    if (!claimedIso) return 0;
    const t = Date.parse(claimedIso);
    return isNaN(t) ? 0 : t + intervalMs;
  }
  function countdownLabel(ms) {
    if (ms <= 0) return "ready";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + "d " + h + "h";
    if (h > 0) return h + "h " + m + "m";
    return m + "m";
  }

  async function openPanel(anchorEl) {
    // Singleton: don't stack a second sheet if one is already open.
    if (document.querySelector(".rewards-popover")) return;

    // Transparent full-screen catcher for outside-click dismissal — no dim, so
    // the page stays visible; the panel is a small popover anchored to its trigger.
    const catcher = el("div", { class: "popover-catcher" });
    const reposition = () => {
      if (!anchorEl || !anchorEl.getBoundingClientRect) return;
      const r = anchorEl.getBoundingClientRect();
      card.style.top = Math.round(r.bottom + 8) + "px";
      card.style.right = Math.round(Math.max(8, window.innerWidth - r.right)) + "px";
    };
    const onScroll = () => close();
    const close = () => {
      catcher.remove();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", onScroll, true);
    };
    catcher.addEventListener("click", (e) => { if (e.target === catcher) close(); });

    const card = el("div", { class: "overlay-card rewards-panel rewards-popover" });
    const list = el("div", { class: "rewards-list" }, el("div", { class: "loading" }, "Loading rewards…"));
    const allBtn = el("button", { class: "btn block all-rewards-btn", type: "button" }, [
      BT.ui.icon("trophy", 18), el("span", null, "All Rewards"),
    ]);
    allBtn.addEventListener("click", () => { close(); BT.showScreen("vip"); });

    const head = el("div", { class: "rewards-head" });
    card.appendChild(head);
    card.appendChild(list);
    card.appendChild(allBtn);
    catcher.appendChild(card);
    document.body.appendChild(catcher);
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", onScroll, true);

    async function refresh() {
      const s = await summary(true);
      const lvl = (s && s.level) || 0;
      const cur = (s.tiers || []).find((t) => t.level === lvl) || {};
      const st = s.state || {};

      BT.ui.clear(head);
      const badge = badgeImg(lvl, 30);
      head.appendChild(el("div", { class: "rewards-head-left" }, [
        el("div", { class: "rewards-head-badge", style: "--rank-color:" + color(lvl) }, [badge || BT.ui.icon("shield", 20)]),
        el("div", {}, [
          el("div", { class: "rewards-head-name" }, lvl >= 1 ? (s.name || NAMES[lvl]) : "Unranked"),
          el("div", { class: "rewards-head-sub muted" }, "Your rewards"),
        ]),
      ]));
      head.appendChild(el("button", { class: "fair-x", type: "button", onclick: close }, "✕"));

      const now = Date.now();
      const rows = [
        { kind: "rakeback", title: "Rakeback", icon: "rakeback", amount: st.unclaimed_rakeback || 0, nextTs: 0, sub: "Cashback on every wager" },
        { kind: "weekly", title: "Weekly", icon: "7d", amount: Math.floor((st.week_wagered || 0) * (cur.weekly_rate || 0)), nextTs: nextAt(st.weekly_claimed_at, WEEK_MS), sub: "This week's volume" },
        { kind: "monthly", title: "Monthly", icon: "30d", amount: Math.floor((st.month_wagered || 0) * (cur.monthly_rate || 0)), nextTs: nextAt(st.monthly_claimed_at, MONTH_MS), sub: "This month's volume" },
      ];

      BT.ui.clear(list);
      if (s._unavailable) {
        list.appendChild(BT.ui.notice("Rewards aren't connected yet. Open All Rewards to preview."));
      } else {
        rows.forEach((r) => list.appendChild(rewardRow(r, now, refresh)));
      }
    }

    function rewardRow(r, now, onClaimed) {
      const ready = r.amount > 0 && (!r.nextTs || r.nextTs <= now);
      const locked = r.nextTs && r.nextTs > now;
      const btn = el("button", {
        class: "btn sm primary rewards-claim-btn",
        disabled: ready ? undefined : "disabled",
      }, ready ? "Claim" : (locked ? countdownLabel(r.nextTs - now) : "—"));
      if (ready) {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          const res = await BT.api.vipClaim(r.kind);
          if (res && res.ok) {
            BT.ui.toast("Claimed " + BT.ui.fmt(res.claimed || 0) + " pts!", "success");
            try { BT.ui.haptic("success"); } catch (e) {}
            if (typeof res.new_balance === "number") BT.setBalance(res.new_balance);
            else BT.refreshMe().catch(() => {});
            onClaimed();
          } else {
            BT.ui.toast("Couldn't claim right now.", "error");
            btn.disabled = false;
          }
        });
      }
      return el("div", { class: "rewards-row" }, [
        el("img", { class: "rewards-row-icon", src: "assets/vip/claim-" + r.icon + ".png", alt: "" }),
        el("div", { class: "rewards-row-mid" }, [
          el("div", { class: "rewards-row-title" }, r.title),
          el("div", { class: "rewards-row-sub muted" }, BT.ui.fmt(r.amount) + " pts · " + r.sub),
        ]),
        btn,
      ]);
    }

    refresh();
  }

  BT.rank = { NAMES, COLORS, color, badgeImg, summary, fillPill, openPanel };
})();
