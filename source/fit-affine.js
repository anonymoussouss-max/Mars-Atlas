// Least-squares affine fit: image % (u,v) → DEM pixel (col,row), with a leave-one-out error for honesty.
// Usage: node scripts/fit-affine.js <control.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";

const [ctl, out] = process.argv.slice(2);
const pts = JSON.parse(readFileSync(ctl, "utf8"));

function solve3(M, y) {
  const a = M.map((r, i) => [...r, y[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let k = i + 1; k < 3; k++) if (Math.abs(a[k][i]) > Math.abs(a[p][i])) p = k;
    [a[i], a[p]] = [a[p], a[i]];
    for (let k = i + 1; k < 3; k++) { const f = a[k][i] / a[i][i]; for (let j = i; j < 4; j++) a[k][j] -= f * a[i][j]; }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) { x[i] = (a[i][3] - a[i][i + 1 < 3 ? i + 1 : 0] * (i + 1 < 3 ? x[i + 1] : 0) - (i + 2 < 3 ? a[i][i + 2] * x[i + 2] : 0)) / a[i][i]; }
  return x;
}
function fit(P) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], yc = [0, 0, 0], yr = [0, 0, 0];
  for (const p of P) {
    const v = [p.u, p.v, 1];
    for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[i][j] += v[i] * v[j]; yc[i] += v[i] * p.col; yr[i] += v[i] * p.row; }
  }
  return [...solve3(M, yc), ...solve3(M, yr)];
}
const apply = (F, u, v) => ({ col: F[0] * u + F[1] * v + F[2], row: F[3] * u + F[4] * v + F[5] });
const errM = (F, p) => { const q = apply(F, p.u, p.v); return Math.hypot(q.col - p.col, q.row - p.row) * 20; };

const F = fit(pts);
const rows = pts.map((p) => ({ name: p.name, fitErrM: Math.round(errM(F, p)), leaveOneOutErrM: Math.round(errM(fit(pts.filter((q) => q !== p)), p)) }));
console.table(rows);
const rms = (k) => Math.round(Math.sqrt(rows.reduce((s, r) => s + r[k] ** 2, 0) / rows.length));
const widthKm = (Math.hypot(F[0], F[3]) * 100 * 20) / 1000, heightKm = (Math.hypot(F[1], F[4]) * 100 * 20) / 1000;
const result = { affine: F, widthKm, heightKm, kmPerPctU: widthKm / 100, kmPerPctV: heightKm / 100, fitRmsM: rms("fitErrM"), leaveOneOutRmsM: rms("leaveOneOutErrM") };
console.log(result);

// Independent check: the published landing site.
const R = 3396190, st = (18.4663 * Math.PI) / 180;
const col = (R * Math.cos(st) * (77.4508 * Math.PI) / 180 - 4329000) / 20, row = (1143420 - (R * 18.4447 * Math.PI) / 180) / 20;
const det = F[0] * F[4] - F[1] * F[3];
const u = (F[4] * (col - F[2]) - F[1] * (row - F[5])) / det, v = (-F[3] * (col - F[2]) + F[0] * (row - F[5])) / det;
console.log("landing site image %", u.toFixed(2), v.toFixed(2));
writeFileSync(out, JSON.stringify(result, null, 1));
