// Bounded refinement of the fitted frame: maximizes edge correlation between image and DEM near the hand fit.
// Usage: node scripts/refine-frame.js <dem.tif> <image> <frame.json> <out.json>
import { fromFile } from "geotiff";
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const [demPath, imgPath, framePath, outJson] = process.argv.slice(2);
const F = JSON.parse(readFileSync(framePath, "utf8"));
const ASPECT = F.aspect, S = 2; // DEM read at 40 m/px
const dem = await (await fromFile(demPath)).getImage();
const c0 = 300, r0 = 1550, c1 = 2150, r1 = 3350;
const w = Math.floor((c1 - c0) / S), h = Math.floor((r1 - r0) / S);
const [z] = await dem.readRasters({ window: [c0, r0, c1, r1], width: w, height: h, resampleMethod: "bilinear", samples: [0] });
const blur = (a, W, H) => { const o = new Float32Array(a.length); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += a[(y + j) * W + x + i]; o[y * W + x] = s / 9; } return o; };
const edge = (a, W, H) => { const o = new Float32Array(a.length); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; o[i] = Math.log1p(Math.hypot(a[i + 1] - a[i - 1], a[i + W] - a[i - W])); } return o; };
const dz = blur(edge(z, w, h), w, h);

const IW = 760, IH = Math.round(IW / ASPECT);
const grey = Float32Array.from((await sharp(imgPath).greyscale().resize(IW, IH).raw().toBuffer()));
const ie = blur(edge(grey, IW, IH), IW, IH);
const pts = [];
for (let y = 6; y < IH - 6; y += 4) for (let x = 6; x < IW - 6; x += 4) pts.push([(x / IW) * 100, ((y / IH) * 100) / ASPECT, ie[y * IW + x]]);
const mean = pts.reduce((s, p) => s + p[2], 0) / pts.length;
const sd = Math.sqrt(pts.reduce((s, p) => s + (p[2] - mean) ** 2, 0) / pts.length);
for (const p of pts) p[2] = (p[2] - mean) / sd;

function score(scale, rotDeg, cc, cr) { // cc,cr = DEM position of image centre
  const t = (rotDeg * Math.PI) / 180, A = scale * Math.cos(t), B = scale * Math.sin(t);
  const U0 = 50, V0 = 50 / ASPECT;
  let sb = 0, sbb = 0, ab = 0, n = 0;
  for (const [U, V, a] of pts) {
    const dU = U - U0, dV = V - V0;
    const x = Math.round((cc + A * dU - B * dV - c0) / S), y = Math.round((cr + B * dU + A * dV - r0) / S);
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return -2;
    const b = dz[y * w + x];
    sb += b; sbb += b * b; ab += a * b; n++;
  }
  const v = sbb / n - (sb / n) ** 2;
  return v > 0 ? (ab / n) / Math.sqrt(v) : -2;
}

const s0 = Math.hypot(F.A, F.B), rot0 = F.rotationDeg;
const cc0 = F.A * 50 - F.B * (50 / ASPECT) + F.tx, cr0 = F.B * 50 + F.A * (50 / ASPECT) + F.ty;
let best = { r: -2 };
const hits = [];
for (let sc = s0 * 0.94; sc <= s0 * 1.06; sc += s0 * 0.004) for (let rd = rot0 - 2; rd <= rot0 + 2; rd += 0.5) for (let dc = -40; dc <= 40; dc += 2) for (let dr = -40; dr <= 40; dr += 2) {
  const r = score(sc, rd, cc0 + dc, cr0 + dr);
  if (r > best.r) best = { r, sc, rd, cc: cc0 + dc, cr: cr0 + dr };
  if (r > 0.3) hits.push(r);
}
const s = best.sc, t = (best.rd * Math.PI) / 180, A = s * Math.cos(t), B = s * Math.sin(t);
const tx = best.cc - A * 50 + B * (50 / ASPECT), ty = best.cr - B * 50 - A * (50 / ASPECT);
// Sharpness: how much the score drops 300 m away from the peak.
const off = [[15, 0], [-15, 0], [0, 15], [0, -15]].map(([a, b]) => score(s, best.rd, best.cc + a, best.cr + b));
const out = { A, B, tx, ty, aspect: ASPECT, widthKm: (s * 100 * 20) / 1000, rotationDeg: best.rd, ncc: +best.r.toFixed(4), handFitNcc: +score(s0, rot0, cc0, cr0).toFixed(4), scoresAt300m: off.map((v) => +v.toFixed(4)), shiftFromHandFitM: Math.round(Math.hypot(best.cc - cc0, best.cr - cr0) * 20) };
console.log(out);
writeFileSync(outJson, JSON.stringify(out, null, 1));
