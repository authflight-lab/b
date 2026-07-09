// Invites — referral surface. One permanent invite link per user (created once,
// server-side, via createChatInviteLink on @partygc), a milestone reward ladder,
// and the user's referral stats (referred count + total earned). The awarding
// itself (join / start / message milestones) is wired separately in the bot;
// this page only generates the link and displays the numbers.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const fmt = BT.ui.fmt;

  // Milestone reward ladder (mirrors the bot-side awarding, max 65 per referral).
  const LADDER = [
    { label: "Joins via your link", pts: 10 },
    { label: "Starts the bot", pts: 5 },
    { label: "Sends 20 messages in the group", pts: 10 },
    { label: "Sends 100 messages", pts: 40 },
  ];
  const MAX_PER_REFERRAL = 65;

  async function render(root) {
    BT.ui.clear(root);
    root.appendChild(BT.ui.loading("Loading invites…"));

    const data = await BT.api.invite();
    BT.ui.clear(root);

    // No backend (Replit preview with no config) — still show the full surface
    // with an inert state so the page is never blank.
    if (data && data._unconfigured) {
      renderInner(root, { link: null, referred_count: 0, total_earned: 0, member_limit: 50 });
      root.appendChild(BT.ui.notice("The rewards server isn't connected yet. You're viewing a preview."));
      return;
    }
    if (!data || data.ok === false || data.error) {
      root.appendChild(BT.ui.notice("Couldn't load invites."));
      root.appendChild(el("div", { class: "spacer" }));
      root.appendChild(el("button", { class: "btn block", onclick: () => render(root) }, "Retry"));
      return;
    }

    renderInner(root, data);
  }

  function renderInner(root, data) {
    root.appendChild(headerCard());
    root.appendChild(ladderCard());
    root.appendChild(linkCard(root, data));
    root.appendChild(statsCard(data));
  }

  // ── Header / description ────────────────────────────────────────────────
  function headerCard() {
    return el("div", { class: "invite-hero" }, [
      el("div", { class: "invite-hero-ico" }, BT.ui.icon("invite", 26)),
      el("div", { style: "min-width:0" }, [
        el("div", { class: "invite-hero-title" }, "Invite friends, earn points"),
        el("div", { class: "invite-hero-sub" },
          "Invite people to @partygc with your personal link and earn points as they join and stay active."),
      ]),
    ]);
  }

  // ── Reward ladder ───────────────────────────────────────────────────────
  function ladderCard() {
    const wrap = el("div", { class: "invite-card" }, [
      el("div", { class: "invite-card-head" }, [
        el("span", null, "Reward ladder"),
        el("span", { class: "invite-max" }, "max +" + MAX_PER_REFERRAL + " / referral"),
      ]),
    ]);
    const list = el("div", { class: "invite-ladder" });
    LADDER.forEach((step) => {
      list.appendChild(el("div", { class: "invite-ladder-row" }, [
        el("div", { class: "invite-ladder-label" }, step.label),
        el("div", { class: "invite-ladder-pts" }, "+" + step.pts),
      ]));
    });
    wrap.appendChild(list);
    return wrap;
  }

  // ── Generate link + copyable field ──────────────────────────────────────
  function linkCard(root, data) {
    const wrap = el("div", { class: "invite-card" });
    const hasLink = !!(data && data.link);

    const btn = el("button", {
      class: "btn primary block",
      disabled: hasLink ? "disabled" : null,
    }, hasLink ? "Your link is ready ✓" : "Generate my link");

    // The copyable field — hidden until a link exists.
    const field = linkField(data && data.link);
    if (!hasLink) field.classList.add("hidden");

    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "Generating…";
      const r = await BT.api.generateInvite();
      if (r && r.ok && r.link) {
        btn.textContent = "Your link is ready ✓";
        setFieldLink(field, r.link);
        field.classList.remove("hidden");
        // The generate response mirrors GET (stats included) — refresh the tiles.
        if (typeof r.referred_count === "number") setStat(root, "referred", fmt(r.referred_count));
        if (typeof r.total_earned === "number") setStat(root, "earned", fmt(r.total_earned) + " pts");
        BT.ui.haptic("success");
      } else {
        btn.disabled = false;
        btn.textContent = "Generate my link";
        BT.ui.toast(generateErr(r), "error");
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(field);
    wrap.appendChild(el("div", { class: "invite-hint" },
      "This link is permanent — one per person. Tap it to copy."));
    return wrap;
  }

  function linkField(link) {
    const field = el("div", {
      class: "invite-link-field",
      role: "button",
      tabindex: "0",
    }, [
      el("span", { class: "invite-link-text" }, link || ""),
      el("span", { class: "invite-copy-ico" }, BT.ui.icon("copy", 18)),
    ]);
    const doCopy = () => copyToClipboard(field);
    field.addEventListener("click", doCopy);
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doCopy(); }
    });
    return field;
  }

  function setFieldLink(field, link) {
    const t = field.querySelector(".invite-link-text");
    if (t) t.textContent = link;
  }

  async function copyToClipboard(field) {
    const t = field.querySelector(".invite-link-text");
    const text = t ? t.textContent : "";
    if (!text) return;

    const ok = await writeClipboard(text);
    if (ok) {
      field.classList.add("copied");
      const ico = field.querySelector(".invite-copy-ico");
      if (ico) { BT.ui.clear(ico); ico.appendChild(BT.ui.icon("check", 18)); }
      BT.ui.toast("Copied", "success");
      BT.ui.haptic("light");
      setTimeout(() => {
        field.classList.remove("copied");
        const ic = field.querySelector(".invite-copy-ico");
        if (ic) { BT.ui.clear(ic); ic.appendChild(BT.ui.icon("copy", 18)); }
      }, 1600);
    } else {
      BT.ui.toast("Couldn't copy — long-press to copy manually.", "error");
    }
  }

  // navigator.clipboard first; fall back to a hidden textarea + execCommand,
  // then to Telegram's WebApp (which has no write API but we keep the hook).
  async function writeClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) return true;
    } catch (e) {}
    // Telegram WebApp fallback (openLink keeps the link reachable if copy fails).
    try {
      const tg = window.Telegram && window.Telegram.WebApp;
      if (tg && typeof tg.showAlert === "function") {
        // No write-clipboard API in Telegram WebApp; surface the link so the
        // user can copy it by hand as a last resort.
        return false;
      }
    } catch (e) {}
    return false;
  }

  // ── Stats ───────────────────────────────────────────────────────────────
  function statsCard(data) {
    const referred = Number(data && data.referred_count) || 0;
    const earned = Number(data && data.total_earned) || 0;

    const grid = el("div", { class: "invite-stats" }, [
      statTile("Referred", fmt(referred), "people who joined via your link", "referred"),
      statTile("Total earned", fmt(earned) + " pts", "referral points paid to you", "earned"),
    ]);
    return el("div", { class: "invite-card" }, [
      el("div", { class: "invite-card-head" }, [el("span", null, "Your referrals")]),
      grid,
    ]);
  }

  function statTile(label, value, sub, key) {
    return el("div", { class: "invite-stat" }, [
      el("div", { class: "invite-stat-label" }, label),
      el("div", { class: "invite-stat-value", "data-stat": key }, value),
      el("div", { class: "invite-stat-sub" }, sub),
    ]);
  }

  function setStat(root, key, text) {
    const n = root.querySelector('[data-stat="' + key + '"]');
    if (n) n.textContent = text;
  }

  function generateErr(r) {
    const m = {
      network_error: "Network error — try again.",
      api_not_configured: "The rewards server isn't connected yet.",
      link_failed: "Couldn't create your link right now. Try again shortly.",
    };
    return (r && m[r.error]) || "Couldn't generate your link. Try again.";
  }

  BT.screens = BT.screens || {};
  BT.screens.invites = { render };
})();
