// VIP — tier progression surface. A player's tier is the HIGHEST catalogue tier
// for which at least TWO of the three lifetime requirements (messages / invites
// / wagered) are met (see migrations/2026-07-10_vip_tiers.sql). Higher tiers
// lift the per-message chat-points ceiling and pay richer rakeback / weekly /
// monthly rewards. This page shows the current tier badge, 2-of-3 progress to
// the next tier, the three claim cards, current-tier perks, and the full ladder.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const fmt = BT.ui.fmt;

  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const MONTH_MS = 30 * 24 * 3600 * 1000;

  let _tick = null; // live countdown interval, cleared on re-render/leave

  async function render(root) {
    if (_tick) { clearInterval(_tick); _tick = null; }
    BT.ui.clear(root);
    root.appendChild(BT.ui.loading("Loading VIP…"));

    const data = await BT.api.vip();
    BT.ui.clear(root);

    if (data && data._unconfigured) {
      renderInner(root, DEMO);
      root.appendChild(BT.ui.notice("The rewards server isn't connected yet. You're viewing a preview."));
      return;
    }
    if (!data || data.ok === false || data.error || !Array.isArray(data.tiers)) {
      root.appendChild(BT.ui.notice("Couldn't load VIP."));
      root.appendChild(el("div", { class: "spacer" }));
      root.appendChild(el("button", { class: "btn block", onclick: () => render(root) }, "Retry"));
      return;
    }
    renderInner(root, data);
  }

  function renderInner(root, data) {
    const tiers = data.tiers.slice().sort((a, b) => a.level - b.level);
    const st = data.state || {};
    const level = st.current_level || 0;
    const cur = tiers.find((t) => t.level === level) || tiers[0];
    const next = tiers.find((t) => t.level === level + 1) || null;

    root.appendChild(hero(cur, level, tiers.length - 1));
    root.appendChild(progressCard(st, next));
    root.appendChild(claimsCard(root, st, cur));
    root.appendChild(perksCard(cur));
    root.appendChild(ladderCard(tiers, level));
  }

  // ── Hero: badge + tier name ────────────────────────────────────────────
  function hero(cur, level, maxLevel) {
    const badge = level >= 1
      ? el("img", { class: "vip-badge-img", src: "assets/vip/tier" + level + ".svg", alt: cur.name })
      : el("div", { class: "vip-badge-locked" }, BT.ui.icon ? BT.ui.icon("lock", 40) : "★");
    return el("div", { class: "vip-hero" }, [
      el("div", { class: "vip-badge" }, [badge]),
      el("div", { class: "vip-hero-name" }, level >= 1 ? cur.name : "Unranked"),
      el("div", { class: "vip-hero-sub" },
        level >= 1 ? ("Tier " + level + " of " + maxLevel) : "Meet any 2 of 3 goals to rank up"),
    ]);
  }

  // ── Progress to next tier (2-of-3) ─────────────────────────────────────
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
      { label: "Invites", have: st.total_invites || 0, need: next.req_invites },
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
        el("div", { class: "section-title", style: "margin:0" }, "Next: " + next.name),
        el("div", { class: "vip-met-pill" + (met >= 2 ? " ready" : "") }, met + " of 3 met"),
      ]),
      ...bars,
      el("div", { class: "vip-req-hint muted" }, "Meet any 2 of the 3 to unlock " + next.name + "."),
    ]);
  }

  // ── Claim cards: rakeback (anytime), weekly (7d), monthly (30d) ─────────
  function claimsCard(root, st, cur) {
    const rakeReady = (st.unclaimed_rakeback || 0) > 0;
    const wkProj = Math.floor((st.week_wagered || 0) * (cur.weekly_rate || 0));
    const moProj = Math.floor((st.month_wagered || 0) * (cur.monthly_rate || 0));
    const wkNext = nextAt(st.weekly_claimed_at, WEEK_MS);
    const moNext = nextAt(st.monthly_claimed_at, MONTH_MS);

    const cards = [
      claimRow(root, "rakeback", "Rakeback", "rakeback",
        st.unclaimed_rakeback || 0, rakeReady, 0, "Cashback on every wager"),
      claimRow(root, "weekly", "Weekly", "7d",
        wkProj, wkProj > 0, wkNext, "Bonus on this week's volume"),
      claimRow(root, "monthly", "Monthly", "30d",
        moProj, moProj > 0, moNext, "Bonus on this month's volume"),
    ];
    const wrap = el("div", { class: "card vip-claims" }, [
      el("div", { class: "section-title" }, "Claim rewards"),
      ...cards,
    ]);
    return wrap;
  }

  function claimRow(root, kind, title, icon, amount, hasAmount, nextTs, sub) {
    const now = Date.now();
    const ready = hasAmount && (!nextTs || nextTs <= now);
    const btn = el("button", {
      class: "btn sm primary vip-claim-btn",
      disabled: ready ? undefined : "disabled",
      onclick: () => doClaim(root, kind, btn),
    }, ready ? "Claim" : (nextTs && nextTs > now ? "Locked" : "Nothing yet"));

    const amountEl = el("div", { class: "vip-claim-amount" }, [
      el("img", { class: "vip-claim-icon", src: "assets/vip/claim-" + icon + ".png", alt: "" }),
      el("span", {}, fmt(amount) + " pts"),
    ]);
    const meta = el("div", { class: "vip-claim-meta" }, sub);
    if (nextTs && nextTs > now) {
      const cd = el("span", { class: "vip-cd", "data-next": String(nextTs) }, countdown(nextTs - now));
      meta.appendChild(el("span", {}, " · "));
      meta.appendChild(cd);
      ensureTick(root);
    }
    return el("div", { class: "vip-claim-row" }, [
      el("div", { class: "vip-claim-left" }, [
        el("div", { class: "vip-claim-title" }, title),
        amountEl,
        meta,
      ]),
      btn,
    ]);
  }

  async function doClaim(root, kind, btn) {
    btn.disabled = true;
    const res = await BT.api.vipClaim(kind);
    if (res && res.ok) {
      BT.ui.toast("Claimed " + fmt(res.claimed || 0) + " pts!", "success");
      try { BT.ui.haptic("success"); } catch (e) {}
      if (typeof res.new_balance === "number") BT.setBalance(res.new_balance);
      else BT.refreshMe().catch(() => {});
      render(root);
    } else {
      const err = (res && res.error) || "server_error";
      const msg = err === "nothing_to_claim" ? "Nothing to claim yet."
        : err === "not_ready" ? "Not ready yet — check the countdown."
        : "Couldn't claim right now.";
      BT.ui.toast(msg, "error");
      btn.disabled = false;
    }
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
      el("div", { class: "section-title" }, (cur.level >= 1 ? cur.name : "Unranked") + " perks"),
      ...rows.map(([k, v]) => el("div", { class: "vip-perk-row" }, [
        el("span", { class: "vip-perk-k" }, k),
        el("span", { class: "vip-perk-v" }, v),
      ])),
    ]);
  }

  // ── Full ladder ────────────────────────────────────────────────────────
  function ladderCard(tiers, level) {
    const rows = tiers.filter((t) => t.level >= 1).map((t) => {
      const cur = t.level === level;
      return el("div", { class: "vip-ladder-row" + (cur ? " current" : "") }, [
        el("img", { class: "vip-ladder-badge", src: "assets/vip/tier" + t.level + ".svg", alt: "" }),
        el("div", { class: "vip-ladder-mid" }, [
          el("div", { class: "vip-ladder-name" }, t.name + (cur ? " · you" : "")),
          el("div", { class: "vip-ladder-req muted" },
            fmt(t.req_msgs) + " msgs · " + fmt(t.req_invites) + " invites · " + fmt(t.req_wagered) + " wagered"),
        ]),
        el("div", { class: "vip-ladder-bonus" }, "+" + fmt(t.levelup_bonus)),
      ]);
    });
    return el("div", { class: "card vip-ladder" }, [
      el("div", { class: "section-title" }, "Tiers & rewards"),
      el("div", { class: "vip-ladder-note muted" }, "Reach any 2 of the 3 goals to unlock a tier and collect its one-time bonus."),
      ...rows,
    ]);
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  function nextAt(claimedIso, intervalMs) {
    if (!claimedIso) return 0; // never claimed → available now
    const t = Date.parse(claimedIso);
    return isNaN(t) ? 0 : t + intervalMs;
  }
  function pct(rate) { return (Math.round((rate || 0) * 10000) / 100) + "%"; }
  function countdown(ms) {
    if (ms <= 0) return "ready";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + "d " + h + "h";
    if (h > 0) return h + "h " + m + "m";
    return m + "m " + (s % 60) + "s";
  }
  function ensureTick(root) {
    if (_tick) return;
    _tick = setInterval(() => {
      const nodes = root.querySelectorAll(".vip-cd");
      if (!nodes.length) { clearInterval(_tick); _tick = null; return; }
      const now = Date.now();
      nodes.forEach((n) => {
        const next = Number(n.getAttribute("data-next")) || 0;
        n.textContent = countdown(next - now);
      });
    }, 1000);
  }

  // Inert demo state for the disconnected Replit preview.
  const DEMO = {
    ok: true,
    state: {
      total_msgs: 320, total_invites: 3, total_wagered: 5200, current_level: 1,
      unclaimed_rakeback: 42, week_wagered: 5200, month_wagered: 5200,
      weekly_claimed_at: null, monthly_claimed_at: null,
    },
    tiers: [
      { level: 0, name: "Unranked", req_msgs: 0, req_invites: 0, req_wagered: 0, rakeback_rate: 0, weekly_rate: 0, monthly_rate: 0, levelup_bonus: 0, max_chat_pts: 3.0 },
      { level: 1, name: "Bronze", req_msgs: 250, req_invites: 2, req_wagered: 3000, rakeback_rate: 0.0016, weekly_rate: 0.0005, monthly_rate: 0.001, levelup_bonus: 130, max_chat_pts: 3.5 },
      { level: 2, name: "Silver", req_msgs: 800, req_invites: 5, req_wagered: 12000, rakeback_rate: 0.0027, weekly_rate: 0.0008, monthly_rate: 0.0016, levelup_bonus: 590, max_chat_pts: 4.0 },
      { level: 3, name: "Gold", req_msgs: 2200, req_invites: 12, req_wagered: 40000, rakeback_rate: 0.0038, weekly_rate: 0.0011, monthly_rate: 0.0022, levelup_bonus: 2300, max_chat_pts: 4.5 },
      { level: 4, name: "Platinum", req_msgs: 5500, req_invites: 28, req_wagered: 130000, rakeback_rate: 0.0049, weekly_rate: 0.0013, monthly_rate: 0.0027, levelup_bonus: 5900, max_chat_pts: 5.0 },
      { level: 5, name: "Diamond", req_msgs: 13000, req_invites: 60, req_wagered: 400000, rakeback_rate: 0.005, weekly_rate: 0.0016, monthly_rate: 0.0033, levelup_bonus: 24000, max_chat_pts: 6.0 },
    ],
  };

  BT.screens = BT.screens || {};
  BT.screens.vip = { render };
})();
