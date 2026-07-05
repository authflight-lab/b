// Home — balance, streak, daily claim, quest state, recent activity.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const fmt = BT.ui.fmt;

  async function render(root) {
    BT.ui.clear(root);
    root.appendChild(el("div", { class: "loading" }, "Loading your profile…"));

    const me = await BT.api.me();
    BT.ui.clear(root);

    if (me && me._unconfigured) {
      root.appendChild(previewCard());
      return;
    }
    if (!me || me.ok === false || me.error) {
      root.appendChild(BT.ui.notice(errMsg(me)));
      root.appendChild(el("div", { class: "spacer" }));
      root.appendChild(el("button", { class: "btn block", onclick: () => render(root) }, "Retry"));
      return;
    }

    BT.applyMe(me);

    const name = me.display_name || me.username || "Bartender guest";
    const quest = me.quest || {};
    const canClaim = !(me.last_claim_at && isSameUtcDay(me.last_claim_at)) && !quest.claimed;

    const claimBtn = el("button", { class: "btn primary block", disabled: !canClaim ? "disabled" : null },
      canClaim ? "Claim daily points" : "Claimed today ✓");
    claimBtn.addEventListener("click", async () => {
      claimBtn.disabled = true;
      const r = await BT.api.claim();
      if (r && r.ok) {
        BT.setBalance(r.new_balance);
        BT.ui.toast("+" + fmt(r.awarded) + " pts • streak " + fmt(r.streak_days), "success");
        BT.ui.haptic("success");
        render(root);
      } else {
        BT.ui.toast(r && r.error === "already_claimed" ? "Already claimed today." : errMsg(r), r && r.error === "already_claimed" ? "" : "error");
        render(root);
      }
    });

    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "row between" }, [
        el("div", null, [el("div", { class: "small muted" }, "Signed in as"), el("div", { style: "font-weight:700;font-size:17px" }, name)]),
        el("div", { class: "badge" }, (me.member_status || "member")),
      ]),
      el("div", { class: "spacer" }),
      el("div", { class: "stat-grid" }, [
        stat("Balance", fmt(me.balance) + " pts"),
        stat("Streak", fmt(me.streak_days) + " days"),
      ]),
    ]));

    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "section-title" }, "Daily quest"),
      questRow("✎ Chatted in the group today", quest.chatted),
      questRow("✚ Claimed daily points", quest.claimed),
      el("div", { class: "spacer" }),
      claimBtn,
      el("div", { class: "small muted center", style: "margin-top:8px" },
        me.can_redeem ? "You've met today's activity floor — redeeming is unlocked." : "Chat + claim today to unlock redeeming in the Shop."),
    ]));

    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "section-title" }, "Recent activity"),
      el("div", { id: "home-history", class: "list" }, BT.ui.loading("Loading…")),
    ]));

    const hist = await BT.api.history();
    const box = document.getElementById("home-history");
    if (box) {
      BT.ui.clear(box);
      const rows = (hist && hist.rows) || [];
      if (!rows.length) box.appendChild(BT.ui.notice("No activity yet. Chat, claim, and play to get started."));
      rows.slice(0, 12).forEach((r) => {
        const pos = (r.amount || 0) >= 0;
        box.appendChild(el("div", { class: "list-item row between" }, [
          el("div", null, [
            el("div", { style: "font-weight:600" }, kindLabel(r.kind)),
            el("div", { class: "small muted" }, BT.ui.fmtDate(r.created_at)),
          ]),
          el("div", { class: "rank-val", style: pos ? "" : "color:var(--bad)" }, (pos ? "+" : "") + fmt(r.amount)),
        ]));
      });
    }
  }

  function stat(k, v) { return el("div", { class: "stat" }, [el("div", { class: "k" }, k), el("div", { class: "v" }, v)]); }
  function questRow(label, done) {
    return el("div", { class: "row between", style: "padding:6px 0" }, [
      el("span", null, label),
      el("span", { class: "badge " + (done ? "good" : "") }, done ? "Done" : "Pending"),
    ]);
  }
  function kindLabel(k) {
    const m = { chat: "Chat reward", daily: "Daily claim", game_bet: "Game bet", game_win: "Game win", redeem: "Redemption", redeem_refund: "Redeem refund", admin: "Admin grant", migrate: "Migrated", depo_out: "Sent points", depo_in: "Received points", setbal_correction: "Balance correction" };
    return m[k] || k || "Activity";
  }
  function isSameUtcDay(iso) {
    try {
      const d = new Date(iso), n = new Date();
      return d.getUTCFullYear() === n.getUTCFullYear() && d.getUTCMonth() === n.getUTCMonth() && d.getUTCDate() === n.getUTCDate();
    } catch (e) { return false; }
  }
  function errMsg(r) {
    if (r && r._network) return "Couldn't reach the server. Check your connection and retry.";
    if (r && r.error === "bad_init_data") return "Open this app from inside Telegram to sign in.";
    return "Something went wrong loading your profile.";
  }
  function previewCard() {
    return el("div", { class: "card" }, [
      el("h3", null, "✦ Welcome to Bartender"),
      el("p", { class: "muted" }, "The rewards server isn't connected yet. You're viewing a preview — earn points by chatting in the group, claim daily, play games, and redeem prizes in the Shop."),
      el("div", { class: "stat-grid" }, [stat("Balance", "— pts"), stat("Streak", "— days")]),
    ]);
  }

  BT.screens = BT.screens || {};
  BT.screens.home = { render };
})();
