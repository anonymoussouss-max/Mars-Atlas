// Improves the image-to-DEM alignment: matches each detected crater to the dark crater blob near it in the image,
// then refits the affine with outlier rejection. Half the pairs are held back to test it honestly.
// Usage: node scripts/refine-from-craters.js <image> <craters.raw.json> <frame-in.json> <frame-out.json>
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const [imgPath, rawPath, framePath, outPath] = process.argv.slice(2);
const F = JSON.parse(readFileSync(framePath, "utf8"));
const raw = JSON.parse(readFileSync(rawPath, "utf8"));
const IW = 4096, IH = 3879;
const { data } = await sharp(imgPath).greyscale().resize(IW, IH).raw().toBuffer({ resolveWithObject: true });
const mPerPxX = (F.kmPerPctU * 1000 * 100) / IW, mPerPxY = (F.kmPerPctV * 1000 * 100) / IH;

const pairs = [];
for (const c of raw) {
  if (c.diameterM > 700 || c.roundness < 0.68) continue;
  const cx = (c.u / 100) * IW, cy = (c.v / 100) * IH;
  const R = (c.diameterM / 2 + 300) / mPerPxX;
  const px = [];
  for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    if (x < 0 || y < 0 || x >= IW || y >= IH || (x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
    px.push([x, y, data[y * IW + x]]);
  }
  if (px.length < 50) continue;
  const vals = px.map((p) => p[2]).sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)], cut = vals[Math.floor(vals.length * 0.08)];
  if (median - cut < 15) continue; // no clear dark bowl here
  const dark = px.filter((p) => p[2] <= cut);
  const mx = dark.reduce((s, p) => s + p[0], 0) / dark.length, my = dark.reduce((s, p) => s + p[1], 0) / dark.length;
  const spread = Math.sqrt(dark.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / dark.length) * mPerPxX;
  if (spread > c.diameterM * 0.5 + 60) continue; // scattered dark ground, not one crater
  pairs.push({ u: (mx / IW) * 100, v: (my / IH) * 100, col: c.col, row: c.row });
}
console.log("usable crater pairs", pairs.length);

function solve3(M, y) {
  const A = M.map((r, i) => [...r, y[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]];
    for (let k = 0; k < 3; k++) if (k !== i) { const f = A[k][i] / A[i][i]; for (let j = i; j < 4; j++) A[k][j] -= f * A[i][j]; }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}
function fit(P) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], yc = [0, 0, 0], yr = [0, 0, 0];
  for (const p of P) { const v = [p.u, p.v, 1]; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[i][j] += v[i] * v[j]; yc[i] += v[i] * p.col; yr[i] += v[i] * p.row; } }
  return [...solve3(M, yc), ...solve3(M, yr)];
}
const err = (A, p) => Math.hypot(A[0] * p.u + A[1] * p.v + A[2] - p.col, A[3] * p.u + A[4] * p.v + A[5] - p.row) * 20;
const stat = (A, P) => { const e = P.map((p) => err(A, p)).sort((a, b) => a - b); return { median: Math.round(e[Math.floor(e.length / 2)]), rms: Math.round(Math.sqrt(e.reduce((s, v) => s + v * v, 0) / e.length)) }; };

// The 8 hand-matched points anchor the west and south, where floor craters are scarce.
const hand = JSON.parse(readFileSync("scripts/jezero-control-points.json", "utf8"));
const test = pairs.filter((_, i) => i % 2 === 0), train = [...pairs.filter((_, i) => i % 2 === 1), ...hand];
let inliers = train, A = fit(inliers);
for (let i = 0; i < 5; i++) { const e = train.map((p) => err(A, p)); const lim = Math.max(150, e.slice().sort((a, b) => a - b)[Math.floor(e.length * 0.8)]); inliers = train.filter((_, k) => e[k] <= lim); A = fit(inliers); }
console.log("HELD-OUT test craters: old frame", stat(F.affine, test), "new frame", stat(A, test), "| train inliers", inliers.length, "of", train.length);

// Final fit on everything, if the held-out test improved.
const everything = [...pairs, ...hand];
let all = everything, B = fit(all);
for (let i = 0; i < 5; i++) { const e = everything.map((p) => err(B, p)); const lim = Math.max(150, e.slice().sort((x, y) => x - y)[Math.floor(e.length * 0.8)]); all = everything.filter((_, k) => e[k] <= lim); B = fit(all); }
const widthKm = (Math.hypot(B[0], B[3]) * 100 * 20) / 1000, heightKm = (Math.hypot(B[1], B[4]) * 100 * 20) / 1000;
const improved = stat(A, test).median < stat(F.affine, test).median;
console.log({ improved, widthKm, heightKm, oldWidthKm: F.widthKm, oldHeightKm: F.heightKm, inliers: all.length, fitStats: stat(B, all) });
if (improved) writeFileSync(outPath, JSON.stringify({ ...F, affine: B, widthKm, heightKm, kmPerPctU: widthKm / 100, kmPerPctV: heightKm / 100, fitRmsM: stat(B, all).rms, leaveOneOutRmsM: stat(A, test).rms, heldOutMedianM: stat(A, test).median, craterPairs: all.length }, null, 1));
