// Plinko — single settle. Drop a ball; server returns the full path & slot.
// Redesigned board: peg pyramid + colored multiplier buckets + bouncing ball.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  // Per-bucket multiplier — mirrors the settle formula so bucket labels match
  // the payout the server actually returns. (Display only; no math is changed.)
  function bucketMult(j, rows, risk) {
    const center = rows / 2;
    const dist = Math.abs(j - center) / center;
    const base = risk === "high" ? [0, 0.2, 0.5, 1, 2, 5, 12] : [0.3, 0.5, 0.8, 1, 1.3, 1.8, 3];
    const idx = Math.min(base.length - 1, Math.floor(dist * (base.length - 1)));
    return base[idx];
  }

  function fmtMult(m) {
    const r = Math.round(m * 100) / 100;
    return r + "x";
  }

  function lerp(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }
  const rgb = (c) => "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";

  // Center = warm yellow (low payout), edges = hot red (high payout).
  function bucketColor(j, rows) {
    const center = rows / 2;
    const d = Math.abs(j - center) / center; // 0 center .. 1 edge
    const YELLOW = [250, 205, 74];
    const ORANGE = [246, 133, 31];
    const RED = [244, 54, 76];
    return d < 0.5 ? lerp(YELLOW, ORANGE, d * 2) : lerp(ORANGE, RED, (d - 0.5) * 2);
  }

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let busy = false;

    // ---- Segmented chip controls (rows + risk) ----
    function chipGroup(opts, initial, onChange) {
      let value = initial;
      const btns = [];
      const wrap = el("div", { class: "chips seg" });
      opts.forEach((o) => {
        const b = el(
          "button",
          {
            class: "chip" + (o.value === value ? " active" : ""),
            type: "button",
            onclick: () => {
              if (busy || value === o.value) return;
              value = o.value;
              btns.forEach((x) => x.el.classList.toggle("active", x.value === value));
              onChange && onChange(value);
            },
          },
          o.label
        );
        btns.push({ el: b, value: o.value });
        wrap.appendChild(b);
      });
      return { node: wrap, get: () => value };
    }

    const rows = chipGroup(
      [8, 12, 16].map((n) => ({ value: n, label: String(n) })),
      12,
      () => rebuild()
    );
    const risk = chipGroup(
      [{ value: "low", label: "Low" }, { value: "high", label: "High" }],
      "low",
      () => rebuild()
    );

    // ---- Board ----
    const board = el("div", { class: "pk-board" });
    const pegs = el("div", { class: "pk-pegs" });
    const ball = el("div", { class: "pk-ball hidden" });
    pegs.appendChild(ball);
    board.appendChild(pegs);
    const buckets = el("div", { class: "pk-buckets" });
    let bucketEls = [];

    function rebuild() {
      const n = rows.get();
      const rk = risk.get();
      board.style.height = n * 22 + 46 + "px";

      // Pegs: n rows, row r (0-based) has r+3 pegs → bottom row has n+2 pegs
      // → n+1 gaps → n+1 buckets. u = one bucket width as a fraction.
      const u = 1 / (n + 1);
      const frag = document.createDocumentFragment();
      for (let r = 0; r < n; r++) {
        const count = r + 3;
        const yfrac = (r + 1) / (n + 1);
        const leftInset = (n - 1 - r) / 2;
        for (let m = 0; m < count; m++) {
          const xfrac = (leftInset + m) * u;
          const dot = el("div", { class: "pk-peg" });
          dot.style.left = xfrac * 100 + "%";
          dot.style.top = yfrac * 90 + 4 + "%";
          frag.appendChild(dot);
        }
      }
      BT.ui.clear(pegs);
      pegs.appendChild(ball);
      pegs.appendChild(frag);

      // Buckets
      BT.ui.clear(buckets);
      buckets.classList.toggle("dense", n >= 16);
      bucketEls = [];
      for (let j = 0; j <= n; j++) {
        const m = bucketMult(j, n, rk);
        const b = el("div", { class: "pk-bucket", dataset: { j: String(j) } }, fmtMult(m));
        b.style.background = rgb(bucketColor(j, n));
        buckets.appendChild(b);
        bucketEls.push(b);
      }
    }
    rebuild();
    const overlay = C.resultOverlay(board);

    const dropBtn = el("button", { class: "btn primary block" }, "Drop Ball");

    function frame(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    async function animatePath(path, n) {
      const steps = Array.isArray(path) ? path : [];
      const total = steps.length || n;
      const u = 1 / (n + 1);
      let rights = 0;
      ball.classList.remove("hidden");
      ball.style.left = "50%";
      ball.style.top = "0%";
      await frame(30);
      for (let i = 1; i <= total; i++) {
        const s = steps[i - 1];
        const goRight = s === 1 || s === "R" || s === "r" || s === true;
        if (goRight) rights++;
        const xfrac = 0.5 + (rights - i / 2) * u;
        ball.style.left = xfrac * 100 + "%";
        ball.style.top = (i / total) * 90 + 4 + "%";
        await frame(92);
      }
      return rights;
    }

    function setBusy(v) {
      busy = v;
      dropBtn.disabled = v;
      rows.node.classList.toggle("locked", v);
      risk.node.classList.toggle("locked", v);
    }

    dropBtn.addEventListener("click", async () => {
      if (busy) return;
      setBusy(true);
      overlay.hide(); banner.hide();
      seed.reset();
      const n = rows.get();
      const rk = risk.get();
      bucketEls.forEach((b) => b.classList.remove("hit"));
      try {
        const betResp = await BT.api.gameBet("plinko", {
          bet: bet.getBet(),
          client_seed: C.clientSeed(),
          params: { rows: n, risk: rk },
        });
        if (!betResp || betResp.ok === false) {
          BT.ui.toast(C.errText(betResp), "error");
          return;
        }
        seed.setHash(betResp.server_hash);
        seed.setNonce(betResp.nonce);
        if (typeof betResp.balance === "number") BT.setBalance(betResp.balance);

        const s = await BT.api.gameSettle("plinko", { round_id: betResp.round_id });
        if (!s || s.ok === false) {
          BT.ui.toast(C.errText(s), "error");
          return;
        }
        seed.revealSeed(s.server_seed);
        const o = s.outcome || {};
        await animatePath(o.path, n);
        const slot = o.slot !== undefined ? o.slot : o.bucket;
        if (slot !== undefined && slot >= 0 && slot < bucketEls.length) {
          ball.style.left = ((slot + 0.5) / (n + 1)) * 100 + "%";
          ball.style.top = "98%";
          const hit = bucketEls[slot];
          // Show the exact multiplier the server actually paid for this bucket.
          if (o.multiplier !== undefined) hit.textContent = fmtMult(o.multiplier);
          hit.classList.add("hit");
        }
        C.syncBalance(s);
        const payout = s.payout || 0;
        const multTxt = o.multiplier !== undefined ? " (" + fmtMult(o.multiplier) + ")" : "";
        if (payout > 0) {
          overlay.show("win", o.multiplier !== undefined ? fmtMult(o.multiplier) : "Win!", "+" + BT.ui.fmt(payout) + " pts");
          BT.ui.haptic("success");
        } else {
          overlay.show("lose", o.multiplier !== undefined ? fmtMult(o.multiplier) : "0x", "No win");
          BT.ui.haptic("error");
        }
      } finally {
        setBusy(false);
      }
    });

    root.appendChild(
      el("div", { class: "card" }, [
        el("h3", { class: "game-title" }, [BT.ui.icon("plinko", 22), el("span", null, "Plinko")]),
        el(
          "p",
          { class: "small muted" },
          "Drop the ball through the pegs — where it lands sets your multiplier. Edges pay big but are rare; the center is safe. More rows and higher risk spread the payouts wider."
        ),
        board,
        buckets,
        el("div", { class: "row plinko-opts" }, [
          el("div", { class: "field grow" }, [el("label", null, "Rows"), rows.node]),
          el("div", { class: "field grow" }, [el("label", null, "Risk"), risk.node]),
        ]),
        bet.node,
        dropBtn,
        banner.node,
        seed.node,
      ])
    );
  }

  C.register({ key: "plinko", title: "Plinko", render });
})();
