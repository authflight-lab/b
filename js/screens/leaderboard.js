// Leaderboard — category tabs (Rich / Chatters), a period toggle (Weekly /
// All-Time), and a ranked table with hexagon rank badges and a reward column
// for the paid places.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const fmt = BT.ui.fmt;

  let currentTab = "rich";
  let currentPeriod = "weekly";

  // Weekly bonuses paid to the top 3 each Monday (mirrors bot/bartender/weekly.py
  // CHATTERS_BONUS / RICH_BONUS). Keep in sync if those payouts change.
  const PRIZES = { rich: [75, 50, 25], chatters: [100, 60, 40] };

  const TAB_META = {
    rich: { icon: "rich", label: "Rich", col: "Balance" },
    chatters: { icon: "chat", label: "Chatters", col: "Messages" },
  };

  function render(root) {
    BT.ui.clear(root);

    root.appendChild(tabRow(root));
    root.appendChild(periodRow(root));

    const body = el("div", { id: "lb-body" }, BT.ui.loading("Loading rankings…"));
    root.appendChild(body);

    loadRows(root);
  }

  // ---- Tabs -----------------------------------------------------------------
  function tabRow(root) {
    return el("div", { class: "race-tabs" }, Object.keys(TAB_META).map((key) => {
      const m = TAB_META[key];
      return el("button", {
        class: "race-tab" + (currentTab === key ? " active" : ""),
        onclick: () => { if (currentTab !== key) { currentTab = key; render(root); } },
      }, [BT.ui.icon(m.icon, 18), el("span", null, m.label)]);
    }));
  }

  function periodRow(root) {
    const mk = (key, label) => el("button", {
      class: "race-seg" + (currentPeriod === key ? " active" : ""),
      onclick: () => { if (currentPeriod !== key) { currentPeriod = key; render(root); } },
    }, label);
    return el("div", { class: "race-periodrow" }, [
      el("div", { class: "race-segtoggle" }, [
        mk("weekly", "Weekly"),
        mk("alltime", "All-Time"),
      ]),
      el("span", { id: "lb-resets", class: "race-resets" }),
    ]);
  }

  // Renders a static "Resets in Xd Xh Xm" from a server-provided timestamp.
  // Computed once (on load / tab switch), never polled or re-rendered on a
  // timer — the countdown is only as fresh as the last time the screen was
  // shown, by design.
  function renderResets(resetsAt) {
    const label = document.getElementById("lb-resets");
    if (!label) return;
    if (!resetsAt) { label.textContent = ""; return; }
    const ms = new Date(resetsAt).getTime() - Date.now();
    if (!isFinite(ms) || ms <= 0) { label.textContent = ""; return; }
    const totalMin = Math.floor(ms / 60000);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    const parts = [];
    if (d > 0) parts.push(d + "d");
    if (d > 0 || h > 0) parts.push(h + "h");
    parts.push(m + "min");
    label.textContent = "Resets in " + parts.join(" ");
  }

  // ---- Rows -----------------------------------------------------------------
  async function loadRows(root) {
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

    renderResets(data.resets_at);

    // Reward column only appears on the Weekly board (all-time pays nothing).
    const showReward = currentPeriod === "weekly";
    const rows = data.rows || [];
    const table = el("div", { class: "race-table" + (showReward ? "" : " no-reward") });
    const head = [
      el("span", { class: "rc-rank" }, "#"),
      el("span", { class: "rc-player" }, "Player"),
      el("span", { class: "rc-value" }, TAB_META[currentTab].col),
    ];
    if (showReward) head.push(el("span", { class: "rc-reward" }, "Reward"));
    table.appendChild(el("div", { class: "race-thead" }, head));

    if (!rows.length) {
      table.appendChild(BT.ui.notice("No one is on the board yet."));
    } else {
      const prizes = showReward ? (PRIZES[currentTab] || []) : [];
      rows.forEach((r) => {
        const name = r.display_name || r.username || ("User " + r.tg_id);
        table.appendChild(raceRow(r.rank, name, r.value, prizes[r.rank - 1], false, showReward));
      });
    }
    box.appendChild(table);

    if (data.you) {
      box.appendChild(el("div", { class: "race-you-label" }, "Your position"));
      const youTable = el("div", { class: "race-table" + (showReward ? "" : " no-reward") });
      youTable.appendChild(raceRow(data.you.rank, "You", data.you.value, null, true, showReward));
      box.appendChild(youTable);
    }
  }

  function raceRow(rank, name, value, reward, you, showReward) {
    const tier = rank === 1 ? " r1" : rank === 2 ? " r2" : rank === 3 ? " r3" : "";
    const cells = [
      el("div", { class: "rc-rank" }, [
        el("span", { class: "hexbadge" + tier }, String(rank == null ? "?" : rank)),
      ]),
      el("div", { class: "rc-player" }, [
        BT.ui.icon("token", 16),
        el("span", { class: "rc-name" }, name),
      ]),
      el("div", { class: "rc-value" }, fmt(value)),
    ];
    if (showReward) {
      cells.push(el("div", { class: "rc-reward" }, reward ? "+" + fmt(reward) : ""));
    }
    return el("div", { class: "race-row" + (you ? " you" : "") }, cells);
  }

  BT.screens = BT.screens || {};
  BT.screens.leaderboard = { render };
})();
