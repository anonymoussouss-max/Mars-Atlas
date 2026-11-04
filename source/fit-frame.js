// Fits image-% → DEM-pixel similarity from hand-picked control points, prints residuals,
// and writes a checkerboard of image vs. relief to verify it.
// Usage: node scripts/fit-frame.js <dem.tif> <image> <control.json> <out.json> <check.png>
import { fromFile } from "geotiff";
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const [demPath, imgPath, ctlPath, outJson, outPng] = process.argv.slice(2);
const pts = JSON.parse(readFileSync(ctlPath, "utf8")); // [{name, u, v, col, row}] u,v in image % (v scaled by aspect below)
const ASPECT = 4096 / 3879;

// Work in isotropic image units: U = u, V = v / ASPECT, so 1 unit is the same ground distance on both axes.
const P = pts.map((p) => ({ ...p, U: p.u, V: p.v / ASPECT }));
const n = P.length, mU = P.reduce((s, p) => s + p.U, 0) / n, mV = P.reduce((s, p) => s + p.V, 0) / n;
const mC = P.reduce((s, p) => s + p.col, 0) / n, mR = P.reduce((s, p) => s + p.row, 0) / n;
let num1 = 0, num2 = 0, den = 0;
for (const p of P) {
  const a = p.U - mU, b = p.V - mV, c = p.col - mC, d = p.row - mR;
  num1 += a * c + b * d; num2 += a * d - b * c; den += a * a + b * b;
}
const A = num1 / den, B = num2 / den; // col = A U - B V + tx, row = B U + A V + ty
const tx = mC - A * mU + B * mV, ty = mR - B * mU - A * mV;
const toDem = (u, v) => { const U = u, V = v / ASPECT; return { col: A * U - B * V + tx, row: B * U + A * V + ty }; };

const res = P.map((p) => { const q = toDem(p.u, p.v); return { name: p.name, errM: Math.round(Math.hypot(q.col - p.col, q.row - p.row) * 20) }; });
const scale = Math.hypot(A, B);
const out = { A, B, tx, ty, aspect: ASPECT, widthKm: (scale * 100 * 20) / 1000, rotationDeg: (Math.atan2(B, A) * 180) / Math.PI, rmsM: Math.round(Math.sqrt(res.reduce((s, r) => s + r.errM ** 2, 0) / n)) };
console.log(out); console.table(res);
writeFileSync(outJson, JSON.stringify(out, null, 1));

const dem = await (await fromFile(demPath)).getImage();
const W = 1400, H = Math.round(W / ASPECT);
const corners = [[0, 0], [100, 0], [0, 100], [100, 100]].map(([u, v]) => toDem(u, v));
console.log("corners col/row", corners.map((c) => [Math.round(c.col), Math.round(c.row)]));
const c0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.col))) - 2), c1 = Math.min(4456, Math.ceil(Math.max(...corners.map((c) => c.col))) + 2);
const r0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.row))) - 2), r1 = Math.min(5067, Math.ceil(Math.max(...corners.map((c) => c.row))) + 2);
const [z] = await dem.readRasters({ window: [c0, r0, c1, r1], samples: [0] });
const zw = c1 - c0;
const { data } = await sharp(imgPath).resize(W, H).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const buf = Buffer.from(data);
const tiles = 8;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if ((Math.floor((x * tiles) / W) + Math.floor((y * tiles) / H)) % 2 === 0) continue;
  const q = toDem((x / W) * 100, (y / H) * 100);
  const cc = Math.round(q.col) - c0, rr = Math.round(q.row) - r0;
  const i = rr * zw + cc;
  const dx = (z[i + 2] - z[i - 2]) / 80, dy = (z[i + 2 * zw] - z[i - 2 * zw]) / 80;
  const nn = Math.hypot(dx, dy, 1);
  const v = Math.max(0, Math.min(255, 110 + 500 * ((-dx * 0.7 + dy * 0.7) / nn))) || 0;
  const k = (y * W + x) * 3;
  buf[k] = buf[k + 1] = buf[k + 2] = v;
}
await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(outPng);

// Independent check: where the published Perseverance landing site falls.
const R = 3396190, stdLat = (18.4663 * Math.PI) / 180;
const geoToDem = (lat, lon) => ({ col: (R * Math.cos(stdLat) * (lon * Math.PI) / 180 - 4329000) / 20, row: (1143420 - (R * lat * Math.PI) / 180) / 20 });
const ls = geoToDem(18.4447, 77.4508);
const det = A * A + B * B, dc = ls.col - tx, dr = ls.row - ty;
const U = (A * dc + B * dr) / det, V = (-B * dc + A * dr) / det;
console.log("landing site: image %", U.toFixed(2), (V * ASPECT).toFixed(2), "DEM elevation m", z[Math.round(ls.row - r0) * zw + Math.round(ls.col - c0)]);
