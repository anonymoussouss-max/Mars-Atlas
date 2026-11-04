// Converts the source maps in scripts/source-images into web-ready WebP files in src/assets.
import sharp from "sharp";
import { statSync } from "node:fs";

const SRC = "scripts/source-images";
const OUT = "src/assets";
const jobs = [
  { in: "mars-viking.jpg", out: "mars-viking.webp", width: 4096, quality: 78 },
  { in: "mars-elevation.jpg", out: "mars-elevation.webp", width: 4096, quality: 80 },
  { in: "jezero-terrain.jpg", out: "jezero-terrain.webp", width: 4096, quality: 76 },
  { in: "mars-global.jpg", out: "mars-global.webp", width: 1024, quality: 78 },
  { in: "mars-viking.jpg", out: "mars-viking-thumb.webp", width: 512, quality: 70 },
];

for (const j of jobs) {
  await sharp(`${SRC}/${j.in}`).resize({ width: j.width, withoutEnlargement: true }).webp({ quality: j.quality, effort: 6 }).toFile(`${OUT}/${j.out}`);
  const kb = Math.round(statSync(`${OUT}/${j.out}`).size / 1024);
  const before = Math.round(statSync(`${SRC}/${j.in}`).size / 1024);
  console.log(`${j.out.padEnd(24)} ${String(kb).padStart(5)} KB  (source ${before} KB)`);
}

