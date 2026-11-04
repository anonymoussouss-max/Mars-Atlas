// Finds where the regional image sits on the georeferenced DEM by matching edge patterns
// across scale, rotation and offset. Usage: node scripts/align-image.js <dem.tif> <image> <out.json>
import { fromFile } from "geotiff";
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const [demPath, imgPath, outJson] = process.argv.slice(2);
const D2R = Math.PI / 180;

const tiff = await fromFile(demPath);
const dem = await tiff.getImage();
const DW = dem.getWidth(), DH = dem.getHeight();

async function demGrid(mPerPx) {
  const w = Math.floor((DW * 20) / mPerPx), h = Math.floor((DH * 20) / mPerPx);
  const [b] = await dem.readRasters({ width: w, height: h, resampleMethod: "bilinear", samples: [0] });
  const f = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) f[i] = b[i] > -20000 ? b[i] : NaN;
  return { w, h, f, m: mPerPx };
}
function edges({ w, h, f }) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const v = Math.hypot(f[i + 1] - f[i - 1], f[i + w] - f[i - w]);
    out[i] = Number.isFinite(v) ? Math.log1p(v) : 0;
  }
  return out;
}
async function imgGrey(width) {
  const { data, info } = await sharp(imgPath).greyscale().resize({ width }).raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, f: Float32Array.from(data) };
}
// Samples image points on a sparse lattice; maps each to DEM pixels for a candidate pose.
function lattice(g, e, step) {
  const pts = [];
  for (let y = 2; y < g.h - 2; y += step) for (let x = 2; x < g.w - 2; x += step) pts.push([x / g.w, y / g.h, e[y * g.w + x]]);
  const mean = pts.reduce((s, p) => s + p[2], 0) / pts.length;
  const sd = Math.sqrt(pts.reduce((s, p) => s + (p[2] - mean) ** 2, 0) / pts.length);
  return { pts: pts.map(([u, v, val]) => [u - 0.5, v - 0.5, (val - mean) / sd]), n: pts.length };
}
function ncc(demE, L, aspect, pose) {
  const { cx, cy, wPx, rot } = pose;
  const c = Math.cos(rot), s = Math.sin(rot), hPx = wPx / aspect;
  let sa = 0, sb = 0, sbb = 0, ab = 0, n = 0;
  for (const [u, v, a] of L.pts) {
    const X = u * wPx, Y = v * hPx;
    const x = Math.round(cx + c * X - s * Y), y = Math.round(cy + s * X + c * Y);
    if (x < 1 || y < 1 || x >= demE.w - 1 || y >= demE.h - 1) return -2;
    const b = demE.e[y * demE.w + x];
    sa += a; sb += b; sbb += b * b; ab += a * b; n++;
  }
  const varB = sbb / n - (sb / n) ** 2;
  return varB > 0 ? (ab / n - (sa / n) * (sb / n)) / Math.sqrt(varB) : -2;
}

const IMG_ASPECT = 4096 / 3879;
const ge = (g) => { const e = edges(g); return e; };
const coarse = await demGrid(320);
const demC = { w: coarse.w, h: coarse.h, e: ge(coarse) };
const gi = await imgGrey(200);
const imgE = edges({ ...gi });
const LC = lattice(gi, imgE, 2);
console.log("lattice points", LC.n, "dem", demC.w, demC.h);

let best = [];
const rots = [0, 90, 180, 270].flatMap((b) => [-12, -8, -4, 0, 4, 8, 12].map((d) => b + d));
for (const rd of rots) {
  for (let km = 20; km <= 89; km *= 1.05) {
    const wPx = (km * 1000) / coarse.m;
    for (let cy = 10; cy < demC.h - 10; cy += 3) for (let cx = 10; cx < demC.w - 10; cx += 3) {
      const r = ncc(demC, LC, IMG_ASPECT, { cx, cy, wPx, rot: rd * D2R });
      if (r > -1) best.push({ r, cx, cy, km, rd });
    }
    best.sort((a, b) => b.r - a.r); best = best.slice(0, 12);
  }
  console.log("rot", rd, "best so far", best[0].r.toFixed(3), best[0].km.toFixed(1), best[0].rd);
}
console.log("top candidates", best.slice(0, 6).map((b) => `${b.r.toFixed(3)} km=${b.km.toFixed(1)} rot=${b.rd}`));

// Refine the top candidate at 80 m/px.
const fine = await demGrid(80);
const demF = { w: fine.w, h: fine.h, e: ge(fine) };
const gf = await imgGrey(600);
const LF = lattice(gf, edges(gf), 3);
const k = coarse.m / fine.m;
let p = { cx: best[0].cx * k, cy: best[0].cy * k, wPx: (best[0].km * 1000) / fine.m, rot: best[0].rd * D2R };
let r = ncc(demF, LF, IMG_ASPECT, p);
for (const [dXY, dW, dR] of [[8, 0.02, 1], [4, 0.01, 0.5], [2, 0.005, 0.25], [1, 0.0025, 0.1]]) {
  for (let it = 0, improved = true; improved && it < 30; it++) {
    improved = false;
    for (const q of [
      { ...p, cx: p.cx + dXY }, { ...p, cx: p.cx - dXY }, { ...p, cy: p.cy + dXY }, { ...p, cy: p.cy - dXY },
      { ...p, wPx: p.wPx * (1 + dW) }, { ...p, wPx: p.wPx * (1 - dW) }, { ...p, rot: p.rot + dR * D2R }, { ...p, rot: p.rot - dR * D2R },
    ]) {
      const v = ncc(demF, LF, IMG_ASPECT, q);
      if (v > r) { r = v; p = q; improved = true; }
    }
  }
}
const result = { ncc: +r.toFixed(4), demCenterPx20m: [(p.cx * fine.m) / 20, (p.cy * fine.m) / 20], imageWidthKm: (p.wPx * fine.m) / 1000, imageHeightKm: (p.wPx * fine.m) / 1000 / IMG_ASPECT, rotationDeg: p.rot / D2R };
console.log(result);
writeFileSync(outJson, JSON.stringify(result, null, 1));
