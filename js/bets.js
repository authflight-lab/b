// Recent-bets panel — opened from the round paper pill next to the nav.
// Fetches the caller's last 50 resolved rounds once per open and paginates
// them client-side, 10 per page. Lightweight: no animations, one overlay.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;

  const PAGE_SIZE = 10;

  const GAME_NAMES = {
    dice: "Dice", flip: "Flip", mines: "Mines", towers: "Towers",
    highlow: "HighLow", plinko: "Plinko", rps: "RPS",
    chicken: "Chicken", crash: "Crash", blackjack: "Blackjack",
  };

  // "Jul 7, 12:15 AM" — compact, matches the reference layout.
  function fmtWhen(s) {
    if (!s) return "—";
    const d = new Date(s);
    if (isNaN(d.getTime())) return "—";
    const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return date + ", " + time;
  }

  function fmtMult(bet, payout) {
    if (!bet || bet <= 0) return "\u2014";
    const m = payout / bet;
    return (m >= 100 ? m.toFixed(0) : m.toFixed(2)) + "x";
  }

  function statusLabel(s) {
    if (s === "cashed_out") return "Cashed out";
    if (s === "settled") return "Settled";
    if (s === "voided") return "Voided";
    if (s === "abandoned") return "Abandoned";
    return s || "—";
  }

  function close() {
    const ov = document.getElementById("bets-overlay");
    if (ov) ov.remove();
  }

  function render(card, rows, page) {
    BT.ui.clear(card);

    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (page < 0) page = 0;
    if (page > pages - 1) page = pages - 1;

    const closeBtn = el("button", { class: "bets-close", "aria-label": "Close" }, "\u00d7");
    closeBtn.addEventListener("click", close);
    card.appendChild(el("div", { class: "bets-head" }, [
      el("div", { class: "bets-title" }, [BT.ui.icon("paper", 18), el("span", null, "Recent Bets")]),
      closeBtn,
    ]));

    if (!rows.length) {
      card.appendChild(el("div", { class: "notice" }, "No bets yet — play a game and it'll show up here."));
      return;
    }

    const table = el("div", { class: "bets-table" });
    table.appendChild(el("div", { class: "bets-row bets-header" }, [
      el("span", null, "Game"),
      el("span", null, "Date"),
      el("span", { class: "num" }, "Bet"),
      el("span", { class: "num" }, "Mult"),
      el("span", { class: "num" }, "Payout"),
    ]));

    rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).forEach((r) => {
      const bet = Number(r.bet) || 0;
      const payout = Number(r.payout) || 0;
      const win = payout > 0;
      table.appendChild(el("div", { class: "bets-row", title: statusLabel(r.status) }, [
        el("span", { class: "bets-game" }, [
          BT.ui.icon(r.game, 14),
          el("span", { class: "bets-game-name" }, GAME_NAMES[r.game] || r.game || "—"),
        ]),
        el("span", { class: "bets-date" }, fmtWhen(r.settled_at || r.created_at)),
        el("span", { class: "num bets-bet" }, BT.ui.fmt(bet)),
        el("span", { class: "num bets-mult" }, fmtMult(bet, payout)),
        el("span", { class: "num bets-payout" + (win ? " win" : "") }, BT.ui.fmt(payout)),
      ]));
    });
    card.appendChild(table);

    if (pages > 1) {
      const prev = el("button", { class: "btn bets-pg-btn" }, "Prev");
      const next = el("button", { class: "btn bets-pg-btn" }, "Next");
      prev.disabled = page === 0;
      next.disabled = page === pages - 1;
      prev.addEventListener("click", () => render(card, rows, page - 1));
      next.addEventListener("click", () => render(card, rows, page + 1));
      card.appendChild(el("div", { class: "bets-pager" }, [
        prev,
        el("span", { class: "bets-pg-label" }, (page + 1) + " / " + pages),
        next,
      ]));
    }
  }

  async function open() {
    if (document.getElementById("bets-overlay")) return;
    const card = el("div", { class: "overlay-card bets-card" }, BT.ui.loading("Loading bets…"));
    const ov = el("div", { class: "overlay", id: "bets-overlay" }, card);
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);

    const res = await BT.api.bets();
    if (!document.getElementById("bets-overlay")) return; // closed while loading
    if (!res || res.ok === false || res.error || !Array.isArray(res.rows)) {
      BT.ui.clear(card);
      const closeBtn = el("button", { class: "bets-close", "aria-label": "Close" }, "\u00d7");
      closeBtn.addEventListener("click", close);
      card.appendChild(el("div", { class: "bets-head" }, [
        el("div", { class: "bets-title" }, [BT.ui.icon("paper", 18), el("span", null, "Recent Bets")]),
        closeBtn,
      ]));
      card.appendChild(el("div", { class: "notice" }, "Couldn't load your bets. Try again in a moment."));
      return;
    }
    render(card, res.rows.slice(0, 50), 0);
  }

  BT.bets = { open, close };
})();
