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

  BT.ui = { el, clear, fmt, fmtDate, toast, haptic, loading, notice, appendChildren };
})();
