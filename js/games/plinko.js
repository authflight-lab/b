// Plinko — unlimited concurrent balls in one shared physics sim. Every ball
// is a real, independently-throttled bet (bet -> settle); the sim only
// renders motion and steers each ball toward the bucket the server already
// decided. No odds/payout math happens here — outcome.slot/multiplier and
// payout come straight from the settle response.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  // Per-bucket multiplier — an EXACT port of api/game/plinko.py's
  // multiplier(j, n, risk), not an approximation. Bucket labels are the only
  // thing the player uses to judge where a good drop lands, so a client-side
  // mismatch with the server's real payout table is actively misleading
  // (ball visually "lands" on a label the settle response then contradicts).
  // Keep RISK/EPS and the lambda/weight math byte-for-byte in sync with the
  // Python source if that file ever changes.
  const EPS = 0.02; // must match api/game/__init__.py EPS
  const RISK_CFG = {
    low: { b: 1.3, alpha: 1.0 },
    high: { b: 2.2, alpha: 1.1 },
  };
  function binomPmf(n, j) {
    // C(n, j) / 2^n, built iteratively to avoid overflow on n up to 16.
    let c = 1;
    for (let i = 0; i < j; i++) c = (c * (n - i)) / (i + 1);
    return c / Math.pow(2, n);
  }
  function bucketWeight(j, n, b, alpha) {
    return Math.pow(b, Math.pow(Math.abs(j - n / 2), alpha));
  }
  const _lambdaCache = {};
  function bucketLambda(n, risk) {
    const key = n + ":" + risk;
    if (_lambdaCache[key] !== undefined) return _lambdaCache[key];
    const cfg = RISK_CFG[risk];
    let denom = 0;
    for (let j = 0; j <= n; j++) denom += binomPmf(n, j) * bucketWeight(j, n, cfg.b, cfg.alpha);
    const lam = (1 - EPS) / denom;
    _lambdaCache[key] = lam;
    return lam;
  }
  function bucketMult(j, rows, risk) {
    const cfg = RISK_CFG[risk];
    return bucketLambda(rows, risk) * bucketWeight(j, rows, cfg.b, cfg.alpha);
  }

  function fmtMult(m) {
    const r = Math.round(m * 100) / 100;
    return r + "x";
  }

  // Errors plinko handles with a quiet button cooldown instead of a toast:
  // spam-tapping naturally trips server rate limiting and round-timing races,
  // and a flood of "slow down" / "that round has ended" toasts is worse than
  // silently pacing the next drop (the 750ms button greyout does the pacing).
  const SILENT_PLINKO_ERRORS = { rate_limited: 1, round_not_open: 1, no_open_round: 1 };
  function reportPlinkoErr(resp) {
    const code = (resp && resp.error) || "";
    if (SILENT_PLINKO_ERRORS[code]) return;
    BT.ui.toast(C.errText(resp), "error");
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

  // ---- Spawn throttle (tunable) ----
  // Tap-to-drop: every tap fires a real bet, spam-tapping is fine. Because
  // spawn is throttled, spawn rate == bet rate — this is the only rate
  // control on the client; the server rate limiter remains the backstop.
  const SPAWN_MS = 200;      // min ms between two ball spawns (min tap gap)
  const MAX_INFLIGHT = 12;   // max bets placed-but-not-yet-settled at once

  // ---- Physics constants ----
  const BALL_TIME_SCALE = 0.7; // ball motion runs at 70% speed (30% slower)
  const GRAVITY = 1900;      // px/s^2
  const BALL_R = 6.5;
  const PEG_R = 3;
  const REST = 0.42;         // peg-bounce restitution
  const WALL_REST = 0.5;
  const MAX_VX = 260;
  const BALL_REPEL = 900;    // ball-vs-ball soft push strength

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let busy = false; // true while any ball is in flight or animating — locks rows/risk

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
    const pegsWrap = el("div", { class: "pk-pegs" });
    const canvas = el("canvas", { class: "pk-canvas" });
    const ctx = canvas.getContext("2d");
    pegsWrap.appendChild(canvas);
    board.appendChild(pegsWrap);
    const buckets = el("div", { class: "pk-buckets" });
    let bucketEls = [];

    // Small running net (this board only — separate from the shared session
    // panel below) so the player sees at a glance whether this drop streak
    // is up or down. Only counts balls that actually resolved a payout.
    let net = 0;
    const netEl = el("div", { class: "pk-net" }, "+0");
    board.appendChild(netEl);
    function updateNet(delta) {
      net += delta;
      const rounded = Math.round(net * 100) / 100;
      netEl.textContent = (rounded >= 0 ? "+" : "") + rounded;
      netEl.classList.toggle("pos", rounded > 0);
      netEl.classList.toggle("neg", rounded < 0);
    }

    // (The old on-board session stats box lived here; it was replaced by the
    // shared session P&L tracker rendered under every game — see play.js.)

    // ---- Sim state ----
    let W = 0, H = 0, DPR = 1;
    let pegs = [];
    let balls = [];
    let ballIdSeq = 0;
    let lastSpawnAt = 0;
    let inFlightCount = 0;
    let pendingStake = 0; // bet amounts fired but whose /bet response hasn't landed yet
    let rafId = null;
    let lastT = null;
    let landingY = 0;
    let lastPegY = 0; // y of the bottom-most peg row — the "commit line"

    function sizeCanvas() {
      DPR = window.devicePixelRatio || 1;
      const rect = pegsWrap.getBoundingClientRect();
      W = Math.max(1, Math.round(rect.width));
      H = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      landingY = H - BALL_R - 1;
    }

    function computePegs() {
      const n = rows.get();
      const u = 1 / (n + 1);
      const list = [];
      for (let r = 0; r < n; r++) {
        const count = r + 3;
        const yfrac = (r + 1) / (n + 1);
        const leftInset = (n - 1 - r) / 2;
        const y = (yfrac * 0.9 + 0.04) * H;
        for (let m = 0; m < count; m++) {
          const xfrac = (leftInset + m) * u;
          list.push({ x: xfrac * W, y });
        }
      }
      pegs = list;
      // The commit line sits at the bottom peg row: above it the ball falls
      // freely and optimistically; below it (the clear gap before the buckets)
      // there are no pegs, so the ball's x is steered deterministically to the
      // resolved bucket. The ball is never allowed to cross this line until the
      // server outcome is known — that is what guarantees the visual landing
      // always matches the settled multiplier.
      lastPegY = list.length ? list[list.length - 1].y : 0;
    }

    function bucketX(j, n) {
      return ((j + 0.5) / (n + 1)) * W;
    }

    function rebuildGeometry() {
      sizeCanvas();
      computePegs();
    }
    window.addEventListener("resize", rebuildGeometry);

    function rebuild() {
      const n = rows.get();
      const rk = risk.get();
      board.style.height = n * 22 + 46 + "px";

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
      rebuildGeometry();
    }
    rebuild();

    const dropBtn = el("button", { class: "btn primary block" }, "Drop Ball");

    function updateBusyLock() {
      const active = balls.length > 0 || inFlightCount > 0;
      if (active !== busy) {
        busy = active;
        rows.node.classList.toggle("locked", busy);
        risk.node.classList.toggle("locked", busy);
      }
    }

    function updateDropLabel() {
      dropBtn.textContent = inFlightCount > 0
        ? "Drop Ball \u00b7 " + inFlightCount + " in flight"
        : "Drop Ball";
    }

    // Tap pacing: after each tap the Drop button greys out and can't be clicked
    // for 750ms. This replaces the old rate-limit / round-ended toast flood with
    // a quiet, visible cooldown — the button itself paces the drops.
    const DROP_COOLDOWN_MS = 750;
    function coolDrop() {
      dropBtn.disabled = true;
      setTimeout(() => { dropBtn.disabled = false; }, DROP_COOLDOWN_MS);
    }

    function flashBucket(elm, win) {
      elm.classList.remove("flash-win", "flash-loss");
      void elm.offsetWidth;
      elm.classList.add(win ? "flash-win" : "flash-loss");
      setTimeout(() => elm.classList.remove("flash-win", "flash-loss"), 520);
    }

    function removeBall(ball) {
      const idx = balls.indexOf(ball);
      if (idx >= 0) balls.splice(idx, 1);
      updateBusyLock();
      updateDropLabel();
    }

    // Bucket flash + haptic fire only here — when the ball actually reaches
    // its bucket — so nothing gives away the outcome before it lands.
    function finalizeBall(ball, n) {
      if (ball.done) return;
      ball.done = true;
      removeBall(ball);
      const slot = ball.target;
      if (slot !== null && slot !== undefined && bucketEls[slot]) {
        flashBucket(bucketEls[slot], ball.payout > 0);
      }
      BT.ui.haptic(ball.payout > 0 ? "success" : "error");
      if (ball.resolved) updateNet((ball.payout || 0) - (ball.bet || 0));
    }

    // Spawn one ball = one real bet. Fires gameBet then gameSettle; the ball
    // falls immediately (optimistic) and is steered toward the server's
    // bucket once the settle response names it. The ball never determines
    // its own payout — only performs the server's already-decided answer.
    async function spawnBall(betAmt) {
      const n = rows.get();
      const rk = risk.get();
      pendingStake += betAmt;
      inFlightCount++;
      updateBusyLock();
      updateDropLabel();

      const ball = {
        id: ++ballIdSeq,
        x: W / 2 + (Math.random() - 0.5) * 6,
        y: BALL_R + 2,
        vx: (Math.random() - 0.5) * 40,
        vy: 0,
        r: BALL_R,
        bet: betAmt,
        target: null,
        multiplier: null,
        payout: null,
        resolved: false,
        waiting: false,
        committed: false,
        commitX: 0,
        commitY: 0,
        done: false,
      };
      balls.push(ball);

      let betResp;
      try {
        betResp = await BT.api.gameBet("plinko", { bet: betAmt, params: { rows: n, risk: rk } });
      } catch (e) {
        betResp = null;
      }
      pendingStake = Math.max(0, pendingStake - betAmt);

      if (!betResp || betResp.ok === false) {
        reportPlinkoErr(betResp);
        inFlightCount = Math.max(0, inFlightCount - 1);
        removeBall(ball);
        return;
      }
      if (typeof betResp.balance === "number") BT.setBalance(betResp.balance);
      seed.setHash(betResp.server_hash);
      seed.setNonce(betResp.nonce);
      BT.fair.noteBet(betResp);

      let s;
      try {
        s = await BT.api.gameSettle("plinko", { round_id: betResp.round_id });
      } catch (e) {
        s = null;
      }
      inFlightCount = Math.max(0, inFlightCount - 1);
      updateDropLabel();

      if (!s || s.ok === false) {
        reportPlinkoErr(s);
        removeBall(ball);
        return;
      }
      const o = s.outcome || {};
      const slot = o.slot !== undefined ? o.slot : o.bucket;
      ball.target = typeof slot === "number" ? slot : null;
      ball.multiplier = o.multiplier;
      ball.payout = s.payout || 0;
      ball.resolved = true;
      C.syncBalance(s);
      // The ball reads `ball.resolved` on its next physics frame: if it is
      // still falling it will commit at the commit line; if it is already
      // parked there it releases into the deterministic glide to the bucket.
      updateBusyLock();
    }

    function trySpawn() {
      const now = C.nowMs();
      if (now - lastSpawnAt < SPAWN_MS) return false;
      if (inFlightCount >= MAX_INFLIGHT) return false;
      const betAmt = bet.getBet();
      const avail = ((BT.state && BT.state.balance) || 0) - pendingStake;
      if (betAmt > avail) return false;
      lastSpawnAt = now;
      spawnBall(betAmt);
      return true;
    }

    // ---- Physics step ----
    function resolvePegCollision(ball, peg) {
      const dx = ball.x - peg.x, dy = ball.y - peg.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = ball.r + PEG_R;
      if (dist >= minDist || dist < 1e-4) return;
      const nx = dx / dist, ny = dy / dist;
      const overlap = minDist - dist;
      ball.x += nx * overlap;
      ball.y += ny * overlap;
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        ball.vx -= (1 + REST) * vn * nx;
        ball.vy -= (1 + REST) * vn * ny;
      }
      // Small random jitter so bounces off the same peg never look identical.
      ball.vx += (Math.random() - 0.5) * 55;
      if (ball.vy < 40) ball.vy = 40;
    }

    function resolveBallRepulsion(a, b, dt) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = a.r + b.r;
      if (dist >= minDist || dist < 1e-4) return;
      const nx = dx / dist, ny = dy / dist;
      const overlap = minDist - dist;
      a.x -= nx * overlap * 0.5; a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5; b.y += ny * overlap * 0.5;
      const push = BALL_REPEL * dt;
      a.vx -= nx * push; a.vy -= ny * push * 0.3;
      b.vx += nx * push; b.vy += ny * push * 0.3;
    }

    function step(dt) {
      // Ball motion runs in its own slowed-down time (30% slower than real
      // time) so drops feel more deliberate; spawn throttling above still
      // uses real time.
      const bdt = dt * BALL_TIME_SCALE;
      const n = rows.get();
      // The commit line: last peg row, clamped a little above the buckets so
      // there is always some clear gap left to slide across into the target.
      const commitY = Math.min(lastPegY, landingY - BALL_R * 2);
      const hasTarget = (b) => b.target !== null && b.target !== undefined;
      for (const ball of balls) {
        if (ball.done) continue;

        // Phase 3 — committed: below the commit line the outcome is known, so
        // the ball is steered deterministically to the exact target bucket.
        // No pegs live down here and x is interpolated (not physics-driven),
        // so it ALWAYS lands dead-center in the resolved bucket.
        if (ball.committed) {
          ball.vy += GRAVITY * bdt;
          ball.y += ball.vy * bdt;
          if (hasTarget(ball)) {
            const targetX = bucketX(ball.target, n);
            const span = Math.max(1, landingY - ball.commitY);
            const t = Math.min(1, Math.max(0, (ball.y - ball.commitY) / span));
            const e = t * t * (3 - 2 * t); // smoothstep — eased horizontal glide
            ball.x = ball.commitX + (targetX - ball.commitX) * e;
          }
          if (ball.y >= landingY) {
            ball.y = landingY;
            // Belt-and-suspenders: snap x exactly onto the target center before
            // finalizing, so even a mid-flight resize (which can shift landingY
            // below a ball's stored commitY and short-circuit the glide) can
            // never leave the ball landing off its resolved bucket.
            if (hasTarget(ball)) ball.x = bucketX(ball.target, n);
            finalizeBall(ball, n);
          }
          continue;
        }

        if (!ball.waiting) {
          ball.vy += GRAVITY * bdt;
          ball.x += ball.vx * bdt;
          ball.y += ball.vy * bdt;

          // Soft steer toward the target while still known — a natural bias so
          // the eventual deterministic glide below the commit line is small.
          if (hasTarget(ball)) {
            const targetX = bucketX(ball.target, n);
            const proximity = Math.min(1, Math.max(0, ball.y / landingY));
            const gain = 3 + proximity * 9;
            ball.vx += (targetX - ball.x) * gain * bdt;
          }
          ball.vx = Math.max(-MAX_VX, Math.min(MAX_VX, ball.vx));

          if (ball.x < ball.r) { ball.x = ball.r; ball.vx = Math.abs(ball.vx) * WALL_REST; }
          if (ball.x > W - ball.r) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx) * WALL_REST; }

          for (const peg of pegs) resolvePegCollision(ball, peg);

          // Reaching the commit line: only cross it once the outcome is known.
          if (ball.y >= commitY) {
            if (ball.resolved) {
              ball.committed = true;
              ball.commitY = commitY;
              ball.commitX = ball.x;
              ball.y = commitY;
            } else {
              // Outcome not back yet — park (hover) on the commit line rather
              // than committing to a bucket the server hasn't chosen.
              ball.waiting = true;
              ball.y = commitY;
              ball.vy = 0;
              ball.vx *= 0.4;
            }
          }
        } else {
          // Parked on the commit line. Release into the deterministic glide the
          // instant the outcome lands; otherwise drift gently in place.
          if (ball.resolved) {
            ball.committed = true;
            ball.commitY = commitY;
            ball.commitX = ball.x;
            ball.waiting = false;
            ball.vy = 0;
          } else {
            ball.vx *= 0.9;
            ball.x += ball.vx * bdt;
            ball.x = Math.max(ball.r, Math.min(W - ball.r, ball.x));
          }
        }
      }

      // Ball-vs-ball soft repulsion so concurrent balls jostle instead of
      // stacking exactly on top of one another. Only free-falling balls take
      // part: a parked (waiting) ball must not be shoved across the commit line
      // before its outcome is known, and a committed ball's x is deterministic
      // (repulsion would knock it off its guaranteed target glide).
      const jostles = (b) => !b.done && !b.waiting && !b.committed;
      for (let i = 0; i < balls.length; i++) {
        if (!jostles(balls[i])) continue;
        for (let j = i + 1; j < balls.length; j++) {
          if (!jostles(balls[j])) continue;
          resolveBallRepulsion(balls[i], balls[j], bdt);
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#b9c1cf";
      for (const p of pegs) {
        const g = ctx.createRadialGradient(p.x - 1, p.y - 1, 0.5, p.x, p.y, PEG_R);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(1, "#b9c1cf");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, PEG_R, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const ball of balls) {
        if (ball.done) continue;
        const g = ctx.createRadialGradient(
          ball.x - ball.r * 0.3, ball.y - ball.r * 0.35, 0.5,
          ball.x, ball.y, ball.r
        );
        g.addColorStop(0, "#fff3c4");
        g.addColorStop(0.55, "#f7b733");
        g.addColorStop(1, "#e8890c");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop(t) {
      if (lastT === null) lastT = t;
      let dt = (t - lastT) / 1000;
      lastT = t;
      dt = Math.min(dt, 0.032);
      step(dt);
      draw();
      rafId = requestAnimationFrame(loop);
    }

    // Tap-to-drop: spam-tap the button, every tap fires a real bet (still
    // gated by SPAWN_MS + MAX_INFLIGHT + affordability inside trySpawn()).
    dropBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (dropBtn.disabled) return;
      trySpawn();
      coolDrop();
    });

    root.appendChild(
      el("div", { class: "card" }, [
        C.gameHeader("plinko", "Plinko", "Drop the ball through the pegs — where it lands sets your multiplier. Tap the button to drop a ball — each tap is its own real bet. Edges pay big but are rare; the center is safe. More rows and higher risk spread the payouts wider."),
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

    // The board must be attached to the document before we can measure it —
    // rebuild() above ran while `board` was still detached, so its canvas
    // sizing/peg geometry was computed against a 0x0 rect. Re-measure now.
    rebuildGeometry();

    rafId = requestAnimationFrame(loop);
  }

  C.register({ key: "plinko", title: "Plinko", render });
})();
