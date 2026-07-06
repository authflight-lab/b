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
  ];

  const QUESTS = [
    { n: "01", label: "Chat",   desc: "Earn points for every message in the group.", screen: null },
    { n: "02", label: "Play",   desc: "Six games live, instant payouts.",            screen: "play" },
    { n: "03", label: "Redeem", desc: "Telegram Stars, Premium, or crypto.", screen: "shop" },
  ];

  // ── Hero header ──────────────────────────────────────────────────────────────
  function heroSection(name, balance, streakDays, memberStatus) {
    return el("div", { style: "padding:4px 0 18px" }, [
      // Top row: welcome + name (left) / streak + status (right)
      el("div", { class: "row between", style: "align-items:flex-start;margin-bottom:14px;gap:12px" }, [
        el("div", { style: "min-width:0" }, [
          el("div", { class: "small muted" }, "Welcome back"),
          el("div", { style: "font-weight:700;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, name),
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

    root.appendChild(heroSection(name, me.balance, me.streak_days, me.member_status));

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
    if (r && r.error === "bad_init_data") return "Open this app from Telegram to sign in.";
    return "Something went wrong loading your profile.";
  }

  BT.screens = BT.screens || {};
  BT.screens.home = { render };
})();
