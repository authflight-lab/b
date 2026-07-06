// Leaderboard — Rich List + Chatters tabs, with a highlighted YOU row.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const fmt = BT.ui.fmt;

  let currentTab = "rich";
  let currentPeriod = "weekly";

  // Weekly bonuses paid to the top 3 each Monday (mirrors bot/bartender/weekly.py
  // CHATTERS_BONUS / RICH_BONUS). Keep in sync if those payouts change.
  const PRIZES = { rich: [75, 50, 25], chatters: [100, 60, 40] };

  async function render(root) {
    BT.ui.clear(root);

    const tabs = el("div", { class: "pilltabs" }, [
      tab("rich", "rich", "Rich"),
      tab("chatters", "chat", "Chatters"),
    ]);
    const periodTabs = el("div", { class: "segtoggle" }, [
      periodTab("weekly", "Weekly"),
      periodTab("alltime", "All-Time"),
    ]);
    const body = el("div", { id: "lb-body" }, BT.ui.loading("Loading rankings…"));
    root.appendChild(tabs);
    root.appendChild(periodTabs);
    root.appendChild(prizeCard());
    root.appendChild(body);

    function tab(key, ic, label) {
      return el("button", {
        class: "pilltab" + (currentTab === key ? " active" : ""),
        onclick: () => { if (currentTab !== key) { currentTab = key; render(root); } },
      }, [BT.ui.icon(ic, 20), el("span", null, label)]);
    }

    function periodTab(key, label) {
      return el("button", {
        class: "segtoggle-btn" + (currentPeriod === key ? " active" : ""),
        onclick: () => { if (currentPeriod !== key) { currentPeriod = key; render(root); } },
      }, [el("span", null, label)]);
    }

    const data = await BT.api.leaderboard(currentTab, currentPeriod);
    const box = document.getElementById("lb-body");
    if (!box) return;
    BT.ui.clear(box);

    if (data && data._unconfigured) {
      box.appendChild(BT.ui.notice("Leaderboards appear once the rewards server is live."));
      return;
    }
    if (!data || data.ok === false || data.error) {
      box.appendChild(BT.ui.notice("Couldn't load the leaderboard."));
      box.appendChild(el("div", { class: "spacer" }));
      box.appendChild(el("button", { class: "btn block", onclick: () => render(root) }, "Retry"));
      return;
    }

    const unit = "pts";
    const rows = (data.rows || []);
    if (!rows.length) {
      box.appendChild(BT.ui.notice("No one is on the board yet."));
    } else {
      const list = el("div", { class: "list" });
      rows.forEach((r) => list.appendChild(rankRow(r.rank, r.display_name || r.username || ("User " + r.tg_id), r.value, unit, false)));
      box.appendChild(list);
    }

    if (data.you) {
      box.appendChild(el("div", { class: "section-title", style: "margin-top:14px" }, "Your position"));
      box.appendChild(rankRow(data.you.rank, "You", data.you.value, unit, true));
    }
  }

  // Weekly prize breakdown for the current category — shows what the top 3 earn
  // at the end of each week so players know what they're competing for.
  function prizeCard() {
    const prizes = PRIZES[currentTab] || [];
    const cat = currentTab === "rich" ? "Rich List" : "Chatters";
    const unit = "pts";
    const rows = prizes.map((amt, i) =>
      el("div", { class: "prize-row" }, [
        el("span", { class: "prize-rank r" + (i + 1) }, "#" + (i + 1)),
        el("span", { class: "prize-amt" }, "+" + fmt(amt) + " " + unit),
      ])
    );
    return el("div", { class: "prizecard" }, [
      el("div", { class: "prizecard-head" }, [
        el("span", { class: "prizecard-title" }, "Weekly Prizes · " + cat),
        el("span", { class: "prizecard-sub" }, "Paid every Monday"),
      ]),
      el("div", { class: "prize-rows" }, rows),
    ]);
  }

  function rankRow(rank, name, value, unit, you) {
    const podium = rank === 1 ? " r1" : rank === 2 ? " r2" : rank === 3 ? " r3" : "";
    return el("div", { class: "rank-row" + (you ? " you" : "") }, [
      el("div", { class: "rank-n" + podium }, medal(rank)),
      el("div", { class: "rank-name" }, name),
      el("div", { class: "rank-val" }, fmt(value) + " " + unit),
    ]);
  }
  function medal(rank) {
    return "#" + (rank === undefined || rank === null ? "?" : rank);
  }

  BT.screens = BT.screens || {};
  BT.screens.leaderboard = { render };
})();
