// Suited human model: how slope sets pace, how pace and fatigue set oxygen use.
// Sourced: NASA "Mars Spacesuit Mass Requirements" (Ogilvie et al., ICES-2026-127): 19 ml/kg/min at 2.2 mph in Mars
// gravity, VO2max reached near 3.5 mph, 36 ml/kg/min VO2max flight rule, 35-50% sustained limits, 1.7 mph for walks over
// an hour, 82 kg average crew, 104 kg suit, 50 lbm carry. ACSM walking equation for the grade term.
// Assumptions (no validated source found): fatigue drift, rest schedule and recovery, stress episodes, person spread.

export const BODY_KG = 82;
export const VO2MAX = 36; // ml/kg/min, NASA minimum flight rule for EVA
const REST_VO2 = 3.5;
const G_RATIO = ((BODY_KG + 104 + 23) * 3.71) / (BODY_KG * 9.81); // suit + carry on Mars, relative to body weight on Earth

export const WALK_CAP_KMH = 2.74; // 1.7 mph, Apollo assumption for walks over an hour
export const WALKBACK_KMH = 3.54; // 2.2 mph, walks under an hour
export const WALKBACK_VO2 = 19;
const SCIENCE_VO2 = 10.2; // 1000 BTU/hr, ISS EVA average, for 82 kg
export const STANDING_VO2 = 5; // assumption
const ROVER_KMH = 15; // assumption
const ROVER_VO2 = 7; // assumption

export const FATIGUE = { driftPerHour: 0.05, restEveryHours: 1, restMinutes: 10, recovery: 0.3 };
export const EXPEDITION = { driveHoursPerSol: 8, o2KgPerPersonSol: 0.84, litersPerKg: 700 };

// Level walking curve through three anchors: rest 3.5; 19 at 3.54 km/h; 36 at 5.63 km/h.
const A = 2.02, B = 0.667;
function gradeFactor(grade) {
  if (grade >= 0) return grade;
  const down = -grade;
  return down <= 0.1 ? -0.3 * down : -0.03 + 0.5 * (down - 0.1); // gentle descents help, steep ones cost braking effort
}
const gradeTerm = (grade) => 1.8 * (1000 / 60) * gradeFactor(grade) * G_RATIO; // per km/h

export const walkVO2 = (v, grade) => REST_VO2 + A * v + B * v * v + gradeTerm(grade) * v;

// Fastest pace that stays at or under the target oxygen rate.
export function paceFor(target, grade) {
  const b = A + gradeTerm(grade), c = REST_VO2 - target;
  const disc = b * b - 4 * B * c;
  const v = disc <= 0 ? 0 : (-b + Math.sqrt(disc)) / (2 * B);
  return Math.min(WALK_CAP_KMH, Math.max(0.5, v));
}

const toLiters = (vo2, hours) => (vo2 * BODY_KG * 60 * hours) / 1000;

