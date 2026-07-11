// VIP — tier progression surface, shown as an overlay (like the wager-history
// panel). A player's tier is the HIGHEST catalogue tier for which BOTH lifetime
// requirements (messages AND wagered) are met (see the VIP migration). Higher
// tiers lift the per-message chat-points ceiling and pay richer rakeback /
// weekly / monthly rewards. The panel shows the current tier badge, progress to
// the next tier, the claim rewards, current-tier perks, and the full ladder.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const fmt = BT.ui.fmt;

  // ── Overlay lifecycle ──────────────────────────────────────────────────
  function close() {
    const ov = document.getElementById("vip-overlay");
    if (ov) ov.remove();
  }

  function open() {
    if (document.getElementById("vip-overlay")) return;
    const closeBtn = el("button", { class: "bets-close", "aria-label": "Close" }, "\u00d7");
    closeBtn.addEventListener("click", close);
    const head = el("div", { class: "vip-ov-head" }, [
      el("div", { class: "bets-title" }, [BT.ui.icon("trophy", 18), el("span", null, "VIP Rewards")]),
      closeBtn,
    ]);
    const body = el("div", { class: "vip-ov-body" }, BT.ui.loading("Loading VIP…"));
    const card = el("div", { class: "overlay-card vip-card" }, [head, body]);
    const ov = el("div", { class: "overlay", id: "vip-overlay" }, card);
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);

    async function refresh() {
      const data = await BT.api.vip();
      if (!document.getElementById("vip-overlay")) return; // closed while loading
      BT.ui.clear(body);

      if (data && data._unconfigured) {
        renderInner(body, DEMO);
        body.appendChild(BT.ui.notice("The rewards server isn't connected yet. You're viewing a preview."));
        return;
      }
      if (!data || data.ok === false || data.error || !Array.isArray(data.tiers)) {
        body.appendChild(BT.ui.notice("Couldn't load VIP."));
        body.appendChild(el("div", { class: "spacer" }));
        body.appendChild(el("button", { class: "btn block", onclick: refresh }, "Retry"));
        return;
      }
      renderInner(body, data);
    }
    refresh();
  }

  function renderInner(root, data) {
    const tiers = data.tiers.slice().sort((a, b) => a.level - b.level);
    const st = data.state || {};
    const level = st.current_level || 0;
    const cur = tiers.find((t) => t.level === level) || tiers[0];
    const next = tiers.find((t) => t.level === level + 1) || null;

    root.appendChild(hero(cur, level, tiers.length - 1));
    root.appendChild(progressCard(st, next));
    root.appendChild(perksCard(cur));
    root.appendChild(ladderCard(tiers, level));
  }

  // Colored rank name span (uppercased by section-title CSS where used).
  function rankName(name, lvl) {
    return el("span", { class: "vip-rankname", style: "color:" + BT.rank.color(lvl) }, name);
  }

  // ── Hero: badge + tier name ────────────────────────────────────────────
  function hero(cur, level, maxLevel) {
    const badge = el("img", {
      class: "vip-badge-img",
      src: "assets/vip/tier" + (level >= 1 ? level : 0) + ".svg",
      alt: level >= 1 ? cur.name : "Unranked",
    });
    return el("div", { class: "vip-hero" }, [
      el("div", { class: "vip-badge" }, [badge]),
      el("div", { class: "vip-hero-name" }, level >= 1 ? cur.name : "Unranked"),
      el("div", { class: "vip-hero-sub" },
        level >= 1 ? ("Tier " + level + " of " + maxLevel) : "Meet both goals to rank up"),
    ]);
  }

  // ── Progress to next tier (both goals) ─────────────────────────────────
  function progressCard(st, next) {
    if (!next) {
      return el("div", { class: "card vip-progress-card" }, [
        el("div", { class: "section-title" }, "Progress"),
        el("div", { class: "muted", style: "text-align:center;padding:8px 0" },
          "You've reached the top tier. 🎉"),
      ]);
    }
    const reqs = [
      { label: "Messages", have: st.total_msgs || 0, need: next.req_msgs },
      { label: "Wagered", have: st.total_wagered || 0, need: next.req_wagered },
    ];
    const met = reqs.filter((r) => r.have >= r.need).length;
    const bars = reqs.map((r) => {
      const pct = r.need > 0 ? Math.min(100, Math.round((r.have / r.need) * 100)) : 100;
      const done = r.have >= r.need;
      return el("div", { class: "vip-req" + (done ? " met" : "") }, [
        el("div", { class: "vip-req-top" }, [
          el("span", { class: "vip-req-label" }, r.label),
          el("span", { class: "vip-req-num" }, fmt(r.have) + " / " + fmt(r.need)),
        ]),
        el("div", { class: "vip-bar" }, [el("div", { class: "vip-bar-fill", style: "width:" + pct + "%" })]),
      ]);
    });
    return el("div", { class: "card vip-progress-card" }, [
      el("div", { class: "vip-progress-head" }, [
        el("div", { class: "section-title", style: "margin:0" }, ["Next: ", rankName(next.name, next.level)]),
        el("div", { class: "vip-met-pill" + (met >= 2 ? " ready" : "") }, met + " of 2 met"),
      ]),
      ...bars,
      el("div", { class: "vip-req-hint muted" }, ["Meet both goals to unlock ", rankName(next.name, next.level), "."]),
    ]);
  }

  // ── Current-tier perks ─────────────────────────────────────────────────
  function perksCard(cur) {
    const rows = [
      ["Rakeback", pct(cur.rakeback_rate)],
      ["Weekly bonus", pct(cur.weekly_rate)],
      ["Monthly bonus", pct(cur.monthly_rate)],
      ["Chat points / msg", "up to " + (cur.max_chat_pts || 3)],
    ];
    return el("div", { class: "card vip-perks" }, [
      el("div", { class: "section-title" }, [rankName(cur.level >= 1 ? cur.name : "Unranked", cur.level), " perks"]),
      ...rows.map(([k, v]) => el("div", { class: "vip-perk-row" }, [
        el("span", { class: "vip-perk-k" }, k),
        el("span", { class: "vip-perk-v" }, v),
      ])),
    ]);
  }

  // ── Full ladder ────────────────────────────────────────────────────────
  function ladderCard(tiers, level) {
    const rows = tiers.filter((t) => t.level >= 1).map((t) => {
      const isCur = t.level === level;
      return el("div", { class: "vip-ladder-row" + (isCur ? " current" : "") }, [
        el("img", { class: "vip-ladder-badge", src: "assets/vip/tier" + t.level + ".svg", alt: "" }),
        el("div", { class: "vip-ladder-mid" }, [
          el("div", { class: "vip-ladder-name" }, [rankName(t.name, t.level), isCur ? el("span", { class: "vip-you-tag" }, [" (", el("span", { class: "vip-you-green" }, "YOU"), ")"]) : ""]),
          el("div", { class: "vip-ladder-req muted" },
            fmt(t.req_msgs) + " msgs · " + fmt(t.req_wagered) + " wagered"),
        ]),
        el("div", { class: "vip-ladder-bonus" }, "+" + fmt(t.levelup_bonus)),
      ]);
    });
    return el("div", { class: "card vip-ladder" }, [
      el("div", { class: "section-title" }, "Tiers & rewards"),
      ...rows,
    ]);
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  function pct(rate) { return (Math.round((rate || 0) * 10000) / 100) + "%"; }

  // Inert demo state for the disconnected Replit preview.
  const DEMO = {
    ok: true,
    state: {
      total_msgs: 320, total_wagered: 5200, current_level: 1,
      unclaimed_rakeback: 42, week_wagered: 5200, month_wagered: 5200,
      weekly_claimed_at: null, monthly_claimed_at: null,
    },
    tiers: [
      { level: 0, name: "Unranked", req_msgs: 0, req_wagered: 0, rakeback_rate: 0, weekly_rate: 0, monthly_rate: 0, levelup_bonus: 0, max_chat_pts: 3.0 },
      { level: 1, name: "Bronze", req_msgs: 250, req_wagered: 3000, rakeback_rate: 0.0016, weekly_rate: 0.0005, monthly_rate: 0.001, levelup_bonus: 130, max_chat_pts: 3.5 },
      { level: 2, name: "Silver", req_msgs: 800, req_wagered: 12000, rakeback_rate: 0.0027, weekly_rate: 0.0008, monthly_rate: 0.0016, levelup_bonus: 590, max_chat_pts: 4.0 },
      { level: 3, name: "Gold", req_msgs: 2200, req_wagered: 40000, rakeback_rate: 0.0038, weekly_rate: 0.0011, monthly_rate: 0.0022, levelup_bonus: 1150, max_chat_pts: 4.5 },
      { level: 4, name: "Platinum", req_msgs: 5500, req_wagered: 130000, rakeback_rate: 0.0049, weekly_rate: 0.0013, monthly_rate: 0.0027, levelup_bonus: 2950, max_chat_pts: 5.0 },
      { level: 5, name: "Diamond", req_msgs: 13000, req_wagered: 400000, rakeback_rate: 0.005, weekly_rate: 0.0016, monthly_rate: 0.0033, levelup_bonus: 12000, max_chat_pts: 6.0 },
    ],
  };

  BT.vip = { open, close };
})();
