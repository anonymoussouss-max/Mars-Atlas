import { KM_PER_X, KM_PER_Y } from "../data/places.js";
import CRATERS from "../data/craters.json";

export { CRATERS };

// Terrain grid over the Jezero image, baked from the USGS CTX DEM mosaic (scripts/build-terrain.js).
// Slopes are measured at 20 m per pixel, then summarized per cell of about 95 m.
export let COLS = 320, ROWS = 323;
export const cellKm = () => ({ x: (100 / COLS) * KM_PER_X, y: (100 / ROWS) * KM_PER_Y });

// Planning limits on the 90th-percentile slope of a cell. Mission assumptions, not suit specifications.
export const SLOPE = { hard: 15, hazard: 20, noGoWalk: 30, noGoRover: 20 };

let terrainPromise = null;

export function loadTerrain() {
  terrainPromise ??= decode().then(build).catch((e) => { terrainPromise = null; throw e; });
  return terrainPromise;
}

async function decode() {
  const grid = await import("../data/terrain-grid.js");
  COLS = grid.COLS; ROWS = grid.ROWS;
  const bytes = Uint8Array.from(atob(grid.GRID_GZ_B64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// onload rather than img.decode(): decode() can stall while the page is in a background tab.
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

function build(raw) {
  const n = COLS * ROWS;
  const elev = new Int16Array(raw.buffer, raw.byteOffset, n);
  const mean = new Float32Array(n), p90 = new Float32Array(n), rough = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mean[i] = raw[n * 2 + i] / 4;
    p90[i] = raw[n * 3 + i] / 4;
    rough[i] = Math.min(1, p90[i] / 25);
  }
  const t = { elev, mean, p90, rough, hazards: [] };
  t.hazards = findHazards(t);
  t.restSpots = findRestSpots(t);
  return t;
}

// Share of the sky hidden by surrounding terrain, from horizon angles in 16 directions out to about 2.4 km.
function skyBlocked(t, c, r) {
  const z0 = t.elev[r * COLS + c], { x: kx, y: ky } = cellKm();
  let visible = 0;
  for (let a = 0; a < 16; a++) {
    const dx = Math.cos((a / 16) * 2 * Math.PI), dy = Math.sin((a / 16) * 2 * Math.PI);
    let tanMax = 0;
    for (let s = 2; s <= 25; s++) {
      const cc = Math.round(c + dx * s), rr = Math.round(r + dy * s);
      if (cc < 0 || rr < 0 || cc >= COLS || rr >= ROWS) break;
      const d = Math.hypot(dx * s * kx, dy * s * ky) * 1000;
      tanMax = Math.max(tanMax, (t.elev[rr * COLS + cc] - z0) / d);
    }
    visible += 1 / (1 + tanMax * tanMax); // cos² of the horizon angle
  }
  return 1 - visible / 16;
}

export const skyBlockedPctAt = (t, p) => Math.round(skyBlocked(t, Math.min(COLS - 1, Math.floor((p.x / 100) * COLS)), Math.min(ROWS - 1, Math.floor((p.y / 100) * ROWS))) * 100);

// Flat, open ground outside craters. In each 1.5 km square, keep the spot with the most sky blocked.
function findRestSpots(t) {
  const best = new Map();
  const tile = Math.round(1.5 / cellKm().x);
  for (let r = 3; r < ROWS - 3; r += 2) for (let c = 3; c < COLS - 3; c += 2) {
    let flat = true;
    for (let j = -2; j <= 2 && flat; j++) for (let i = -2; i <= 2; i++) if (t.p90[(r + j) * COLS + c + i] >= 7) { flat = false; break; }
    if (!flat || t.mean[r * COLS + c] >= 4) continue;
    const x = ((c + 0.5) / COLS) * 100, y = ((r + 0.5) / ROWS) * 100;
    if (CRATERS.some((k) => Math.hypot((x - k.x) * KM_PER_X, (y - k.y) * KM_PER_Y) * 1000 < k.diameterM / 2 + 100)) continue;
    const sky = skyBlocked(t, c, r), key = `${Math.floor(c / tile)}:${Math.floor(r / tile)}`;
    if (!best.has(key) || sky > best.get(key).sky) best.set(key, { id: `rest-${key}`, x, y, sky, slope: t.p90[r * COLS + c], elev: t.elev[r * COLS + c] });
  }
  return [...best.values()].map((s) => ({ ...s, skyBlockedPct: Math.round(s.sky * 100) }));
}

// Steep zones are connected areas of cells over the hazard limit. The largest get names on the map.
function findHazards(t) {
  const seen = new Uint8Array(COLS * ROWS), zones = [];
  for (let start = 0; start < COLS * ROWS; start++) {
    if (seen[start] || t.p90[start] < SLOPE.hazard) continue;
    const stack = [start], cells = [];
    seen[start] = 1;
    let peak = 0;
    while (stack.length) {
      const i = stack.pop(), c = i % COLS, r = Math.floor(i / COLS);
      cells.push(i);
      peak = Math.max(peak, t.p90[i]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dx, nr = r + dy;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const nb = nr * COLS + nc;
        if (!seen[nb] && t.p90[nb] >= SLOPE.hazard) { seen[nb] = 1; stack.push(nb); }
      }
    }
    if (cells.length >= 6) zones.push({ cells, peak });
  }
  zones.sort((a, b) => b.cells.length - a.cells.length);
  return zones.slice(0, 8).map((z, k) => {
    const pts = z.cells.map(centerOf);
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length, my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const label = pts.reduce((b, p) => (Math.hypot(p.x - mx, p.y - my) < Math.hypot(b.x - mx, b.y - my) ? p : b));
    const stride = Math.max(1, Math.ceil(pts.length / 500));
    const peak = Math.round(z.peak);
    return {
      id: `steep-${k}`, name: `Steep ground, up to ${peak}°`, peak, x: label.x, y: label.y, areaKm2: (z.cells.length * cellKm().x * cellKm().y),
      note: peak >= SLOPE.noGoWalk ? "Includes slopes past the walking limit. Routes go around them." : "Slow, tiring ground in a suit. Routes avoid it where they can.",
      cells: pts.filter((_, i) => i % stride === 0),
    };
  });
}

const centerOf = (i) => ({ x: (((i % COLS) + 0.5) / COLS) * 100, y: ((Math.floor(i / COLS) + 0.5) / ROWS) * 100 });

// Ground distance in km from a point to the nearest cell of a steep zone.
export function hazardDistance(hz, p) {
  let best = Infinity;
  for (const q of hz.cells) {
    const dx = (p.x - q.x) * KM_PER_X, dy = (p.y - q.y) * KM_PER_Y, d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Cost of crossing a cell. Grows with the square of slope, and rovers are less tolerant than walkers.
export function cellCost(t, i, mode) {
  const s90 = t.p90[i];
  if (s90 >= (mode === "rover" ? SLOPE.noGoRover : SLOPE.noGoWalk)) return Infinity;
  const ref = mode === "rover" ? 6 : 9;
  const over = Math.max(0, s90 - (mode === "rover" ? 10 : SLOPE.hard));
  return 1 + (t.mean[i] / ref) ** 2 + (s90 / (ref * 2)) ** 2 + (over / 2) ** 2;
}

export const cellOf = (p) => ({
  c: Math.min(COLS - 1, Math.max(0, Math.floor((p.x / 100) * COLS))),
  r: Math.min(ROWS - 1, Math.max(0, Math.floor((p.y / 100) * ROWS))),
});
const indexOf = (p) => { const { c, r } = cellOf(p); return r * COLS + c; };

export const roughAt = (t, p) => t.rough[indexOf(p)];
export const elevationAt = (t, p) => t.elev[indexOf(p)];
export const slopeAt = (t, p) => t.p90[indexOf(p)];

const mix = (a, b, u) => a.map((v, i) => Math.round(v + (b[i] - v) * u));

// Slope heatmap: green → amber → red.
export function paintTraversability(t, canvas) {
  canvas.width = COLS; canvas.height = ROWS;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(COLS, ROWS);
  for (let i = 0; i < COLS * ROWS; i++) {
    const v = t.rough[i];
    const [r, g, b] = v < 0.5 ? mix([116, 196, 118], [240, 197, 76], v * 2) : mix([240, 197, 76], [222, 72, 52], (v - 0.5) * 2);
    img.data.set([r, g, b, 25 + 200 * v ** 1.3], i * 4);
  }
  ctx.putImageData(img, 0, 0);
}

// Only the ground past the hazard and no-go limits, for the "Terrain hazards" filter.
export function paintHazards(t, canvas) {
  canvas.width = COLS; canvas.height = ROWS;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(COLS, ROWS);
  for (let i = 0; i < COLS * ROWS; i++) {
    const s = t.p90[i];
    if (s < SLOPE.hazard) continue;
    img.data.set(s >= SLOPE.noGoWalk ? [226, 62, 44, 235] : [240, 150, 60, 190], i * 4);
  }
  ctx.putImageData(img, 0, 0);
}
