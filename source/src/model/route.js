import { localKm } from "../data/places.js";
import { COLS, CRATERS, ROWS, cellKm, cellCost, cellOf, elevationAt, hazardDistance, roughAt, slopeAt, SLOPE } from "./terrain.js";

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Least-cost path between two image-percent points; cost = ground distance × terrain cost.
export function findPath(t, from, to, mode) {
  const CELL_KM = cellKm();
  const s = cellOf(from), g = cellOf(to);
  const start = s.r * COLS + s.c, goal = g.r * COLS + g.c;
  const n = COLS * ROWS;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const h = (i) => Math.hypot(((i % COLS) - g.c) * CELL_KM.x, (Math.floor(i / COLS) - g.r) * CELL_KM.y);
  const near = (i) => Math.abs((i % COLS) - s.c) + Math.abs(Math.floor(i / COLS) - s.r) < 3 || Math.abs((i % COLS) - g.c) + Math.abs(Math.floor(i / COLS) - g.r) < 3;

  gScore[start] = 0;
  heap.push(start, h(start));
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % COLS, cr = Math.floor(cur / COLS);
    for (const [dx, dy] of DIRS) {
      const nc = cc + dx, nr = cr + dy;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const nb = nr * COLS + nc;
      if (closed[nb]) continue;
      let cost = cellCost(t, nb, mode);
      if (!Number.isFinite(cost)) { if (!near(nb)) continue; cost = 12; }
      const step = Math.hypot(dx * CELL_KM.x, dy * CELL_KM.y) * cost;
      const ng = gScore[cur] + step;
      if (ng < gScore[nb]) {
        gScore[nb] = ng;
        came[nb] = cur;
        heap.push(nb, ng + h(nb));
      }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;

  const cells = [];
  for (let i = goal; i !== -1; i = came[i]) { cells.push(i); if (i === start) break; }
  cells.reverse();
  const pts = cells.map((i) => ({ x: (((i % COLS) + 0.5) / COLS) * 100, y: ((Math.floor(i / COLS) + 0.5) / ROWS) * 100 }));
  pts[0] = { ...from };
  pts[pts.length - 1] = { ...to };
  return smooth(simplify(pts, 0.35));
}

// Route through every leg; returns geometry plus the numbers the planner and HUD need.
export function planLocalRoute(t, places, mode) {
  const legs = [];
  for (let i = 0; i < places.length - 1; i++) {
    const a = places[i].local, b = places[i + 1].local;
    const path = findPath(t, a, b, mode) ?? [a, b];
    const km = pathKm(path);
    legs.push({ from: places[i], to: places[i + 1], path, km, straightKm: localKm(a, b), segs: segmentsOf(t, path, km) });
  }
  const points = legs.flatMap((l, i) => (i ? l.path.slice(1) : l.path));
  const km = legs.reduce((s, l) => s + l.km, 0);
  const straightKm = legs.reduce((s, l) => s + l.straightKm, 0);

  const samples = resample(points, 120);
  const roughness = samples.map((p) => roughAt(t, p));
  const slopes = samples.map((p) => slopeAt(t, p));
  const roughShare = slopes.filter((s) => s >= SLOPE.hard).length / slopes.length;
  const elevations = smoothSeries(samples.map((p) => elevationAt(t, p)));
  let ascentM = 0, descentM = 0;
  for (let i = 1; i < elevations.length; i++) {
    const dz = elevations[i] - elevations[i - 1];
    if (dz > 0) ascentM += dz; else descentM -= dz;
  }
  const passed = t.hazards.map((hz) => {
    let min = Infinity, at = 0;
    samples.forEach((p, i) => { const d = hazardDistance(hz, p); if (d < min) { min = d; at = i / (samples.length - 1); } });
    return { hazard: hz, clearanceKm: min, at, inside: min < 0.1, nearby: min < 0.8 };
  });
  const craters = CRATERS.map((c) => {
    let min = Infinity;
    for (const p of samples) min = Math.min(min, localKm(p, c));
    const edgeM = min * 1000 - c.diameterM / 2;
    return { crater: c, edgeM: Math.round(edgeM), crosses: edgeM < 0 };
  }).filter((c) => c.edgeM < 200).sort((a, b) => a.edgeM - b.edgeM);
  return { legs, points, km, straightKm, samples, roughness, roughShare, slopes, elevations, ascentM, descentM, maxSlope: Math.max(...slopes), hazards: passed, craters };
}

export const CRATER_ZONE_M = 100; // a crater's zone reaches this far past its rim, where the raised rim and ejecta slope

// Route pieces of about 100 m with their grade and slope, for the pace and oxygen model.
function segmentsOf(t, path, km) {
  const n = Math.max(4, Math.round(km / 0.1));
  const pts = resample(path, n);
  const z = smoothSeries(pts.map((p) => elevationAt(t, p)));
  const segKm = km / n;
  return Array.from({ length: n }, (_, i) => ({
    km: segKm,
    grade: Math.max(-0.6, Math.min(0.6, (z[i + 1] - z[i]) / (segKm * 1000 || 1))),
    slope: slopeAt(t, pts[i]),
    crater: CRATERS.find((c) => localKm(pts[i], c) * 1000 < c.diameterM / 2 + CRATER_ZONE_M)?.id,
  }));
}

const smoothSeries = (v, k = 2) => v.map((_, i) => {
  const a = v.slice(Math.max(0, i - k), i + k + 1);
  return a.reduce((s, x) => s + x, 0) / a.length;
});

export function pathKm(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += localKm(path[i - 1], path[i]);
  return s;
}

// Evenly spaced points along a polyline (by ground distance).
export function resample(path, n) {
  const seg = [0];
  for (let i = 1; i < path.length; i++) seg.push(seg[i - 1] + localKm(path[i - 1], path[i]));
  const total = seg[seg.length - 1] || 1;
  const out = [];
  let j = 1;
  for (let k = 0; k <= n; k++) {
    const d = (total * k) / n;
    while (j < seg.length - 1 && seg[j] < d) j++;
    const a = path[j - 1], b = path[j] ?? a;
    const span = seg[j] - seg[j - 1] || 1;
    const u = Math.min(1, Math.max(0, (d - seg[j - 1]) / span));
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return out;
}

export function pointAt(path, frac) {
  const pts = resample(path, 400);
  const i = Math.min(pts.length - 1, Math.max(0, Math.round(frac * (pts.length - 1))));
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const heading = (Math.atan2((b.x - a.x) * 1, -(b.y - a.y)) * 180) / Math.PI;
  return { ...pts[i], heading: (heading + 360) % 360 };
}

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], pts[a], pts[b]);
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function segDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}

// Chaikin corner cutting, keeping the endpoints fixed.
function smooth(pts, rounds = 2) {
  let out = pts;
  for (let k = 0; k < rounds; k++) {
    if (out.length < 3) break;
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const k = this.k, p = this.p;
    let i = k.length;
    k.push(key); p.push(pri);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (p[up] <= p[i]) break;
      [k[up], k[i]] = [k[i], k[up]]; [p[up], p[i]] = [p[i], p[up]];
      i = up;
    }
  }
  pop() {
    const k = this.k, p = this.p;
    const top = k[0], lastK = k.pop(), lastP = p.pop();
    if (k.length) {
      k[0] = lastK; p[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}
