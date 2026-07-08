// Chicken Cross — hop across road lanes by tapping the next drain cover.
// Rainbet-style presentation: a dark top-down road, dashed lane dividers, one
// drain cover (manhole) per lane showing its multiplier. Tapping the next
// drain hops the chicken onto it; the SERVER decides safe/bust (the zone sent
// is a random pick — every zone has identical odds, the seeded car draw is
// what settles the outcome). All motion here is COSMETIC: on a bust a car
// zooms down the lane, the drain cover under the chicken drops away into a
// void and the chicken falls through. Ladder values are a PREVIEW from the
// published formula (0.96 * 25/(25-L), Rainbet-style easy ladder); the real
// payout is always the server's multiplier.
(function () {
  const BT = (window.BT = window.BT || {});
  const el = BT.ui.el;
  const C = BT.games.common;

  const EDGE = 0.04;     // CHICKEN_EDGE in api/game/chicken.py
  const TOTAL = 25;      // zone deck (one car, no replacement)
  const LANES = 24;      // road depth; final lane pays exactly 24.00x

  const laneMult = (L) => (1 - EDGE) * TOTAL / (TOTAL - Math.min(L, LANES));

  function render(root) {
    BT.ui.clear(root);
    const bet = C.betControl(10);
    let stake = 0;
    const seed = C.seedBox();
    const banner = C.resultBanner();
    let roundId = null, busy = false, ended = true;
    let curLane = 0, mult = 1.0, crossed = 0;

    const road = el("div", { class: "ck-road" });
    const roadWrap = el("div", { class: "ck-road-wrap" }, road);
    const overlay = C.resultOverlay(roadWrap);

    const chickenEl = el("img", { class: "ck-chicken", src: "img/ck-chicken.png", alt: "" });
    let kerbSpot = null;
    let chickenHome = null; // .ck-spot the chicken currently rests on

    const startBtn = el("button", { class: "btn primary block" }, "Place bet");
    const cashBtn = el("button", { class: "btn primary block ck-cash", style: "display:none" }, "Cash out");

    function syncButtons() {
      cashBtn.disabled = crossed < 1 || busy || ended;
      cashBtn.textContent = crossed >= 1 ? "Cash out \u00b7 " + mult.toFixed(2) + "\u00d7" : "Cash out";
    }

    function buildRoad() {
      BT.ui.clear(road);
      kerbSpot = el("div", { class: "ck-spot" });
      road.appendChild(el("div", { class: "ck-kerb" }, kerbSpot));
      for (let l = 0; l < LANES; l++) {
        const label = el("span", { class: "ck-drain-mult" }, laneMult(l + 1).toFixed(2) + "\u00d7");
        const cover = el("div", { class: "ck-drain-cover", dataset: { l: String(l) } }, label);
        cover.addEventListener("click", () => {
          if (parseInt(cover.dataset.l, 10) === curLane) cross();
        });
        const drain = el("div", { class: "ck-drain" }, [
          el("div", { class: "ck-drain-hole" }),
          cover,
          el("div", { class: "ck-spot" }),
        ]);
        road.appendChild(el("div", { class: "ck-lane dim", dataset: { l: String(l) } }, drain));
      }
      placeChicken(kerbSpot);
    }

    const laneEl = (l) => road.querySelector('.ck-lane[data-l="' + l + '"]');
    const spotOf = (lane) => lane && lane.querySelector(".ck-spot");

    function placeChicken(spot) {
      chickenHome = spot;
      chickenEl.classList.remove("hop", "drop"); void chickenEl.offsetWidth;
      spot.appendChild(chickenEl);
      chickenEl.classList.add("hop");
      const lane = spot.closest(".ck-lane, .ck-kerb");
      if (lane && lane.scrollIntoView) lane.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }

    // Highlight the next lane to cross, keep crossed lanes lit, dim the rest.
    function markLanes(next) {
      road.querySelectorAll(".ck-lane").forEach((ln) => {
        const cl = parseInt(ln.dataset.l, 10);
        ln.classList.toggle("active", cl === next);
        ln.classList.toggle("dim", next >= 0 ? cl > next : cl >= crossed);
      });
    }

    // A lane the chicken has left behind: swap the drain cover's label for a coin.
    function coinify(l) {
      const ln = laneEl(l);
      const cover = ln && ln.querySelector(".ck-drain-cover");
      if (!cover) return;
      BT.ui.clear(cover);
      cover.appendChild(el("img", { class: "ck-coin", src: "img/ck-coin.png", alt: "" }));
      ln.classList.add("crossed");
    }

    // Cosmetic bust beat: a car drops down the lane and brakes just above the
    // drain, then the cover falls into the void and the chicken drops through.
    async function bustAnim(l) {
      const ln = laneEl(l);
      if (!ln) return;
      ln.classList.add("bust");
      const car = el("img", { class: "ck-car", src: "img/ck-car.png", alt: "" });
      ln.appendChild(car);
      await C.frame(420);                       // car slides in
      const cover = ln.querySelector(".ck-drain-cover");
      if (cover) cover.classList.add("fall");   // drain cover drops away
      await C.frame(260);
      chickenEl.classList.remove("hop");
      chickenEl.classList.add("drop");          // chicken falls into the void
      BT.ui.haptic("error");
      await C.frame(700);
    }

    startBtn.addEventListener("click", async () => {
      if (busy) return; busy = true; startBtn.disabled = true;
      overlay.hide(); banner.hide(); seed.reset();
      curLane = 0; crossed = 0; mult = 1.0;
      buildRoad();
      stake = bet.getBet();
      const resp = await BT.api.gameBet("chicken", { bet: stake, params: { difficulty: "easy" } });
      startBtn.disabled = false; busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); return; }
      roundId = resp.round_id; ended = false;
      BT.setActiveGame("chicken", roundId);
      seed.setHash(resp.server_hash); seed.setNonce(resp.nonce); BT.fair.noteBet(resp);
      if (typeof resp.balance === "number") BT.setBalance(resp.balance);
      startBtn.style.display = "none";
      cashBtn.style.display = "block";
      bet.setDisabled(true);
      markLanes(0);
      syncButtons();
    });

    async function cross() {
      if (busy || ended || !roundId) return;
      busy = true; syncButtons();
      const l = curLane;
      const ln = laneEl(l);
      const prevHome = chickenHome;
      // Outcome-free motion: hop onto the next drain the instant of the tap and
      // hold a minimum motion window; the server response then decides whether
      // the chicken keeps standing (safe) or the cover gives way (bust).
      if (ln) placeChicken(spotOf(ln));
      const t0 = C.nowMs();
      const zone = Math.floor(Math.random() * (TOTAL - l)); // cosmetic — all zones equal odds
      const resp = await BT.api.gameStep("chicken", { round_id: roundId, move: { zone } });
      await C.hold(t0, 480);
      busy = false;
      if (!resp || resp.ok === false) {
        BT.ui.toast(C.errText(resp), "error");
        if (prevHome) placeChicken(prevHome);
        syncButtons();
        return;
      }
      const os = resp.outcome_step || {};
      const safe = os.safe !== undefined ? os.safe : !resp.busted;
      if (!safe) {
        ended = true; markLanes(-1);
        await bustAnim(l);
        finish(resp);
        return;
      }
      // Safe cross — the drain under the chicken holds; the one behind pays out.
      crossed = l + 1;
      mult = typeof resp.multiplier === "number" ? resp.multiplier : mult;
      if (l > 0) coinify(l - 1);
      road.querySelectorAll(".ck-lane.cur").forEach((x) => x.classList.remove("cur"));
      if (ln) ln.classList.add("held", "cur");
      BT.ui.haptic("light");
      if (resp.done) { coinify(l); finish(resp); return; }
      curLane = l + 1;
      markLanes(curLane);
      syncButtons();
    }

    cashBtn.addEventListener("click", async () => {
      if (busy || ended || !roundId) return; busy = true; syncButtons();
      const resp = await BT.api.gameCashout("chicken", { round_id: roundId });
      busy = false;
      if (!resp || resp.ok === false) { BT.ui.toast(C.errText(resp), "error"); syncButtons(); return; }
      finish(resp);
    });

    function finish(resp) {
      ended = true; roundId = null; BT.clearActiveGame(); markLanes(-1);
      road.querySelectorAll(".ck-lane.cur").forEach((x) => x.classList.remove("cur"));
      startBtn.style.display = "block";
      cashBtn.style.display = "none";
      bet.setDisabled(false);
      C.syncBalance(resp);
      const payout = resp.payout || 0;
      if (payout > 0) { overlay.show("win", C.winMult(resp.multiplier, payout, stake), C.winLines(payout, stake)); BT.ui.haptic("success"); }
      else { overlay.show("lose", "0x", "Run over!"); BT.ui.haptic("error"); }
    }

    buildRoad();
    root.appendChild(el("div", { class: "card" }, [
      C.gameHeader("chicken", "Chicken Cross", "Tap the next drain cover to send the chicken across the road one lane at a time. Every safe lane grows your multiplier — but each crossing risks a car. Get hit and the drain cover gives way. Cash out any time after your first cross; reach the far side for the full 24\u00d7."),
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
