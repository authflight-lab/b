// Home — hero balance, streak, CTA buttons, quest rows, games grid, activity.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const fmt = BT.ui.fmt;

  const GAMES = [
    { key: "plinko",  label: "Plinko"  },
    { key: "mines",   label: "Mines"   },
    { key: "dice",    label: "Dice"    },
    { key: "towers",  label: "Towers"  },
    { key: "highlow", label: "HighLow" },
    { key: "flip",    label: "Flip"    },
    { key: "rps",     label: "RPS",     isNew: true },
    { key: "chicken", label: "Chicken", isNew: true },
    { key: "crash",   label: "Crash",   isNew: true },
    { key: "blackjack", label: "Blackjack", isNew: true },
    { key: "keno",    label: "Keno",    isNew: true },
  ];

  // Shimmering, clickable @handle used inside quest descriptions.
  function tgHandle(handle) {
    const a = el("a", {
      class: "bt-shimmer",
      href: "https://t.me/" + handle.replace(/^@/, ""),
      target: "_blank",
      rel: "noopener",
      style: "font-weight:700;text-decoration:none",
    }, handle);
    a.addEventListener("click", (e) => e.stopPropagation());
    return a;
  }

  const QUESTS = [
    { n: "01", label: "Chat",   desc: ["Earn points for every message sent in ", tgHandle("@partygc"), "."], screen: null },
    { n: "02", label: "Play",   desc: "Provably fair games, instant payouts.",       screen: "play" },
    { n: "03", label: "Redeem", desc: "Telegram Stars, Premium, or crypto.", screen: "shop" },
  ];

  // Gold "multiplier active" badge shown next to the name for @partygc reppers.
  function multiplierBadge() {
    return el("span", {
      style: "display:inline-flex;align-items:center;gap:4px;margin-left:8px;" +
        "padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;" +
        "white-space:nowrap;color:#3a2c00;background:linear-gradient(180deg,#ffe58a,#f5b301);" +
        "box-shadow:0 0 0 1px rgba(245,179,1,.5)",
    }, "★ Multiplier");
  }

  // ── Hero header ──────────────────────────────────────────────────────────────
  function heroSection(name, balance, streakDays, memberStatus, multiplierActive) {
    return el("div", { style: "padding:4px 0 18px" }, [
      // Top row: welcome + name (left) / streak + status (right)
      el("div", { class: "row between", style: "align-items:flex-start;margin-bottom:14px;gap:12px" }, [
        el("div", { style: "min-width:0" }, [
          el("div", { class: "small muted" }, "Welcome back"),
          el("div", { style: "font-weight:700;font-size:16px;display:flex;align-items:center;min-width:0" }, [
            el("span", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, name),
            multiplierActive ? multiplierBadge() : null,
          ]),
        ]),
        el("div", { style: "text-align:right;flex:0 0 auto" }, [
          el("div", { style: "font-weight:700;font-size:14px" }, fmt(streakDays) + " Day Streak"),
          el("div", { class: "small muted" }, memberStatus || "Member"),
          el("div", { class: "small", style: "color:var(--accent)" }, "t.me/partygc"),
        ]),
      ]),
      // Balance hero
      el("div", { style: "font-size:60px;font-weight:800;line-height:1;color:var(--text);font-variant-numeric:tabular-nums" },
        fmt(balance)),
      el("div", { class: "muted", style: "font-size:16px;font-weight:600;margin-top:4px" }, "Tokens"),
    ]);
  }

  // ── CTA buttons ──────────────────────────────────────────────────────────────
  function ctaRow(canClaim, onRewards, onClaim) {
    const rewardBtn = el("button", { class: "btn", style: "flex:1" }, "Rewards");
    rewardBtn.addEventListener("click", onRewards);

    const claimBtn = el("button", {
      class: "btn primary",
      style: "flex:1",
      disabled: !canClaim ? "disabled" : null,
    }, canClaim ? "Claim Daily Points" : "Claimed today ✓");
    claimBtn.addEventListener("click", () => {
      if (claimBtn.disabled) return;
      claimBtn.disabled = true;
      onClaim();
    });

    return el("div", { class: "row", style: "gap:10px;margin-bottom:20px" }, [rewardBtn, claimBtn]);
  }

  // ── Quest list ───────────────────────────────────────────────────────────────
  function questList() {
    const wrap = el("div", { style: "margin-bottom:16px" }, [
      el("div", { class: "section-title" }, "HOW IT WORKS"),
    ]);
    const list = el("div", {
      style: "background:var(--bg-elev);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden",
    });
    QUESTS.forEach((q, i) => {
      const row = el("div", {
        style: "display:flex;align-items:center;gap:14px;padding:14px 16px;" +
          (i < QUESTS.length - 1 ? "border-bottom:1px solid var(--border);" : "") +
          (q.screen ? "cursor:pointer;" : ""),
      }, [
        el("div", { style: "font-weight:800;font-size:13px;color:var(--accent);min-width:24px" }, q.n),
        el("div", { style: "flex:1;min-width:0" }, [
          el("div", { style: "font-weight:700;font-size:15px" }, q.label),
          el("div", { class: "small muted", style: "margin-top:1px" }, q.desc),
        ]),
        q.screen ? el("div", { style: "color:var(--text-dim);font-size:18px;flex:0 0 auto" }, "→") : null,
      ]);
      if (q.screen) row.addEventListener("click", () => BT.showScreen(q.screen));
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
  }

  // ── Activity stats card ──────────────────────────────────────────────────────
  (function _injectStatsStyles() {
    if (document.getElementById("bt-stats-styles")) return;
    const s = document.createElement("style");
    s.id = "bt-stats-styles";
    s.textContent = [
      "@keyframes bt-shimmer{0%{background-position:-200% center}100%{background-position:200% center}}",
      ".bt-shimmer{background:linear-gradient(90deg,var(--text) 20%,var(--accent) 50%,var(--text) 80%);",
      "background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;",
      "background-clip:text;animation:bt-shimmer 5s linear infinite;}",
    ].join("");
    document.head.appendChild(s);
  })();

  function rankCard() {
    const card = el("button", { class: "rankcard", type: "button", "aria-label": "View VIP rank" }, [
      el("div", { class: "rankcard-left" }, [
        el("div", { class: "rankcard-badge" }),
        el("div", { class: "rankcard-text" }, [
          el("div", { class: "rankcard-name" }, "Your rank"),
          el("div", { class: "rankcard-sub muted" }, "Loading…"),
        ]),
      ]),
      el("div", { class: "rankcard-arrow" }, BT.ui.icon("trophy", 20)),
    ]);
    card.addEventListener("click", () => BT.vip.open());
    return card;
  }

  function fillRankCard(card, s) {
    const lvl = (s && s.level) || 0;
    card.style.setProperty("--rank-color", BT.rank.color(lvl));
    card.classList.toggle("ranked", lvl >= 1);

    const badgeHost = card.querySelector(".rankcard-badge");
    const nameEl = card.querySelector(".rankcard-name");
    const subEl = card.querySelector(".rankcard-sub");
    BT.ui.clear(badgeHost);
    const badge = BT.rank.badgeImg(lvl, 36);
    badgeHost.appendChild(badge);
    nameEl.textContent = lvl >= 1 ? (s.name || BT.rank.NAMES[lvl]) : "Unranked";

    const tiers = (s.tiers || []).slice().sort((a, b) => a.level - b.level);
    const next = tiers.find((t) => t.level === lvl + 1);
    if (s._unavailable) {
      subEl.textContent = "Tap to view rewards";
    } else if (next) {
      const st = s.state || {};
      const reqs = [
        [st.total_msgs || 0, next.req_msgs],
        [st.total_wagered || 0, next.req_wagered],
      ];
      const met = reqs.filter(([have, need]) => !need || have >= need).length;
      BT.ui.clear(subEl);
      subEl.appendChild(document.createTextNode(met + " of 2 goals met · Next: "));
      subEl.appendChild(el("span", {
        style: "color:" + BT.rank.color(next.level) + ";font-weight:700",
      }, next.name || BT.rank.NAMES[next.level]));
    } else {
      subEl.textContent = lvl >= 1 ? "Top tier reached" : "Meet both goals to rank up";
    }
  }

  function statsCard(me) {
    const s = me.stats;
    const mult = me.multiplier_active;

    const items = [
      { label: "Messages",    value: fmt(s.messages_sent) },
      { label: "Wagered",     value: fmt(s.amount_wagered) + " pts" },
      { label: "Msg Rank",    value: "#" + fmt(s.messages_rank) },
      { label: "Points Rank", value: "#" + fmt(s.rich_rank) },
    ];

    // Inner 2×2 grid — its own nested card
    const innerGrid = el("div", {
      style: "display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);" +
        "border-radius:calc(var(--radius) - 2px);overflow:hidden",
    });
    items.forEach((item) => {
      const numEl = el("div", { style: "font-size:16px;font-weight:800;line-height:1" }, item.value);
      numEl.classList.add("bt-shimmer");
      innerGrid.appendChild(el("div", {
        style: "background:var(--bg);padding:10px 12px",
      }, [
        el("div", { style: "font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--accent);margin-bottom:4px" }, item.label),
        numEl,
      ]));
    });

    const multRow = el("div", {
      style: "display:flex;align-items:center;justify-content:space-between;margin-top:10px",
    }, [
      el("span", { style: "font-size:13px;font-weight:500;color:var(--text-dim)" }, "Multiplier"),
      el("span", {
        style: "font-size:12px;font-weight:700;padding:2px 10px;border-radius:999px;" +
          (mult
            ? "color:#3a2c00;background:linear-gradient(180deg,#ffe58a,#f5b301)"
            : "color:#f87171;background:rgba(239,68,68,.1);border:1px solid #b91c1c"),
      }, mult ? "Active" : "Not Active"),
    ]);

    // Outer card wraps the inner grid with padding so the grid floats inside
    return el("div", { style: "margin-bottom:20px" }, [
      el("div", {
        style: "background:var(--bg-elev);border:1px solid var(--border);border-radius:var(--radius);padding:12px",
      }, [innerGrid, multRow]),
    ]);
  }

  // ── Backlog card ─────────────────────────────────────────────────────────────
  function backlogCard(pts, onRedeem) {
    const btn = el("button", {
      class: "btn primary",
      style: "white-space:nowrap;padding:0 16px;height:36px;font-size:13px;flex:0 0 auto",
    }, "Redeem");
    btn.addEventListener("click", () => {
      btn.disabled = true;
      onRedeem();
    });
    return el("div", {
      style: "display:flex;align-items:center;justify-content:space-between;gap:12px;" +
        "background:var(--bg-elev);border:1px solid var(--accent);border-radius:var(--radius);" +
        "padding:10px 14px;margin-bottom:20px",
    }, [
      el("div", { style: "flex:1;min-width:0" }, [
        el("div", {
          style: "font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
        }, "You have " + fmt(pts) + " unclaimed points"),
      ]),
      btn,
    ]);
  }

  // ── Games grid ───────────────────────────────────────────────────────────────
  function gamesGrid() {
    const wrap = el("div", { style: "margin-bottom:16px" }, [
      el("div", { class: "section-title" }, "Explore Games"),
    ]);
    const grid = el("div", {
      style: "background:var(--bg-elev);border:1px solid var(--border);border-radius:var(--radius);padding:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px",
    });
    GAMES.forEach((g) => {
      const tile = el("div", { class: "game-tile", style: "cursor:pointer" }, [
        el("div", { class: "g-ico" }, BT.ui.icon(g.key, 26)),
        el("div", { class: "g-name" }, g.label),
        g.isNew ? el("span", { class: "g-new" }, "NEW") : null,
      ]);
      tile.addEventListener("click", () => BT.openGame(g.key));
      grid.appendChild(tile);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  // ── Main render ──────────────────────────────────────────────────────────────
  async function render(root) {
    BT.ui.clear(root);
    root.appendChild(el("div", { class: "loading" }, "Loading…"));

    const me = await BT.api.me();
    BT.ui.clear(root);

    if (me && me._unconfigured) { renderPreview(root); return; }
    if (!me || me.ok === false || me.error) {
      root.appendChild(BT.ui.notice(errMsg(me)));
      root.appendChild(el("div", { class: "spacer" }));
      root.appendChild(el("button", { class: "btn block", onclick: () => render(root) }, "Retry"));
      return;
    }

    BT.applyMe(me);
    renderLive(root, me);
  }

  function renderLive(root, me) {
    const name = me.display_name || me.username || "Guest";
    const quest = me.quest || {};
    const canClaim = !(me.last_claim_at && isSameUtcDay(me.last_claim_at)) && !quest.claimed;

    root.appendChild(heroSection(name, me.balance, me.streak_days, me.member_status, me.multiplier_active));

    root.appendChild(ctaRow(
      canClaim,
      () => BT.showScreen("shop"),
      async () => {
        const r = await BT.api.claim();
        if (r && r.ok) {
          BT.setBalance(r.new_balance);
          BT.ui.toast("+" + fmt(r.awarded) + " pts • streak " + fmt(r.streak_days), "success");
          BT.ui.haptic("success");
          render(root);
        } else {
          BT.ui.toast(r && r.error === "already_claimed" ? "Already claimed today." : errMsg(r),
            r && r.error === "already_claimed" ? "" : "error");
          render(root);
        }
      }
    ));

    // Clickable rank + progression card sits directly above the stats card and
    // opens the VIP page. Rendered as a placeholder, then filled once the VIP
    // summary loads, with a shimmer outline in the rank's signature colour.
    const rc = rankCard();
    root.appendChild(rc);
    BT.rank.summary().then((s) => { if (rc.isConnected) fillRankCard(rc, s); });

    if ((me.backlog_pts || 0) === 0 && me.stats) {
      root.appendChild(statsCard(me));
    }

    if ((me.backlog_pts || 0) > 0) {
      root.appendChild(backlogCard(me.backlog_pts, async () => {
        const r = await BT.api.backlogClaim();
        if (r && r.ok) {
          BT.setBalance(r.new_balance);
          BT.ui.toast("+" + fmt(r.awarded) + " pts claimed!", "success");
          BT.ui.haptic("success");
          render(root);
        } else {
          BT.ui.toast("Could not claim backlog. Try again.", "error");
          render(root);
        }
      }));
    }

    root.appendChild(questList());
    root.appendChild(gamesGrid());
  }

  // ── Preview (no API) ─────────────────────────────────────────────────────────
  function renderPreview(root) {
    root.appendChild(heroSection("Guest", 0, "—", "Member"));

    const rewardBtn = el("button", { class: "btn", style: "flex:1;opacity:.5", disabled: "disabled" }, "Rewards");
    const claimBtn  = el("button", { class: "btn primary", style: "flex:1;opacity:.5", disabled: "disabled" }, "Claim Daily Points");
    root.appendChild(el("div", { class: "row", style: "gap:10px;margin-bottom:20px" }, [rewardBtn, claimBtn]));

    root.appendChild(questList());
    root.appendChild(gamesGrid());
    root.appendChild(BT.ui.notice("The rewards server isn't connected yet. You're viewing a preview."));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function isSameUtcDay(iso) {
    try {
      const d = new Date(iso), n = new Date();
      return d.getUTCFullYear() === n.getUTCFullYear() &&
             d.getUTCMonth()    === n.getUTCMonth()    &&
             d.getUTCDate()     === n.getUTCDate();
    } catch (e) { return false; }
  }

  function errMsg(r) {
    if (r && r._network) return "Couldn't reach the server. Check your connection.";
    if (r && r.error === "too_many_failed_auth") return "Too many failed sign-in attempts right now — please try again in a moment.";
    if (r && r.error === "bad_init_data") return "Open this app from Telegram to sign in.";
    return "Something went wrong loading your profile.";
  }

  BT.screens = BT.screens || {};
  BT.screens.home = { render };
})();
