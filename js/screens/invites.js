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
  // @partygc / @partygcbot mentions are shimmered at render time (see mentionize).
  const LADDER = [
    { label: "Joins @partygc via your link", pts: 10 },
    { label: "Sends /start to @partygcbot", pts: 5 },
    { label: "Sends 20+ messages in @partygc", pts: 10 },
    { label: "Sends 100+ messages in @partygc", pts: 40 },
  ];

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
    root.appendChild(header());
    root.appendChild(ladderCard());
    root.appendChild(linkCard(root, data));
    root.appendChild(statsCard(data));
  }

  // ── Header / description (no card) ──────────────────────────────────────
  function header() {
    return el("div", { class: "invite-header" }, [
      el("h1", { class: "invite-title" }, "Invite friends, earn points"),
      el("div", { class: "invite-subtitle" },
        "Invite people to @partygc with your personal link and earn points as they join and stay active."),
    ]);
  }

  // Wrap @partygc / @partygcbot mentions in a shimmer span; returns a mixed
  // array of text + nodes suitable for el()'s children.
  function mentionize(text) {
    const parts = [];
    const re = /(@partygcbot|@partygc)/g;  // longer alt first so it wins
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      parts.push(el("span", { class: "shimmer" }, m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  }

  // ── Reward ladder ───────────────────────────────────────────────────────
  function ladderCard() {
    const wrap = el("div", { class: "invite-card" }, [
      el("div", { class: "invite-card-head" }, [el("span", null, "Reward ladder")]),
      el("div", { class: "invite-ladder-note" }, "For every member you refer:"),
    ]);
    const list = el("div", { class: "invite-ladder" });
    LADDER.forEach((step) => {
      list.appendChild(el("div", { class: "invite-ladder-row" }, [
        el("div", { class: "invite-ladder-label" }, mentionize(step.label)),
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
        pulseSuccess(btn);
        setFieldLink(field, r.link);
        revealField(field);
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
    return wrap;
  }

  // One-shot green flash + ring pulse the moment a button flips to its
  // "done" state — timed to land alongside whatever it unlocks.
  function pulseSuccess(btn) {
    btn.classList.remove("success-pulse");
    void btn.offsetWidth; // restart the animation if it's already mid-flight
    btn.classList.add("success-pulse");
    const cleanup = () => btn.classList.remove("success-pulse");
    btn.addEventListener("animationend", cleanup, { once: true });
    // Fallback in case the animation never fires (e.g. tab backgrounded,
    // reduced-motion strips it) — never leave the class stuck.
    setTimeout(cleanup, 900);
  }

  // Unfold the link field open — expand height + fade in (~250ms) instead of
  // snapping visible, so the reveal reads as the page's payoff moment.
  function revealField(field) {
    if (field.classList.contains("revealing") || !field.classList.contains("hidden")) return;
    field.classList.remove("hidden");
    field.classList.add("revealing");
    field.style.overflow = "hidden";
    field.style.height = "0px";
    field.style.marginTop = "0px";
    field.style.opacity = "0";
    void field.offsetHeight; // force reflow before measuring/animating
    const targetHeight = field.scrollHeight;
    field.style.transition = "height 250ms cubic-bezier(.3,.9,.4,1), " +
      "opacity 220ms ease, margin-top 250ms ease";
    requestAnimationFrame(() => {
      field.style.height = targetHeight + "px";
      field.style.opacity = "1";
      field.style.marginTop = "";
    });
    const settle = () => {
      field.style.height = "";
      field.style.overflow = "";
      field.style.transition = "";
      field.classList.remove("revealing");
    };
    field.addEventListener("transitionend", function onEnd(e) {
      if (e.target !== field || e.propertyName !== "height") return;
      field.removeEventListener("transitionend", onEnd);
      settle();
    });
    // Fallback so a dropped transitionend (backgrounded tab, reduced-motion)
    // can't leave the field permanently stuck at a fixed inline height.
    setTimeout(settle, 500);
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

    // Tactile scale-pulse on every tap — the whole field acknowledges the
    // press, not just the copy icon.
    field.classList.remove("pressed");
    void field.offsetWidth;
    field.classList.add("pressed");
    const cleanup = () => field.classList.remove("pressed");
    field.addEventListener("animationend", cleanup, { once: true });
    setTimeout(cleanup, 400);

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
