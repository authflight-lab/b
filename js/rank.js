// Shared VIP-rank helpers: names, per-rank colours, badge <img>, and a cached
// summary fetch so the Home rank card and the Play-header rank pill can both
// show the player's current tier without each screen re-implementing it.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;

  // Level → display name (server tiers override this when available).
  const NAMES = { 0: "Unranked", 1: "Bronze", 2: "Silver", 3: "Gold", 4: "Platinum", 5: "Diamond" };
  // Level → signature colour, taken from the badge SVGs in files.zip so the UI
  // colour always matches the badge art.
  const COLORS = { 1: "#C88A4B", 2: "#C4CED8", 3: "#F0C04E", 4: "#6FD8D4", 5: "#A6C8FF" };

  function color(level) { return COLORS[level] || "var(--text-dim)"; }

  // The rank badge as an <img> pointing at the SVG art. Unranked → null (no badge).
  function badgeImg(level, size) {
    if (!level || level < 1) return null;
    const s = size || 24;
    return el("img", {
      class: "rank-badge-img",
      src: "assets/vip/tier" + level + ".svg",
      width: String(s), height: String(s),
      alt: (NAMES[level] || "") + " rank",
    });
  }

  // Cached VIP summary. Level rarely changes within a session, so one fetch is
  // shared by every surface; pass force=true to refresh.
  let _cache = null;
  async function summary(force) {
    if (_cache && !force) return _cache;
    const data = await BT.api.vip();
    if (data && data.ok !== false && !data.error && Array.isArray(data.tiers)) {
      const st = data.state || {};
      const lvl = st.current_level || 0;
      const tier = data.tiers.find((t) => t.level === lvl) || {};
      _cache = { level: lvl, state: st, tiers: data.tiers, name: tier.name || NAMES[lvl] || "Unranked" };
      return _cache;
    }
    // Unconfigured / error → a safe Unranked shape (not cached, so it retries).
    return { level: 0, state: {}, tiers: [], name: "Unranked", _unavailable: true };
  }

  // Fill a host node with [badge?] + name and set --rank-color for styling.
  function fillPill(node, s) {
    BT.ui.clear(node);
    const lvl = (s && s.level) || 0;
    const badge = badgeImg(lvl, 18);
    if (badge) node.appendChild(badge);
    node.appendChild(el("span", { class: "rank-pill-name" }, (s && s.name) || NAMES[lvl] || "Unranked"));
    node.style.setProperty("--rank-color", color(lvl));
    node.classList.toggle("ranked", lvl >= 1);
  }

  BT.rank = { NAMES, COLORS, color, badgeImg, summary, fillPill };
})();
