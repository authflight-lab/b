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

  BT.ui = { el, clear, fmt, fmtDate, toast, haptic, loading, notice, icon, appendChildren };
})();
