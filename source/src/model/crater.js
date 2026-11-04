// Oxygen to get past one crater, from its measured geometry: walk straight across the bowl, or around the rim.
// O₂ (L) = metabolic power (W) × time (s) ÷ 21,000 J per litre of O₂ (NASA: 4.039 + 1.157 × RQ 0.85 ≈ 5.02 kcal/L).
import { BODY_KG, FATIGUE, STANDING_VO2, VO2MAX, paceFor, walkVO2 } from "./physiology.js";
import { SLOPE } from "./terrain.js";

export const J_PER_L = 21000;
const MARGIN_M = 50; // start and end this far outside the rim
export const wattsOf = (vo2) => ((vo2 * BODY_KG) / 1000 / 60) * J_PER_L; // ml/kg/min → watts

// One walker over pieces of { m, grade }, starting at the given fatigue. Same pace and fatigue rules as the route model.
function walk(pieces, target, fatigue) {
  let liters = 0, hours = 0, peakW = 0;
  for (const p of pieces) {
    if (p.m <= 0) continue;
    const v = paceFor(target / (1 + fatigue), p.grade), dt = p.m / 1000 / v;
    const vo2 = Math.max(STANDING_VO2, walkVO2(v, p.grade)) * (1 + fatigue);
    liters += (wattsOf(vo2) * dt * 3600) / J_PER_L;
    hours += dt;
    peakW = Math.max(peakW, wattsOf(vo2));
    fatigue += FATIGUE.driftPerHour * dt;
  }
  return { liters, hours, peakW };
}

// Bowl crossing: down the wall at the rim slope, across the floor, up the far wall.
function crossPieces(d, h, deg) {
  const g = Math.tan((deg * Math.PI) / 180);
  const run = Math.min(d / 2 * 0.95, h / g);
  return [{ m: MARGIN_M, grade: 0 }, { m: run, grade: -h / run }, { m: d - 2 * run, grade: 0 }, { m: run, grade: h / run }, { m: MARGIN_M, grade: 0 }];
}
const aroundPieces = (d) => [{ m: Math.PI * (d / 2 + MARGIN_M), grade: 0 }];

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

// 300 runs with measurement error (diameter ±5%, depth ±15%, wall ±3°) and person-to-person differences (±10%).
// Returns crew litres at the 5th, 50th and 95th percentile for each option.
export function craterOxygen(c, { effort, crew, fatigue = 0 }) {
  const rand = rng(4242), gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const target = effort * VO2MAX;
  const runs = { cross: [], around: [] };
  for (let r = 0; r < 300; r++) {
    const d = c.diameterM * (1 + 0.05 * gauss()), h = Math.max(1, c.depthM * (1 + 0.15 * gauss()));
    const deg = Math.min(40, Math.max(2, c.rimSlopeDeg + 3 * gauss()));
    let cross = 0, around = 0;
    for (let k = 0; k < crew; k++) {
      const person = Math.exp(0.1 * gauss());
      cross += walk(crossPieces(d, h, deg), target, fatigue).liters * person;
      around += walk(aroundPieces(d), target, fatigue).liters * person;
    }
    runs.cross.push(cross); runs.around.push(around);
  }
  const q = (v) => { v.sort((a, b) => a - b); return { p5: v[15], p50: v[150], p95: v[284] }; };
  const crossNominal = walk(crossPieces(c.diameterM, c.depthM, c.rimSlopeDeg), target, fatigue);
  const aroundNominal = walk(aroundPieces(c.diameterM), target, fatigue);
  const straightM = c.diameterM + 2 * MARGIN_M;
  return {
    cross: { ...q(runs.cross), km: straightM / 1000, hours: crossNominal.hours, climbM: c.depthM, peakW: crossNominal.peakW,
      allowed: c.rimSlopeDeg < SLOPE.noGoWalk, hazard: c.rimSlopeDeg >= SLOPE.hazard },
    around: { ...q(runs.around), km: aroundPieces(c.diameterM)[0].m / 1000, hours: aroundNominal.hours, peakW: aroundNominal.peakW },
    detourKm: (aroundPieces(c.diameterM)[0].m - straightM) / 1000,
  };
}

// Spread of a crew's litres when people differ by about 10%.
export function crewBounds(litersPerPerson, crew) {
  const rand = rng(99), gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const v = Array.from({ length: 300 }, () => Array.from({ length: crew }, () => litersPerPerson * Math.exp(0.1 * gauss())).reduce((s, x) => s + x, 0)).sort((a, b) => a - b);
  return { p5: v[15], p95: v[284] };
}
