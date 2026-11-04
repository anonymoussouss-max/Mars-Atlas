// Detects bowl-shaped craters in the CTX DEM and measures diameter, depth and rim slope from the elevation.
// Writes src/data/craters.json and an overlay image for checking by eye.
// Usage: node scripts/find-craters.js <dem.tif> <image> <overlay.png>
import { fromFile } from "geotiff";
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const [demPath, imgPath, overlayPng] = process.argv.slice(2);
const F = JSON.parse(readFileSync("src/data/jezero-frame.json", "utf8"));
const [a, b, c, d, e, f] = F.affine, det = a * e - b * d;
const dem = await (await fromFile(demPath)).getImage();
const corners = [[0, 0], [100, 0], [0, 100], [100, 100]].map(([u, v]) => [a * u + b * v + c, d * u + e * v + f]);
const c0 = Math.floor(Math.min(...corners.map((p) => p[0]))) - 100, c1 = Math.ceil(Math.max(...corners.map((p) => p[0]))) + 100;
const r0 = Math.floor(Math.min(...corners.map((p) => p[1]))) - 100, r1 = Math.ceil(Math.max(...corners.map((p) => p[1]))) + 100;
const STEP = 2, M = 20 * STEP; // work at 40 m per cell
const W = Math.floor((c1 - c0) / STEP), H = Math.floor((r1 - r0) / STEP);
const [z] = await dem.readRasters({ window: [c0, r0, c1, r1], width: W, height: H, resampleMethod: "bilinear", samples: [0] });

const at = (x, y) => { const X = Math.round(x), Y = Math.round(y); return X < 0 || Y < 0 || X >= W || Y >= H ? NaN : z[Y * W + X]; };
const toImage = (x, y) => { const col = x * STEP + c0, row = y * STEP + r0; return { u: (e * (col - c) - b * (row - f)) / det, v: (-d * (col - c) + a * (row - f)) / det }; };

const AZ = 24, RADII = [];
for (let r = 100; r <= 1800; r *= 1.12) RADII.push(r);
const dirs = Array.from({ length: AZ }, (_, i) => [Math.cos((i / AZ) * 2 * Math.PI), Math.sin((i / AZ) * 2 * Math.PI)]);

function ringStats(x, y, rCells) {
  const vals = dirs.map(([dx, dy]) => at(x + dx * rCells, y + dy * rCells));
  return vals.some(Number.isNaN) ? null : vals;
}

// Rim crest on each of 36 rays: just past the steepest rise, where the climb levels off. Recentering on the circle
// through the crests makes the result independent of where the trace starts.
const RAYS = Array.from({ length: 36 }, (_, i) => [Math.cos((i / 36) * 2 * Math.PI), Math.sin((i / 36) * 2 * Math.PI)]);
const crests = (px, py) => RAYS.map(([dx, dy]) => {
  const p = [];
  for (let r = 0; r <= 25; r += 0.5) p.push(at(px + dx * r, py + dy * r));
  const s = p.map((_, i) => { const w = p.slice(Math.max(0, i - 1), i + 2); return w.reduce((t, x) => t + x, 0) / w.length; });
  let steep = 0, at0 = 1;
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > steep) { steep = s[i] - s[i - 1]; at0 = i; }
  let k = at0;
  while (k + 1 < s.length && s[k + 1] - s[k] > steep * 0.1) k++;
  return { r: k * 0.5, h: s[k], steep: steep / (0.5 * M) };
});
const trace = (x0, y0) => {
  let x1 = x0, y1 = y0, rs = crests(x1, y1);
  for (let n = 0; n < 8; n++) {
    const mean = rs.reduce((t, q) => t + q.r, 0) / 36;
    x1 += (2 / 36) * rs.reduce((t, q, i) => t + (q.r - mean) * RAYS[i][0], 0);
    y1 += (2 / 36) * rs.reduce((t, q, i) => t + (q.r - mean) * RAYS[i][1], 0);
    rs = crests(x1, y1);
  }
  const med = (v) => v.slice().sort((p, q) => p - q)[18];
  const floor = Math.min(...Array.from({ length: 49 }, (_, i) => at(x1 + (i % 7) - 3, y1 + Math.floor(i / 7) - 3)));
  return { x1, y1, rs, diameterM: 2 * med(rs.map((q) => q.r)) * M, depthM: med(rs.map((q) => q.h)) - floor, slopeDeg: med(rs.map((q) => (Math.atan(q.steep) * 180) / Math.PI)) };
};

