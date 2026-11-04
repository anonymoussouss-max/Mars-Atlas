// Side-by-side check: regional image (left) vs DEM relief warped into image space (right), same crosshairs.
// Usage: node scripts/check-frame.js <dem> <image> <frame.json> <out.png> u0 v0 u1 v1 [u,v ...crosshairs]
import { fromFile } from "geotiff";
import sharp from "sharp";
import { readFileSync } from "node:fs";

const [demPath, imgPath, framePath, outPng, u0, v0, u1, v1, ...marks] = process.argv.slice(2);
const F = JSON.parse(readFileSync(framePath, "utf8"));
const [U0, V0, U1, V1] = [u0, v0, u1, v1].map(Number);
F.aspect ??= 4096 / 3879;
const toDem = F.affine
  ? (u, v) => ({ col: F.affine[0] * u + F.affine[1] * v + F.affine[2], row: F.affine[3] * u + F.affine[4] * v + F.affine[5] })
  : (u, v) => ({ col: F.A * u - F.B * (v / F.aspect) + F.tx, row: F.B * u + F.A * (v / F.aspect) + F.ty });
const dem = await (await fromFile(demPath)).getImage();
const [z] = await dem.readRasters({ window: [300, 1550, 2200, 3350], samples: [0] });
const zw = 1900;
const OW = 720, OH = Math.round((OW * (V1 - V0)) / F.aspect / (U1 - U0));
const meta = await sharp(imgPath).metadata();
const left = await sharp(imgPath).extract({ left: Math.round((U0 / 100) * meta.width), top: Math.round((V0 / 100) * meta.height), width: Math.round(((U1 - U0) / 100) * meta.width), height: Math.round(((V1 - V0) / 100) * meta.height) }).resize(OW, OH, { fit: "fill" }).removeAlpha().raw().toBuffer();
const right = Buffer.alloc(OW * OH * 3);
for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
  const q = toDem(U0 + ((U1 - U0) * x) / OW, V0 + ((V1 - V0) * y) / OH);
  const fc = q.col - 300, fr = q.row - 1550, c = Math.floor(fc), r = Math.floor(fr), a = fc - c, b = fr - r;
  const at = (cc, rr) => { const i = rr * zw + cc; return (1 - a) * (1 - b) * z[i] + a * (1 - b) * z[i + 1] + (1 - a) * b * z[i + zw] + a * b * z[i + zw + 1]; };
  const dx = (at(c + 2, r) - at(c - 2, r)) / 80, dy = (at(c, r + 2) - at(c, r - 2)) / 80;
  const n = Math.hypot(dx, dy, 1);
  const v = Math.max(0, Math.min(255, 110 + 700 * ((-dx * 0.7 + dy * 0.7) / n))) || 0;
  const k = (y * OW + x) * 3; right[k] = right[k + 1] = right[k + 2] = v;
}
const cross = marks.map((m) => m.split(",").map(Number)).map(([u, v], i) => {
  const x = ((u - U0) / (U1 - U0)) * OW, y = ((v - V0) / (V1 - V0)) * OH;
  return `<path d="M${x - 14} ${y}H${x + 14}M${x} ${y - 14}V${y + 14}" stroke="#0ff" stroke-width="1.5"/><text x="${x + 6}" y="${y - 6}" fill="#0ff" font-size="15" font-family="Arial">${i + 1}</text>`;
}).join("");
const svg = Buffer.from(`<svg width="${OW}" height="${OH}" xmlns="http://www.w3.org/2000/svg">${cross}</svg>`);
const L = await sharp(left, { raw: { width: OW, height: OH, channels: 3 } }).composite([{ input: svg }]).png().toBuffer();
const R = await sharp(right, { raw: { width: OW, height: OH, channels: 3 } }).composite([{ input: svg }]).png().toBuffer();
await sharp({ create: { width: OW * 2 + 10, height: OH, channels: 3, background: "#000" } }).composite([{ input: L, left: 0, top: 0 }, { input: R, left: OW + 10, top: 0 }]).png().toFile(outPng);
