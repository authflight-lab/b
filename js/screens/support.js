// Support — help, contact, and the full responsible-play disclaimer.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;

  // VERBATIM legal copy from spec §9 (Play footer). Do not paraphrase.
  const LEGAL_POINTS =
    "Points are not currency, cannot be bought or sold. They carry no value outside of this bots shop. This app contains simulated casino-style games. Real gambling has worse odds than what you see here. Winning here does not mean you'll win anywhere else.";
  BT.LEGAL_POINTS = LEGAL_POINTS;

  function render(root) {
    BT.ui.clear(root);

    root.appendChild(el("div", { class: "card" }, [
      el("h3", null, "❔ Support & Help"),
      el("p", { class: "muted" }, "Need a hand? Here's how everything works and how to reach us."),
    ]));

    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "section-title" }, "How to earn points"),
      el("ul", { class: "muted", style: "padding-left:18px;margin:0" }, [
        el("li", null, "Chat in the group — quality messages earn points (30s cooldown, daily cap)."),
        el("li", null, "Claim your daily points every day to grow your streak."),
        el("li", null, "Play the games responsibly — points can go up or down."),
      ]),
    ]));

    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "section-title" }, "Redeeming prizes"),
      el("ul", { class: "muted", style: "padding-left:18px;margin:0" }, [
        el("li", null, "Chat AND claim on the same day (UTC) to unlock redeeming."),
        el("li", null, "Each prize has a monthly limit. Requests are fulfilled by an admin."),
        el("li", null, "If a request is rejected, your points are automatically refunded."),
      ]),
    ]));

    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "section-title" }, "Provably fair"),
      el("p", { class: "muted small" }, "Every round shows a server_hash before you bet and reveals the server_seed after it settles. You can verify sha256(server_seed) matches the hash — the outcome was locked in before you played."),
    ]));

    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "section-title" }, "Contact"),
      el("p", { class: "muted small" }, "For help with a redemption, a missing balance, or a bug, message a group admin. Include your Telegram username and the approximate time of the issue."),
    ]));

    // Full responsible-play / legal disclaimer.
    root.appendChild(el("div", { class: "card" }, [
      el("div", { class: "section-title" }, "Disclaimer"),
      el("div", { class: "legal" }, [
        el("p", null, [el("strong", null, "18+ only. "), "This app is intended for adults. If you are under 18, do not use it."]),
        el("p", null, LEGAL_POINTS),
        el("p", null, "Bartender is a free-to-play rewards feature for our community. It is not gambling, not a lottery, and not a game of skill for money. No purchase is possible and no cash, cryptocurrency, or monetary prize can be won directly with points from within these games."),
        el("p", null, "The simulated games use provably-fair randomness with a built-in house edge, so on average balances trend downward the more you play. Please play for fun, in moderation, and never treat points as an investment."),
        el("p", null, "If gambling-style play is causing you distress, or you feel you can't stop, please step away and seek support from a local problem-gambling helpline or a trusted person. Nothing here should be used as a substitute for professional help."),
        el("p", { class: "small" }, "Prizes are provided at the sole discretion of the group operators and may change or be discontinued at any time. Abuse, botting, or exploiting bugs may result in balance resets or removal."),
      ]),
    ]));
  }

  BT.screens = BT.screens || {};
  BT.screens.support = { render };
})();
