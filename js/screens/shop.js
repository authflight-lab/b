// Shop — live prize catalogue + redeem. Redeem gated server-side by the
// activity floor & monthly limit; the client just calls /redeem.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const fmt = BT.ui.fmt;

  async function render(root) {
    BT.ui.clear(root);
    root.appendChild(el("div", { class: "loading" }, "Loading the shop…"));

    const [data, me] = await Promise.all([BT.api.rewards(), BT.api.me()]);
    BT.ui.clear(root);

    if (data && data._unconfigured) {
      root.appendChild(BT.ui.notice("The shop isn't connected yet. Prizes will appear here once the rewards server is live."));
      return;
    }
    if (!data || data.ok === false || data.error) {
      root.appendChild(BT.ui.notice("Couldn't load the shop."));
      root.appendChild(el("div", { class: "spacer" }));
      root.appendChild(el("button", { class: "btn block", onclick: () => render(root) }, "Retry"));
      return;
    }

    if (me && me.ok !== false && !me.error) BT.applyMe(me);
    const balance = (me && typeof me.balance === "number") ? me.balance : (BT.state.balance || 0);
    const canRedeem = me && me.can_redeem;

    root.appendChild(el("div", { style: "margin-bottom:16px" }, [
      el("div", { style: "font-size:18px;color:var(--text-dim);font-weight:600;margin-bottom:4px" }, "Your balance"),
      el("div", { style: "font-weight:800;font-size:30px;color:var(--accent)" }, fmt(balance) + " pts"),
    ]));

    if (!canRedeem) {
      root.appendChild(BT.ui.notice("Redeeming unlocks after you chat in the group AND claim your daily points today (UTC). Check the Home tab."));
    }

    const rewards = (data.rewards || []).slice();
    if (!rewards.length) {
      root.appendChild(BT.ui.notice("No prizes are available right now. Check back soon."));
      return;
    }

    const list = el("div", { class: "list" });
    rewards.forEach((rw) => list.appendChild(rewardCard(rw, balance, canRedeem, root)));
    root.appendChild(el("div", { class: "section-title" }, "Prizes"));
    root.appendChild(list);
  }

  function rewardCard(rw, balance, canRedeem, root) {
    const unlimited = !rw.monthly_limit || rw.monthly_limit === 0;
    const remaining = rw.remaining;
    const soldOut = !unlimited && remaining !== null && remaining !== undefined && remaining <= 0;
    const affordable = balance >= rw.cost;
    const disabled = !rw.active || soldOut || !affordable || !canRedeem;

    const btn = el("button", { class: "btn primary sm", disabled: disabled ? "disabled" : null },
      soldOut ? "Sold out" : (!affordable ? "Not enough pts" : "Redeem"));
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const r = await BT.api.redeem(rw.id);
      if (r && r.ok) {
        BT.setBalance(r.new_balance);
        BT.ui.toast("Redeemed! An admin will fulfil your request.", "success");
        BT.ui.haptic("success");
        render(root);
      } else {
        BT.ui.toast(redeemErr(r), "error");
        btn.disabled = false;
      }
    });

    return el("div", { class: "list-item" }, [
      el("div", { class: "row between" }, [
        el("div", { class: "grow" }, [
          el("div", { style: "font-weight:700" }, rw.title),
          rw.description ? el("div", { class: "small muted" }, rw.description) : null,
        ]),
        el("div", { class: "rank-val" }, fmt(rw.cost) + " pts"),
      ]),
      el("div", { class: "spacer" }),
      el("div", { class: "row between" }, [
        el("div", { class: "small muted" }, unlimited ? "Unlimited this month" : ("Left this month: " + (remaining === null || remaining === undefined ? "?" : fmt(remaining)))),
        btn,
      ]),
    ]);
  }

  function redeemErr(r) {
    const m = {
      insufficient_balance: "You don't have enough points.",
      monthly_limit_reached: "This prize is out of stock this month.",
      daily_limit_reached: "You've already claimed a reward today. Come back tomorrow.",
      activity_floor_not_met: "Chat + claim today to unlock redeeming.",
      reward_inactive: "That prize is no longer available.",
      network_error: "Network error — try again.",
      api_not_configured: "The shop isn't connected yet.",
    };
    return (r && m[r.error]) || "Couldn't redeem right now.";
  }

  BT.screens = BT.screens || {};
  BT.screens.shop = { render };
})();
