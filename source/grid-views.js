// Writes gridded views for picking control points: the regional image (grid in image %) and
// DEM relief (grid in DEM pixels). Usage: node scripts/grid-views.js <dem> <image> <outDir> [col0 row0 col1 row1]
import { fromFile } from "geotiff";
import sharp from "sharp";

const [demPath, imgPath, outDir, ...win] = process.argv.slice(2);
const [c0, r0, c1, r1] = win.length ? win.map(Number) : [0, 0, 4456, 5067];

const grid = (w, h, xs, ys) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${xs.map(([x, t]) => `<line x1="${x}" x2="${x}" y1="0" y2="${h}" stroke="#ff0" stroke-opacity=".55"/><text x="${x + 3}" y="14" font-size="14" font-family="Arial" fill="#ff0" stroke="#000" stroke-width=".4">${t}</text>`).join("")}${ys.map(([y, t]) => `<line y1="${y}" y2="${y}" x1="0" x2="${w}" stroke="#ff0" stroke-opacity=".55"/><text x="3" y="${y - 3}" font-size="14" font-family="Arial" fill="#ff0" stroke="#000" stroke-width=".4">${t}</text>`).join("")}</svg>`);

const W = 1000, H = Math.round((1000 * 3879) / 4096);
const xs = Array.from({ length: 9 }, (_, i) => [((i + 1) * W) / 10, `${(i + 1) * 10}`]);
const ys = Array.from({ length: 9 }, (_, i) => [((i + 1) * H) / 10, `${(i + 1) * 10}`]);
await sharp(imgPath).resize(W, H).composite([{ input: grid(W, H, xs, ys) }]).png().toFile(`${outDir}/grid-image.png`);

const img = await (await fromFile(demPath)).getImage();
const cw = c1 - c0, ch = r1 - r0;
const oW = 1000, oH = Math.round((oW * ch) / cw);
const [b] = await img.readRasters({ window: [c0, r0, c1, r1], width: oW, height: oH, resampleMethod: "bilinear", samples: [0] });
const cell = (cw * 20) / oW;
const out = Buffer.alloc(oW * oH);
for (let y = 1; y < oH - 1; y++) for (let x = 1; x < oW - 1; x++) {
  const i = y * oW + x;
  const dx = (b[i + 1] - b[i - 1]) / (2 * cell), dy = (b[i + oW] - b[i - oW]) / (2 * cell);
  const n = Math.hypot(dx, dy, 1);
  out[i] = Math.max(0, Math.min(255, 110 + 500 * ((-dx * 0.7 + dy * 0.7) / n)));
}
const step = cw > 2000 ? 500 : 250;
const dxs = [], dys = [];
for (let c = Math.ceil(c0 / step) * step; c < c1; c += step) dxs.push([((c - c0) / cw) * oW, c]);
for (let r = Math.ceil(r0 / step) * step; r < r1; r += step) dys.push([((r - r0) / ch) * oH, r]);
await sharp(out, { raw: { width: oW, height: oH, channels: 1 } }).composite([{ input: grid(oW, oH, dxs, dys) }]).png().toFile(`${outDir}/grid-dem.png`);
console.log("done", oW, oH);