// Candidate centers are local lows in the surface.
const cands = [];
for (let y = 3; y < H - 3; y += 1) for (let x = 3; x < W - 3; x += 1) {
  const v = z[y * W + x];
  let low = true;
  for (let j = -3; j <= 3 && low; j++) for (let i = -3; i <= 3; i++) if (z[(y + j) * W + x + i] < v) { low = false; break; }
  if (low) cands.push([x, y, v]);
}
console.log("candidate lows", cands.length);

const hits = [];
for (const [x, y, floor] of cands) {
  let best = null;
  for (const R of RADII) {
    const rc = R / M;
    const ring = ringStats(x, y, rc), outer = ringStats(x, y, rc * 1.5);
    if (!ring || !outer) continue;
    const mean = ring.reduce((s, v) => s + v, 0) / AZ;
    const depth = mean - floor;
    if (depth < 4 || depth / (2 * R) < 0.035 || depth / (2 * R) > 0.3) continue;
    const walls = ring.filter((v) => v - floor > depth * 0.45).length; // the wall must rise on nearly every side
    if (walls < AZ - 2) continue;
    const score = depth * (walls / AZ);
    if (!best || score > best.score) best = { score, R };
  }
  if (!best) continue;
  // Refine: on each ray take the rim as the highest point near the fitted radius.
  const rc = best.R / M, rims = [], slopes = [], rimHeights = [];
  // Average around the circle at each radius: noise cancels and a clean bowl profile remains.
  const stepR = 0.5, profile = [];
  for (let r = 0; r <= Math.max(rc * 1.6, 5); r += stepR) {
    const ring = ringStats(x, y, r);
    if (!ring) break;
    profile.push(ring.reduce((s, v) => s + v, 0) / AZ);
  }
  if (profile.length < 6) continue;
  let wall = 0, rimIdx = null;
  for (let i = 1; i < profile.length; i++) {
    const s = (profile[i] - profile[i - 1]) / (stepR * M);
    if (s > wall) wall = s;
    if (wall > 0.03 && s < wall * 0.25) { rimIdx = i; break; } // the wall has levelled off: that's the rim
  }
  if (rimIdx === null) continue;
  const rimCells = rimIdx * stepR;
  for (const [dx, dy] of dirs) {
    let top = -Infinity, topR = rimCells, steep = 0;
    for (let r = Math.max(1, rimCells * 0.7); r <= rimCells * 1.3; r += stepR) { const v = at(x + dx * r, y + dy * r); if (v > top) { top = v; topR = r; } }
    for (let r = 1; r <= topR; r += stepR) { const s = (at(x + dx * r, y + dy * r) - at(x + dx * (r - 1), y + dy * (r - 1))) / M; if (s > steep) steep = s; }
    if (!Number.isFinite(top)) continue;
    rims.push(topR); rimHeights.push(top - floor);
    slopes.push((Math.atan(steep) * 180) / Math.PI);
  }
  if (rims.length < AZ - 1) continue;
  const cv = Math.sqrt(rims.reduce((s, v) => s + (v - rimCells) ** 2, 0) / rims.length) / rimCells;
  if (cv > 0.3) continue; // not round
  const depth = rimHeights.reduce((s, v) => s + v, 0) / rimHeights.length, diameter = 2 * rimCells * M;
  if (depth < 4 || depth / diameter < 0.03) continue;
  // Walled on all sides: channels and valleys are open at the ends.
  if (rimHeights.filter((h) => h < depth * 0.45).length > 2) continue;
  if (diameter > 2500) continue; // nothing larger than this is a clean bowl inside the image
  const { u, v } = toImage(x, y);
  if (u < 2 || v < 2 || u > 98 || v > 98) continue;
  hits.push({ x, y, u, v, diameterM: diameter, depthM: depth, rimSlopeDeg: slopes.reduce((s, t) => s + t, 0) / slopes.length, roundness: 1 - cv, score: depth * (1 - cv), col: x * STEP + c0, row: y * STEP + r0 });
}

