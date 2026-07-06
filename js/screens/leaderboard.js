// Leaderboard — "Race" redesign. Golden prize-pool hero with a live reset
// countdown, category tabs (Rich / Chatters), a period toggle, and a ranked
// table with hexagon rank badges and a reward column for the paid places.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const fmt = BT.ui.fmt;

  let currentTab = "rich";
  let currentPeriod = "weekly";
  let countdownTimer = null;

  // Weekly bonuses paid to the top 3 each Monday (mirrors bot/bartender/weekly.py
  // CHATTERS_BONUS / RICH_BONUS). Keep in sync if those payouts change.
  const PRIZES = { rich: [75, 50, 25], chatters: [100, 60, 40] };

  const TAB_META = {
    rich: { icon: "rich", label: "Rich", col: "Balance" },
    chatters: { icon: "chat", label: "Chatters", col: "Messages" },
  };

  function poolTotal(tab) {
    return (PRIZES[tab] || []).reduce((a, b) => a + b, 0);
  }

  // Weekly race resets Monday 00:00 UTC (matches the weekly payout cadence).
  function msUntilWeeklyReset() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(0, 0, 0, 0);
    // Days until next Monday (getUTCDay: 0=Sun..1=Mon..6=Sat).
    let add = (1 - now.getUTCDay() + 7) % 7;
    if (add === 0) add = 7; // already Monday -> next Monday
    next.setUTCDate(next.getUTCDate() + add);
    return next.getTime() - now.getTime();
  }

  function render(root) {
    BT.ui.clear(root);
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

    root.appendChild(hero());
    root.appendChild(tabRow(root));
    root.appendChild(periodRow(root));

    const body = el("div", { id: "lb-body" }, BT.ui.loading("Loading rankings…"));
    root.appendChild(body);

    if (currentPeriod === "weekly") startCountdown();

    loadRows(root);
  }

  // ---- Hero prize-pool banner ----------------------------------------------
  function hero() {
    const pool = poolTotal(currentTab);
    const isWeekly = currentPeriod === "weekly";
    return el("div", { class: "race-hero" }, [
      el("div", { class: "race-hero-glow" }),
      el("div", { class: "race-hero-top" }, [
        el("div", { class: "race-pool" }, [
          el("span", { class: "race-pool-amt" }, fmt(pool)),
          el("span", { class: "race-pool-unit" }, "pts"),
        ]),
        el("div", { class: "race-title" }, [
          el("span", { class: "race-title-lead" }, isWeekly ? "WEEKLY" : "ALL-TIME"),
          el("span", { class: "race-title-main" }, "RACE"),
        ]),
      ]),
      el("div", { class: "race-hero-bottom" }, [
        el("span", { class: "race-reset-label" }, isWeekly ? "Resets in" : "Lifetime standings"),
        isWeekly ? el("div", { id: "race-clock", class: "race-clock" }) : el("span"),
      ]),
    ]);
  }

  function startCountdown() {
    const tick = () => {
      const box = document.getElementById("race-clock");
      if (!box) { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } return; }
      let ms = msUntilWeeklyReset();
      if (ms < 0) ms = 0;
      const totalMin = Math.floor(ms / 60000);
      const days = Math.floor(totalMin / 1440);
      const hours = Math.floor((totalMin % 1440) / 60);
      const mins = totalMin % 60;
      const parts = days > 0
        ? [[days, "D"], [hours, "H"], [mins, "M"]]
        : [[hours, "H"], [mins, "M"]];
      BT.ui.clear(box);
      parts.forEach(([n, u]) => {
        box.appendChild(el("span", { class: "clock-cell" }, [
          el("span", { class: "clock-n" }, String(n).padStart(2, "0")),
          el("span", { class: "clock-u" }, u),
        ]));
      });
    };
    tick();
    countdownTimer = setInterval(tick, 30000);
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
    return el("div", { class: "race-segtoggle" }, [
      mk("weekly", "Weekly"),
      mk("alltime", "All-Time"),
    ]);
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

    const rows = data.rows || [];
    const table = el("div", { class: "race-table" });
    table.appendChild(el("div", { class: "race-thead" }, [
      el("span", { class: "rc-rank" }, "#"),
      el("span", { class: "rc-player" }, "Player"),
      el("span", { class: "rc-value" }, TAB_META[currentTab].col),
      el("span", { class: "rc-reward" }, "Reward"),
    ]));

    if (!rows.length) {
      table.appendChild(BT.ui.notice("No one is on the board yet."));
    } else {
      const prizes = currentPeriod === "weekly" ? (PRIZES[currentTab] || []) : [];
      rows.forEach((r) => {
        const name = r.display_name || r.username || ("User " + r.tg_id);
        table.appendChild(raceRow(r.rank, name, r.value, prizes[r.rank - 1], false));
      });
    }
    box.appendChild(table);

    if (data.you) {
      box.appendChild(el("div", { class: "race-you-label" }, "Your position"));
      const youTable = el("div", { class: "race-table" });
      youTable.appendChild(raceRow(data.you.rank, "You", data.you.value, null, true));
      box.appendChild(youTable);
    }
  }

  function raceRow(rank, name, value, reward, you) {
    const tier = rank === 1 ? " r1" : rank === 2 ? " r2" : rank === 3 ? " r3" : "";
    return el("div", { class: "race-row" + (you ? " you" : "") }, [
      el("div", { class: "rc-rank" }, [
        el("span", { class: "hexbadge" + tier }, String(rank == null ? "?" : rank)),
      ]),
      el("div", { class: "rc-player" }, [
        BT.ui.icon("token", 16),
        el("span", { class: "rc-name" }, name),
      ]),
      el("div", { class: "rc-value" }, fmt(value)),
      el("div", { class: "rc-reward" }, reward ? "+" + fmt(reward) : "—"),
    ]);
  }

  BT.screens = BT.screens || {};
  BT.screens.leaderboard = { render };
})();