// One person's trip along the route. effort = target share of VO2max.
export function simulateTrip(legs, stops, mode, effort) {
  const target = effort * VO2MAX;
  let moving = 0, resting = 0, dwelling = 0, liters = 0, fatigue = 0, sinceRest = 0, rests = 0, peak = 0, peakFatigue = 0, stressBase = 0;
  const legHours = [], restAtKm = [];
  let traveled = 0;
  // Oxygen spent on route pieces inside each crater's zone, for the crater / non-crater split.
  const crater = {};
  const addCrater = (s, l, dt) => {
    if (!s.crater) return;
    const k = (crater[s.crater] ??= { liters: 0, km: 0, hours: 0, ascentM: 0, descentM: 0, maxGrade: 0 });
    const dz = s.grade * s.km * 1000;
    k.liters += l; k.km += s.km; k.hours += dt;
    if (dz > 0) k.ascentM += dz; else k.descentM -= dz;
    k.maxGrade = Math.max(k.maxGrade, Math.abs(s.grade));
  };
  legs.forEach((leg, i) => {
    let legTime = 0;
    for (const s of leg.segs) {
      if (s.flat) {
        const dt = s.km / (mode === "rover" ? ROVER_KMH : WALK_CAP_KMH), vo2 = mode === "rover" ? ROVER_VO2 : walkVO2(WALK_CAP_KMH, 0);
        moving += dt; legTime += dt; liters += toLiters(vo2, dt);
        peak = Math.max(peak, vo2 / VO2MAX);
        continue;
      }
      if (mode === "rover") {
        const v = ROVER_KMH * Math.max(0.25, 1 - s.slope / 25), dt = s.km / v;
        moving += dt; legTime += dt; liters += toLiters(ROVER_VO2, dt);
        addCrater(s, toLiters(ROVER_VO2, dt), dt);
        peak = Math.max(peak, ROVER_VO2 / VO2MAX);
        continue;
      }
      const v = paceFor(target / (1 + fatigue), s.grade), dt = s.km / v;
      const vo2 = Math.max(STANDING_VO2, walkVO2(v, s.grade)) * (1 + fatigue);
      liters += toLiters(vo2, dt);
      addCrater(s, toLiters(vo2, dt), dt);
      moving += dt; legTime += dt; sinceRest += dt; traveled += s.km;
      peak = Math.max(peak, vo2 / VO2MAX);
      fatigue += FATIGUE.driftPerHour * dt;
      peakFatigue = Math.max(peakFatigue, fatigue);
      if (sinceRest >= FATIGUE.restEveryHours) {
        const r = FATIGUE.restMinutes / 60;
        liters += toLiters(STANDING_VO2, r);
        resting += r; legTime += r; rests++; restAtKm.push(traveled);
        fatigue *= 1 - FATIGUE.recovery;
        sinceRest = 0;
      }
    }
    legHours.push(legTime);
    if (i < stops.length) {
      dwelling += stops[i].dwell;
      liters += toLiters(SCIENCE_VO2, stops[i].dwell);
    }
  });
  stressBase = moving + resting + dwelling;
  return { moving, resting, dwelling, hours: stressBase, liters, rests, restAtKm, legHours, peakEffort: peak, peakFatigue, avgKmh: 0, crater };
}

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Same plan walked many times with stress episodes and person-to-person differences. Fixed seed keeps results stable.
export function simulateSpread(nominalLiters, hours, crew, reservedTotal, runs = 400) {
  const rand = rng(1793);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const ratePerHour = hours > 0 ? nominalLiters / hours : 0;
  const totals = [];
  for (let r = 0; r < runs; r++) {
    let total = 0;
    for (let c = 0; c < crew; c++) {
      let liters = nominalLiters * Math.exp(0.1 * gauss());
      liters *= 1 + ((0.03 + 0.05 * rand() - FATIGUE.driftPerHour) * hours) / 2;
      let t = 0;
      for (;;) {
        t += -Math.log(1 - rand()) / 0.5; // about one stress episode per 2 hours
        if (t >= hours) break;
        const minutes = 5 + 10 * rand(), extra = 0.2 + 0.4 * rand();
        liters += ((ratePerHour * minutes) / 60) * extra;
      }
      total += liters;
    }
    totals.push(total);
  }
  totals.sort((a, b) => a - b);
  const q = (p) => totals[Math.min(totals.length - 1, Math.floor(p * totals.length))];
  return { p50: q(0.5), p95: q(0.95), worst: totals[totals.length - 1], coverage: totals.filter((v) => v <= reservedTotal).length / totals.length };
}

// Oxygen the whole crew needs to walk a given distance home.
export function walkBackLiters(km, crew) {
  const hours = km <= WALKBACK_KMH ? km / WALKBACK_KMH : 1 + (km - WALKBACK_KMH) / WALK_CAP_KMH;
  return toLiters(WALKBACK_VO2, hours) * crew;
}

// Distance the crew could walk home on reserve oxygen, using NASA's walk-back pace and rate.
export function walkBackKm(reserveLiters, crew) {
  const hours = reserveLiters / crew / toLiters(WALKBACK_VO2, 1);
  return hours <= 1 ? hours * WALKBACK_KMH : WALKBACK_KMH + (hours - 1) * WALK_CAP_KMH;
}
