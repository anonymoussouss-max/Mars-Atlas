// Prints a DEM's georeferencing and elevation stats, and writes a shaded-relief preview.
// Usage: node scripts/inspect-dem.js <dem.tif> <preview.png>
import { fromFile } from "geotiff";
import sharp from "sharp";

const [demPath, outPng] = process.argv.slice(2);
const tiff = await fromFile(demPath);
const img = await tiff.getImage();
const W = img.getWidth(), H = img.getHeight();
console.log({ W, H, bands: img.getSamplesPerPixel(), origin: img.getOrigin(), resolution: img.getResolution(), bbox: img.getBoundingBox(), nodata: img.getGDALNoData() });
const geo = img.getGeoKeys();
console.log(geo);
const f = img.getFileDirectory();
if (f.GeoAsciiParams) console.log(f.GeoAsciiParams);

const step = 8, w = Math.floor(W / step), h = Math.floor(H / step);
const [band] = await img.readRasters({ width: w, height: h, resampleMethod: "bilinear", samples: [0] });
const nod = img.getGDALNoData();
const valid = (v) => Number.isFinite(v) && v !== nod && v > -20000 && v < 30000;
const vals = Array.from(band).filter(valid).sort((a, b) => a - b);
const q = (p) => vals[Math.floor(p * (vals.length - 1))];
console.log({ validShare: +(vals.length / band.length).toFixed(3), min: q(0), p5: q(0.05), median: q(0.5), p95: q(0.95), max: q(1) });

const cell = Math.abs(img.getResolution()[0]) * step;
const out = Buffer.alloc(w * h);
for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
  const i = y * w + x;
  const a = band[i - 1], b = band[i + 1], c = band[i - w], d = band[i + w];
  if (![a, b, c, d].every(valid)) continue;
  const dx = (b - a) / (2 * cell), dy = (d - c) / (2 * cell);
  const n = Math.hypot(dx, dy, 1);
  out[i] = Math.max(0, Math.min(255, 255 * (0.35 + 0.65 * ((-dx * 0.6 + dy * 0.6 + 0.53) / n))));
}
await sharp(out, { raw: { width: w, height: h, channels: 1 } }).png().toFile(outPng);
console.log("preview", outPng, w, h);