// Keep the strongest crater where detections overlap.
hits.sort((p, q) => q.score - p.score);
const kept = [];
for (const h of hits) if (!kept.some((k) => Math.hypot(k.x - h.x, k.y - h.y) * M < Math.max(k.diameterM, h.diameterM) * 0.6)) kept.push(h);
// Re-measure each detection with the rim trace. Keep the trace only when it stays on the same crater
// (center moves less than a radius, size within a factor of two); otherwise keep the profile measurement.
let retraced = 0;
const ratios = [];
const out = kept.filter((k) => k.diameterM >= 200).map((k, i) => {
  const t = trace(k.x, k.y);
  const moved = Math.hypot(t.x1 - k.x, t.y1 - k.y) * M, ratio = t.diameterM / k.diameterM;
  const ok = moved < k.diameterM / 2 && ratio > 0.5 && ratio < 2 && t.depthM > 2;
  if (ok) { retraced++; ratios.push(ratio); }
  const c = ok ? { ...toImage(t.x1, t.y1), d: t.diameterM, h: t.depthM, s: t.slopeDeg } : { u: k.u, v: k.v, d: k.diameterM, h: k.depthM, s: k.rimSlopeDeg };
  return { id: `c${i}`, x: +c.u.toFixed(2), y: +c.v.toFixed(2), diameterM: Math.round(c.d / 10) * 10, depthM: Math.round(c.h), rimSlopeDeg: Math.round(c.s), roundness: +k.roundness.toFixed(2), method: ok ? "rim trace" : "profile" };
});
ratios.sort((p, q) => p - q);
console.log(`rim trace kept for ${retraced} of ${out.length}; size change median x${ratios[ratios.length >> 1]?.toFixed(2)}, range x${ratios[0]?.toFixed(2)}-x${ratios[ratios.length - 1]?.toFixed(2)}`);

