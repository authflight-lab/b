// Chicken Cross — hop across road lanes, avoid the car zones. /step + /cashout.
// The chicken starts on the left kerb; each lane is a vertical strip of C
// crossing zones, T of which hide a car (server-determined). Tap a zone in the
// next lane to hop there. All vehicle animation here is COSMETIC — outcomes
// come only from the server response (the active server seed is secret, so
// nothing is ever predicted client-side). Ladder values are a PREVIEW from the
// published formula (0.98 * (C/(C-T))^L, capped 20x); the real payout is
// always the server's multiplier.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const EPS = 0.02;      // matches api/game/chicken.py
  const CAP = 20;        // CHICKEN_MAX_MULT
  const MAX_LANES = 8;   // LANES
  const DIFF = {
    easy:      { C: 3, growth: 3 / 2, label: "Easy (3 zones, 1 car)" },
    medium:    { C: 2, growth: 2 / 1, label: "Medium (2 zones, 1 car)" },
    hard:      { C: 3, growth: 3 / 1, label: "Hard (3 zones, 2 cars)" },
    daredevil: { C: 4, growth: 4 / 1, label: "Daredevil (4 zones, 3 cars)" },
  };
  const CHICK = "\uD83D\uDC14";  // 🐔
  const CAR = "\uD83D\uDE97";    // 🚗
  const SPLAT = "\uD83D\uDCA5";  // 💥
  const TRAFFIC = ["\uD83D\uDE97", "\uD83D\uDE95", "\uD83D\uDE99", "\uD83D\uDE9B"]; // 🚗🚕🚙🚛

  const laneMult = (L, g) => Math.min((1 - EPS) * Math.pow(g, L), CAP);
  // Road depth per difficulty: the run auto-cashes once the raw multiplier
  // reaches the cap, so only render the reachable lanes.
  function lanesFor(g) {
    for (let L = 1; L <= MAX_LANES; L++) {
      if ((1 - EPS) * Math.pow(g, L) >= CAP) return L;
    }
    return MAX_LANES;
  }

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    let stake = 0;
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let roundId = null, busy = false, ended = true;
    let curLane = 0, cols = 2, laneCount = 5, mult = 1.0, crossed = 0;

    const diffSel = el("select", null, Object.keys(DIFF).map((k) =>
      el("option", { value: k }, DIFF[k].label)));
    diffSel.value = "medium";

    const road = el("div", { class: "ck-road" });
    const roadWrap = el("div", { class: "ck-road-wrap" }, road);
    const overlay = C.resultOverlay(roadWrap);

    const chickenEl = el("span", { class: "ck-chicken" }, CHICK);
    let startPadCell = null;
    let chickenHome = null; // cell the chicken currently rests in

    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const cashBtn = el("button", { class: "btn primary block ck-cash", style: "display:none" }, "Cash out");

    function syncCashout() {
      cashBtn.disabled = crossed < 1 || busy;
      cashBtn.textContent = crossed >= 1 ? "Cash out \u00b7 " + mult.toFixed(2) + "\u00d7" : "Cash out";
    }

    // Cosmetic traffic: a couple of vehicles per lane drifting down the strip
    // at randomized speeds/offsets, running continuously via CSS keyframes.
    function seedTraffic(trafficEl) {
      for (let i = 0; i < 2; i++) {
        const v = el("span", { class: "ck-vehicle" },
          TRAFFIC[Math.floor(Math.random() * TRAFFIC.length)]);
        v.style.left = (12 + Math.random() * 56) + "%";
        v.style.animationDuration = (2.4 + Math.random() * 2.6).toFixed(2) + "s";
        v.style.animationDelay = (-Math.random() * 4).toFixed(2) + "s";
        trafficEl.appendChild(v);
      }
    }

    // Near-miss beat: a fast truck zips through the lane just crossed.
    function nearMiss(laneEl) {
      const t = laneEl && laneEl.querySelector(".ck-traffic");
      if (!t) return;
      const v = el("span", { class: "ck-vehicle zoom" }, "\uD83D\uDE9B");
      v.style.left = (20 + Math.random() * 40) + "%";
      t.appendChild(v);
      setTimeout(() => v.remove(), 700);
    }

    function buildRoad() {
      BT.ui.clear(road);
      startPadCell = el("div", { class: "ck-pad-cell" });
      road.appendChild(el("div", { class: "ck-pad" }, [
        el("div", { class: "ck-lane-mult pad" }, "Start"),
        startPadCell,
      ]));
      const d = DIFF[diffSel.value];
      for (let l = 0; l < laneCount; l++) {
        const cells = el("div", { class: "ck-cells" });
        for (let z = 0; z < cols; z++) {
          const cell = el("div", { class: "ck-cell disabled", dataset: { l: String(l), z: String(z) } });
          cell.addEventListener("click", () => pick(l, z));
          cells.appendChild(cell);
        }
        const traffic = el("div", { class: "ck-traffic" });
        seedTraffic(traffic);
        const laneEl = el("div", { class: "ck-lane dim", dataset: { l: String(l) } }, [
          el("div", { class: "ck-lane-mult" }, laneMult(l + 1, d.growth).toFixed(2) + "\u00d7"),
          el("div", { class: "ck-strip" }, [traffic, cells]),
        ]);
        road.appendChild(laneEl);
      }
      placeChicken(startPadCell);
    }

    function placeChicken(cell) {
      chickenHome = cell;
      chickenEl.classList.remove("hop"); void chickenEl.offsetWidth;
      cell.appendChild(chickenEl);
      chickenEl.classList.add("hop");
      if (cell.scrollIntoView) cell.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }

    // Light the active lane, keep crossed lanes lit, dim lanes ahead, and only
    // allow taps on the active lane's zones.
    function enableLane(l) {
      road.querySelectorAll(".ck-lane").forEach((laneEl) => {
        const cl = parseInt(laneEl.dataset.l, 10);
        const isActive = cl === l;
        laneEl.classList.toggle("active", isActive);
        laneEl.classList.toggle("dim", !isActive && cl > (l < 0 ? laneCount : l));
        laneEl.querySelectorAll(".ck-cell").forEach((cell) => {
          cell.classList.toggle("disabled", !isActive);
        });
      });
    }

    startBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; startBtn.disabled = true;
      overlay.hide(); banner.hide(); seed.reset();
      const d = DIFF[diffSel.value];
      cols = d.C; laneCount = lanesFor(d.growth);
      curLane = 0; crossed = 0; mult = 1.0;
      buildRoad();
      stake = bet.getBet();
      const resp = await BT.api.gameBet("chicken", { bet: stake, params: { difficulty: diffSel.value } });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id; ended = false;
      BT.setActiveGame("chicken", roundId);
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce); BT.fair.noteBet(resp);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      startBtn.style.display = "none"; cashBtn.style.display = "block";
      bet.setDisabled(true); diffSel.disabled = true;
      syncCashout();
      enableLane(0);
    });

    async function pick(l, z) {
      if (busy || ended || !roundId || l !== curLane) return;
      busy = true; enableLane(-1); cashBtn.disabled = true;
      // Outcome-free motion: hop into the chosen zone the instant of the tap
      // and hold a minimum motion window; the server response then decides
      // whether the chicken lands (safe) or gets splatted (bust).
      const laneEl = road.querySelector('.ck-lane[data-l="' + l + '"]');
      const cell = laneEl && laneEl.querySelector('.ck-cell[data-z="' + z + '"]');
      const prevHome = chickenHome;
      if (cell) placeChicken(cell);
      const t0 = C.nowMs();
      const resp = await BT.api.gameStep("chicken", { round_id: roundId, move: { zone: z } });
      await C.hold(t0, 480);
      busy = false;
      if (!resp || resp.ok === false) {
        BT.ui.toast(C.errText(resp), "error");
        if (prevHome) placeChicken(prevHome);
        enableLane(curLane); syncCashout();
        return;
      }
      const os = resp.outcome_step || {};
      const outcome = resp.outcome || {};
      const safe = os.safe !== undefined ? os.safe : !resp.busted;
      if (!safe) {
        // Bust — splat on the chosen zone and disclose the lane's car zones
        // (the API reveals them in the settle outcome).
        const cars = outcome.cars || os.cars || [];
        if (laneEl) {
          laneEl.classList.add("bust");
          cars.forEach((cz) => {
            const ccell = laneEl.querySelector('.ck-cell[data-z="' + cz + '"]');
            if (ccell && ccell !== cell) ccell.appendChild(el("span", { class: "ck-carspot" }, CAR));
          });
        }
        chickenEl.remove();
        if (cell) cell.appendChild(el("span", { class: "ck-splat" }, SPLAT));
        ended = true; enableLane(-1);
        BT.ui.haptic("error");
        await C.frame(820);
        finish(resp);
        return;
      }
      // Safe cross — land, tick the multiplier, maybe a cosmetic near-miss.
      crossed = l + 1;
      mult = typeof resp.multiplier === "number" ? resp.multiplier : mult;
      if (laneEl) {
        laneEl.classList.add("crossed");
        const badge = laneEl.querySelector(".ck-lane-mult");
        if (badge) { badge.textContent = mult.toFixed(2) + "\u00d7"; badge.classList.add("hit"); }
        if (Math.random() < 0.4) nearMiss(laneEl);
      }
      BT.ui.haptic("light");
      if (resp.done) { finish(resp); return; }
      curLane = l + 1;
      enableLane(curLane);
      syncCashout();
    }

    cashBtn.addEventListener("click", async () => {
      if (busy || ended || !roundId) return; busy = true; cashBtn.disabled = true;
      const resp = await BT.api.gameCashout("chicken", { round_id: roundId });
      busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); syncCashout(); return; }
      finish(resp);
    });

    function finish(resp) {
      ended = true; roundId = null; BT.clearActiveGame(); enableLane(-1);
      startBtn.style.display = "block"; cashBtn.style.display = "none"; cashBtn.disabled = false;
      bet.setDisabled(false); diffSel.disabled = false;
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { overlay.show("win", C.winMult(resp.multiplier, payout, stake), C.winLines(payout, stake)); BT.ui.haptic("success"); }
      else { overlay.show("lose", "0x", "Splat!"); BT.ui.haptic("error"); }
    }

    cols = DIFF[diffSel.value].C;
    laneCount = lanesFor(DIFF[diffSel.value].growth);
    diffSel.addEventListener("change", () => {
      if (!ended) return;
      cols = DIFF[diffSel.value].C;
      laneCount = lanesFor(DIFF[diffSel.value].growth);
      buildRoad();
    });
    buildRoad();
    root.appendChild(el("div", { class: "card" }, [
      C.gameHeader("chicken", "Chicken Cross", "Hop across the road lane by lane. Each lane hides cars in some zones — pick a safe zone to cross and grow your multiplier; hit a car and the run ends. Cash out any time after your first cross; the run auto-cashes at 20\u00d7."),
      el("div", { class: "field" }, [el("label", null, "Difficulty"), diffSel]),
      roadWrap,
      bet.node,
      startBtn,
      cashBtn,
      banner.node,
      seed.node,
    ]));
  }

  C.register({ key: "chicken", title: "Chicken Cross", render });
})();
