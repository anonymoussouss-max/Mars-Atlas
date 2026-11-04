// Approximate elevation (km) read back from the colorized MOLA map: hue encodes height on the
// standard MOLA ramp (purple low → red high), and the near-white tones mark the highest volcano summits.
import { loadImage } from "./terrain.js";

const W = 1024, H = 512;
let pixelsPromise = null;

export function loadElevation(url) {
  pixelsPromise ??= (async () => {
    const img = await loadImage(url);
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.filter = "blur(2px)";
    ctx.drawImage(img, 0, 0, W, H);
    return ctx.getImageData(0, 0, W, H).data;
  })();
  return pixelsPromise;
}

// Hue (deg) → elevation (km) anchors, checked against Hellas, Jezero, the northern plains and Tharsis.
const HUE_RAMP = [
  [285, -8], [255, -6.5], [225, -5], [195, -3.8], [165, -2.8], [130, -1.5], [95, -0.2], [62, 1.2], [45, 2.5], [30, 4], [15, 6], [0, 8.5],
];

export function elevationAt(px, { lat, lon }) {
  const x = Math.min(W - 1, Math.max(0, Math.round(((lon + 180) / 360) * W)));
  const y = Math.min(H - 1, Math.max(0, Math.round(((90 - lat) / 180) * H)));
  const i = (y * W + x) * 4;
  const [h, s, v] = hsv(px[i], px[i + 1], px[i + 2]);
  if (s < 0.22 && v > 0.55) return 10 + (v - 0.55) * 26;
  let hue = h > 300 ? h - 360 : h;
  if (hue < 0) return 8.5 + Math.min(2, -hue / 20);
  for (let k = 0; k < HUE_RAMP.length - 1; k++) {
    const [h0, e0] = HUE_RAMP[k], [h1, e1] = HUE_RAMP[k + 1];
    if (hue <= h0 && hue >= h1) return e0 + ((hue - h0) / (h1 - h0)) * (e1 - e0);
  }
  return hue > HUE_RAMP[0][0] ? -8 : 8.5;
}

function hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}
