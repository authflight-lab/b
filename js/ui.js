// Small DOM + formatting helpers. No framework, no dependencies.
(function () {
  const BT = (window.BT = window.BT || {});

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "dataset") {
          for (const d in attrs[k]) node.dataset[d] = attrs[k][d];
        } else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children === null || children === undefined) return;
    if (Array.isArray(children)) {
      children.forEach((c) => appendChildren(node, c));
    } else if (children instanceof Node) {
      node.appendChild(children);
    } else {
      node.appendChild(document.createTextNode(String(children)));
    }
  }

  function clear(node) {
    if (node) while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  // Points formatter: "1,500"
  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return Number(n).toLocaleString("en-US");
  }

  function fmtDate(s) {
    if (!s) return "—";
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return String(s);
      return d.toLocaleString();
    } catch (e) {
      return String(s);
    }
  }

  let toastTimer = null;
  function toast(msg, kind) {
    const host = document.getElementById("toast-host");
    if (!host) return;
    const t = el("div", { class: "toast" + (kind ? " " + kind : "") }, msg);
    host.appendChild(t);
    setTimeout(() => {
      t.style.transition = "opacity .3s ease";
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 320);
    }, 2600);
  }

  // Haptic feedback via Telegram if present (no-op otherwise).
  function haptic(type) {
    try {
      const h = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback;
      if (!h) return;
      if (type === "success" || type === "error" || type === "warning") h.notificationOccurred(type);
      else h.impactOccurred(type || "light");
    } catch (e) {}
  }

  function loading(text) {
    return el("div", { class: "loading" }, text || "Loading…");
  }

  function notice(text) {
    return el("div", { class: "notice" }, text);
  }

  // Cohesive inline-SVG icon set (24×24, stroke = currentColor) so game icons
  // read as one designed pack and inherit theme color. Replaces mismatched glyphs.
  const ICONS = {
    dice:
      '<rect x="3" y="3" width="18" height="18" rx="4.5"/>' +
      '<circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/>',
    flip:
      '<circle cx="12" cy="12" r="9"/>' +
      '<circle cx="12" cy="12" r="4.5"/>',
    mines:
      '<circle cx="10.5" cy="14" r="7"/>' +
      '<path d="M16 9.5C17 7.5 18.5 6 20 6"/>' +
      '<path d="M20 2.8v3.2"/>' +
      '<path d="M18.4 4.4h3.2"/>',
    towers:
      '<path d="M12 2 2 7l10 5 10-5-10-5Z"/>' +
      '<path d="M2 12l10 5 10-5"/>' +
      '<path d="M2 17l10 5 10-5"/>',
    highlow:
      '<path d="M7 4v16"/>' +
      '<path d="M3 8l4-4 4 4"/>' +
      '<path d="M17 20V4"/>' +
      '<path d="M21 16l-4 4-4-4"/>',
    plinko:
      '<circle cx="12" cy="4.5" r="1.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="8" cy="11" r="1.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="16" cy="11" r="1.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="4" cy="17.5" r="1.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="17.5" r="1.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="20" cy="17.5" r="1.5" fill="currentColor" stroke="none"/>',
    rps:
      '<circle cx="6.5" cy="6.5" r="2.8"/>' +
      '<circle cx="6.5" cy="17.5" r="2.8"/>' +
      '<path d="M8.9 8.2 20 19"/>' +
      '<path d="M8.9 15.8 20 5"/>',
    chicken:
      '<path d="M5 16l1.4-4.6A2 2 0 0 1 8.3 10h7.4a2 2 0 0 1 1.9 1.4L19 16"/>' +
      '<path d="M3.5 16h17a1 1 0 0 1 1 1v2h-2.6"/>' +
      '<path d="M5.1 19H3.5a1 1 0 0 1-1-1v-2"/>' +
      '<path d="M9.4 19h5.2"/>' +
      '<circle cx="7.2" cy="19" r="1.6"/>' +
      '<circle cx="16.8" cy="19" r="1.6"/>',
    crash:
      '<path d="M3 19.5L9.5 12l4 3.5L21 6.5"/>' +
      '<path d="M15.5 6.5H21V12"/>',
    blackjack:
      '<rect x="3" y="4" width="10" height="15" rx="2" transform="rotate(-8 8 11.5)"/>' +
      '<rect x="11" y="5" width="10" height="15" rx="2"/>' +
      '<circle cx="16" cy="9.5" r="1.2" fill="currentColor" stroke="none"/>',
    rich:
      '<path d="M12 2v20"/>' +
      '<path d="M17 6c0-2.2-2.24-3.5-5-3.5S7 3.8 7 6s2.24 3.5 5 3.5 5 1.3 5 3.5-2.24 3.5-5 3.5-5-1.3-5-3.5"/>',
    chat:
      '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z"/>' +
      '<circle cx="9" cy="11.5" r="1" fill="currentColor" stroke="none"/>' +
      '<circle cx="12.5" cy="11.5" r="1" fill="currentColor" stroke="none"/>' +
      '<circle cx="16" cy="11.5" r="1" fill="currentColor" stroke="none"/>',
    // token is rendered separately below with its own branded SVG
    shield:
      '<path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3Z"/>' +
      '<path d="M8.8 12l2.2 2.2 4.2-4.4"/>',
    paper:
      '<path d="M6 2.8h12v18.4l-2.4-1.7-2.4 1.7-2.4-1.7-2.4 1.7-2.4-1.7V2.8Z"/>' +
      '<path d="M9 7.5h6"/>' +
      '<path d="M9 11h6"/>' +
      '<path d="M9 14.5h4"/>',
    stats:
      '<path d="M4 20V10"/>' +
      '<path d="M12 20V4"/>' +
      '<path d="M20 20v-7"/>',
    alert:
      '<path d="M12 3.4 22 20.2H2L12 3.4Z"/>' +
      '<path d="M12 9.5v4.6"/>' +
      '<circle cx="12" cy="17.2" r="0.7" fill="currentColor" stroke="none"/>',
    keno:
      '<rect x="3" y="3" width="18" height="18" rx="4.5"/>' +
      '<circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/>' +
      '<circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.5" cy="15.5" r="1.4"/>' +
      '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    copy:
      '<rect x="9" y="9" width="11" height="11" rx="2"/>' +
      '<path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    check:
      '<path d="M20 6 9 17l-5-5"/>',
    home:
      '<path d="M3 10.5 12 3l9 7.5"/>' +
      '<path d="M5 9.5V21h14V9.5"/>' +
      '<path d="M9.5 21v-6h5v6"/>',
    store:
      '<path d="M4 4h16l1 5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0l1-5Z"/>' +
      '<path d="M5 12.5V20h14v-7.5"/>' +
      '<path d="M10 20v-4.5h4V20"/>',
    trophy:
      '<path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/>' +
      '<path d="M7 5H4v1.5A3.5 3.5 0 0 0 7.5 10"/>' +
      '<path d="M17 5h3v1.5A3.5 3.5 0 0 1 16.5 10"/>' +
      '<path d="M12 14v3"/>' +
      '<path d="M8.5 20.5h7"/>' +
      '<path d="M9.5 17.5h5l.8 3h-6.6l.8-3Z"/>',
    people:
      '<circle cx="9" cy="8" r="3"/>' +
      '<path d="M3.5 19a5.5 5.5 0 0 1 11 0"/>' +
      '<path d="M16.5 5.5a3 3 0 0 1 0 5"/>' +
      '<path d="M17 13.5a5.5 5.5 0 0 1 3.5 5.5"/>',
  };

  // Bonus icons (weekly/monthly) — exact SVG designs from the uploaded assets,
  // with the two hardcoded palette colours substituted for the caller's rank colour
  // so the icon always matches the player's current tier.
  // base = ring/glow colour (#007c8f default), hi = detail/highlight (#cbeff5 default).
  function bonusIcon(kind, size, rankColor) {
    const s = size || 32;
    // CSS vars (unranked level 0) can't be used inside SVG attributes — fall back.
    const validHex = rankColor && /^#[0-9a-fA-F]{3,8}$/.test(rankColor);
    const base = validHex ? rankColor : "#007c8f";
    const hi   = validHex ? rankColor : "#cbeff5";

    // Shared structure: outer ring + 8 rays + inner circle.
    const shared =
      '<circle cx="32" cy="32" r="30" fill="' + base + '" fill-opacity="0.18" stroke="' + base + '" stroke-width="2.6"/>' +
      '<g stroke="' + hi + '" stroke-width="4" stroke-linecap="butt">' +
        '<line x1="32" y1="3" x2="32" y2="10.5"/><line x1="32" y1="53.5" x2="32" y2="61"/>' +
        '<line x1="3" y1="32" x2="10.5" y2="32"/><line x1="53.5" y1="32" x2="61" y2="32"/>' +
        '<line x1="11.3" y1="11.3" x2="16.6" y2="16.6"/><line x1="47.4" y1="47.4" x2="52.7" y2="52.7"/>' +
        '<line x1="52.7" y1="11.3" x2="47.4" y2="16.6"/><line x1="16.6" y1="47.4" x2="11.3" y2="52.7"/>' +
      '</g>' +
      '<circle cx="32" cy="32" r="19" fill="' + base + '" fill-opacity="0.30" stroke="' + hi + '" stroke-width="1.5" stroke-opacity="0.6"/>';

    // Glyph paths are the exact path data from the uploaded SVG assets.
    var glyph;
    if (kind === "rakeback") {
      // Arc + arrow + bullseye — no outer ring/rays, own structure.
      const wrap2 = el("span", { class: "icon" });
      wrap2.innerHTML =
        '<svg viewBox="0 0 64 64" width="' + s + '" height="' + s + '" fill="none" aria-hidden="true">' +
        '<path d="M45.86 40.00 L45.56 40.50 L45.24 40.99 L44.90 41.46 L44.55 41.92 L44.18 42.37 L43.80 42.81 L43.40 43.23 L42.98 43.64 L42.55 44.03 L42.11 44.40 L41.65 44.76 L41.18 45.11 L40.69 45.43 L40.20 45.74 L39.70 46.03 L39.18 46.30 L38.66 46.55 L38.12 46.78 L37.58 46.99 L37.03 47.19 L36.48 47.36 L35.92 47.51 L35.35 47.65 L34.78 47.76 L34.20 47.85 L33.63 47.92 L33.05 47.97 L32.47 47.99 L31.88 48.00 L31.30 47.98 L30.72 47.95 L30.14 47.89 L29.57 47.81 L28.99 47.71 L28.42 47.60 L27.86 47.45 L27.30 47.29 L26.75 47.11 L26.20 46.91 L25.66 46.69 L25.13 46.45 L24.61 46.19 L24.10 45.91 L23.60 45.62 L23.11 45.30 L22.63 44.97 L22.17 44.62 L21.72 44.26 L21.28 43.87 L20.85 43.48 L20.44 43.06 L20.05 42.64 L19.67 42.20 L19.31 41.74 L18.96 41.27 L18.63 40.79 L18.32 40.30 L18.03 39.80 L17.75 39.28 L17.50 38.76 L17.26 38.23 L17.05 37.69 L16.85 37.14 L16.67 36.59 L16.52 36.03 L16.38 35.46 L16.26 34.89 L16.17 34.32 L16.10 33.74 L16.04 33.16 L16.01 32.58 L16.00 32.00 L16.01 31.42 L16.04 30.84 L16.10 30.26 L16.17 29.68 L16.26 29.11 L16.38 28.54 L16.52 27.97 L16.67 27.41 L16.85 26.86 L17.05 26.31 L17.26 25.77 L17.50 25.24 L17.75 24.72 L18.03 24.20 L18.32 23.70 L18.63 23.21 L18.96 22.73 L19.31 22.26 L19.67 21.80 L20.05 21.36 L20.44 20.94 L20.85 20.52 L21.28 20.13 L21.72 19.74 L22.17 19.38 L22.63 19.03 L23.11 18.70 L23.60 18.38 L24.10 18.09 L24.61 17.81 L25.13 17.55 L25.66 17.31 L26.20 17.09 L26.75 16.89 L27.30 16.71 L27.86 16.55 L28.42 16.40 L28.99 16.29 L29.57 16.19 L30.14 16.11 L30.72 16.05 L31.30 16.02 L31.88 16.00 L32.47 16.01 L33.05 16.03 L33.63 16.08 L34.20 16.15 L34.78 16.24" fill="none" stroke="' + hi + '" stroke-width="2.6" stroke-linecap="round"/>' +
        '<path d="M42.16 17.55 L32.90 19.97 L34.29 12.10 Z" fill="' + hi + '"/>' +
        '<circle cx="32" cy="32" r="9.5" fill="' + base + '" fill-opacity="0.22" stroke="' + hi + '" stroke-width="1.9"/>' +
        '<circle cx="32" cy="32" r="4.6" fill="' + hi + '"/>' +
        '</svg>';
      return wrap2;
    } else if (kind === "30d") {
      glyph =
        '<path d="M300 747Q375 747 428.5 721.0Q482 695 509.5 650.0Q537 605 537 549Q537 483 504.0 441.5Q471 400 427 385V381Q484 362 517.0 318.0Q550 274 550 205Q550 143 521.5 95.5Q493 48 438.5 21.0Q384 -6 309 -6Q189 -6 117.5 53.0Q46 112 42 231H208Q209 187 233.0 161.5Q257 136 303 136Q342 136 363.5 158.5Q385 181 385 218Q385 266 354.5 287.5Q324 309 257 309H225V448H257Q308 448 339.5 465.5Q371 483 371 528Q371 564 351.0 584.0Q331 604 296 604Q258 604 239.5 581.0Q221 558 218 524H51Q55 631 121.0 689.0Q187 747 300 747Z" transform="matrix(0.01992 0 0 -0.01992 19.4801 39.3805)" fill="' + hi + '"/>' +
        '<path d="M326 745Q474 745 540.5 646.0Q607 547 607 375Q607 201 540.5 102.0Q474 3 326 3Q178 3 111.5 102.0Q45 201 45 375Q45 547 111.5 646.0Q178 745 326 745ZM326 585Q257 585 235.0 530.5Q213 476 213 375Q213 307 221.0 262.5Q229 218 253.5 190.5Q278 163 326 163Q374 163 398.5 190.5Q423 218 431.0 262.5Q439 307 439 375Q439 476 417.0 530.5Q395 585 326 585Z" transform="matrix(0.01992 0 0 -0.01992 31.5319 39.3805)" fill="' + hi + '"/>';
    } else {
      glyph =
        '<path d="M511 602 260 0H85L339 583H28V729H511Z" transform="matrix(0.02606 0 0 -0.02606 25.0281 41.5000)" fill="' + hi + '"/>';
    }

    const wrap = el("span", { class: "icon" });
    wrap.innerHTML =
      '<svg viewBox="0 0 64 64" width="' + s + '" height="' + s + '" fill="none" aria-hidden="true">' +
      shared + glyph + '</svg>';
    return wrap;
  }

  // Branded token SVG (fixed colours, own viewBox — not part of the monochrome set).
  const TOKEN_SVG =
    '<circle cx="32" cy="32" r="30" fill="#007c8f" fill-opacity="0.18" stroke="#007c8f" stroke-width="2.6"/>' +
    '<g stroke="#cbeff5" stroke-width="4" stroke-linecap="butt">' +
      '<line x1="32" y1="3" x2="32" y2="10.5"/>' +
      '<line x1="32" y1="53.5" x2="32" y2="61"/>' +
      '<line x1="3" y1="32" x2="10.5" y2="32"/>' +
      '<line x1="53.5" y1="32" x2="61" y2="32"/>' +
      '<line x1="11.3" y1="11.3" x2="16.6" y2="16.6"/>' +
      '<line x1="47.4" y1="47.4" x2="52.7" y2="52.7"/>' +
      '<line x1="52.7" y1="11.3" x2="47.4" y2="16.6"/>' +
      '<line x1="16.6" y1="47.4" x2="11.3" y2="52.7"/>' +
    '</g>' +
    '<circle cx="32" cy="32" r="19" fill="#007c8f" fill-opacity="0.30" stroke="#cbeff5" stroke-width="1.5" stroke-opacity="0.65"/>' +
    '<path d="M32 19.5 L35.5 28.4 L45 29 L37.7 35.1 L40.1 44.5 L32 39.2 L23.9 44.5 L26.3 35.1 L19 29 L28.5 28.4 Z" fill="#cbeff5" stroke="#cbeff5" stroke-width="1" stroke-linejoin="round"/>';

  function icon(name, size) {
    const s = size || 24;
    const wrap = el("span", { class: "icon" });
    if (name === "token") {
      wrap.innerHTML =
        '<svg viewBox="0 0 64 64" width="' + s + '" height="' + s + '" fill="none" ' +
        'aria-hidden="true">' + TOKEN_SVG + "</svg>";
    } else {
      const body = ICONS[name] || "";
      wrap.innerHTML =
        '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true">' + body + "</svg>";
    }
    return wrap;
  }

  BT.ui = { el, clear, fmt, fmtDate, toast, haptic, loading, notice, icon, bonusIcon, appendChildren };
})();