// Belva's rim is uneven on the delta, so the automatic test rejects it. Measure it directly from its known position,
// using the same averaged profile. Its published 900 m width is an independent check on the method.
{
  // Fixed DEM position of the crater's lowest point, independent of the image alignment.
  const measureAt = (px, py) => {
    const prof = [];
    for (let r = 0; r <= 25; r += 0.5) prof.push(ringStats(px, py, r).reduce((s, v) => s + v, 0) / AZ);
    let w = 0, k = prof.length - 1;
    for (let i = 1; i < prof.length; i++) { const s = (prof[i] - prof[i - 1]) / (0.5 * M); if (s > w) w = s; if (w > 0.03 && s < w * 0.25) { k = i; break; } }
    return { prof, wall: w, idx: k };
  };
  let sx = (1080 - c0) / STEP, sy = (2397 - r0) / STEP, low = Infinity, bx = sx, by = sy;
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { const v = at(sx + i, sy + j); if (v < low) { low = v; bx = sx + i; by = sy + j; } }
  const spread = [];
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) spread.push(measureAt(bx + i, by + j).idx * M);
  spread.sort((p, q) => p - q);
  console.log("Belva stability, center moved up to 80 m: diameter m min/median/max", spread[0], spread[12], spread[24]);
  // Trace the rim crest on each ray and recenter on the circle through them, so the result doesn't hang on one center.
  const RAYS = Array.from({ length: 36 }, (_, i) => [Math.cos((i / 36) * 2 * Math.PI), Math.sin((i / 36) * 2 * Math.PI)]);
  const crests = (px, py) => RAYS.map(([dx, dy]) => {
    const p = [];
    for (let r = 0; r <= 25; r += 0.5) p.push(at(px + dx * r, py + dy * r));
    const s = p.map((_, i) => { const w = p.slice(Math.max(0, i - 1), i + 2); return w.reduce((t, x) => t + x, 0) / w.length; });
    let steep = 0, at0 = 1;
    for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > steep) { steep = s[i] - s[i - 1]; at0 = i; }
    let k = at0;
    while (k + 1 < s.length && s[k + 1] - s[k] > steep * 0.1) k++;
    return { r: k * 0.5, h: s[k], steep: steep / (0.5 * M) };
  });
  const trace = (x0, y0) => {
    let x1 = x0, y1 = y0, rs = crests(x1, y1);
    for (let n = 0; n < 8; n++) {
      const mean = rs.reduce((t, q) => t + q.r, 0) / 36;
      x1 += (2 / 36) * rs.reduce((t, q, i) => t + (q.r - mean) * RAYS[i][0], 0);
      y1 += (2 / 36) * rs.reduce((t, q, i) => t + (q.r - mean) * RAYS[i][1], 0);
      rs = crests(x1, y1);
    }
    return { x1, y1, rs };
  };
  const { x1: cx, y1: cy, rs: rays } = trace(bx, by);
  const starts = [];
  for (let j = -4; j <= 4; j += 2) for (let i = -4; i <= 4; i += 2) starts.push(2 * trace(bx + i, by + j).rs.map((q) => q.r).sort((p, q) => p - q)[18] * M);
  starts.sort((p, q) => p - q);
  console.log("Belva rim trace from 25 starts up to 225 m apart: diameter min/median/max", starts[0], starts[12], starts[24]);
  const radii = rays.map((q) => q.r).sort((p, q) => p - q);
  const rimM = radii[18] * M, rangeM = [2 * radii[9] * M, 2 * radii[27] * M];
  const floor = Math.min(...Array.from({ length: 121 }, (_, i) => at(cx + (i % 11) - 5, cy + Math.floor(i / 11) - 5)));
  const heights = rays.map((q) => q.h).sort((p, q) => p - q), angles = rays.map((q) => (Math.atan(q.steep) * 180) / Math.PI).sort((p, q) => p - q);
  console.log("Belva rim trace: diameter", 2 * rimM, "m; middle half of rays", rangeM, "m");
  const { u, v } = toImage(cx, cy);
  const belva = { id: "belva", name: "Belva Crater", x: +u.toFixed(2), y: +v.toFixed(2), diameterM: Math.round((2 * rimM) / 10) * 10, depthM: Math.round(heights[18] - floor), rimSlopeDeg: Math.round(angles[18]), roundness: null };
  console.log("Belva measured directly:", belva, "published width 900 m");
  for (let i = out.length - 1; i >= 0; i--) if (Math.hypot((out[i].x - belva.x) * F.kmPerPctU, (out[i].y - belva.y) * F.kmPerPctV) * 1000 < belva.diameterM / 2) out.splice(i, 1);
  out.push(belva);
}
writeFileSync("src/data/craters.json", JSON.stringify(out));
writeFileSync(`${overlayPng}.raw.json`, JSON.stringify(kept.filter((k) => k.diameterM >= 200).map((k) => ({ u: k.u, v: k.v, col: k.col, row: k.row, diameterM: k.diameterM, roundness: k.roundness }))));
console.log("craters", out.length, "size classes", { under500: out.filter((k) => k.diameterM < 500).length, m500to1000: out.filter((k) => k.diameterM >= 500 && k.diameterM < 1000).length, over1000: out.filter((k) => k.diameterM >= 1000).length });
const belva = out.map((k) => ({ ...k, off: Math.hypot((k.x - 40.3) * F.kmPerPctU, (k.y - 46.4) * F.kmPerPctV) })).sort((p, q) => p.off - q.off)[0];
console.log("nearest to Belva (published 900 m):", belva);
console.log("largest", out.slice().sort((p, q) => q.diameterM - p.diameterM).slice(0, 6));

const OW = 1400, OH = Math.round(OW * 3879 / 4096);
const rings = out.map((k) => `<ellipse cx="${(k.x / 100) * OW}" cy="${(k.y / 100) * OH}" rx="${(k.diameterM / 2 / (F.kmPerPctU * 1000) / 100) * OW}" ry="${(k.diameterM / 2 / (F.kmPerPctV * 1000) / 100) * OH}" fill="none" stroke="#0ff" stroke-width="1.5"/>`).join("");
await sharp(imgPath).resize(OW, OH).composite([{ input: Buffer.from(`<svg width="${OW}" height="${OH}" xmlns="http://www.w3.org/2000/svg">${rings}</svg>`) }]).png().toFile(overlayPng);
