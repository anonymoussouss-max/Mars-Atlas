export const MARS_RADIUS_KM = 3389.5;
export const SOL_HOURS = 24.6597;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return MARS_RADIUS_KM * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

// Points along the great circle from a to b (n segments).
export function greatCircle(a, b, n = 64) {
  const v = (p) => [Math.cos(rad(p.lat)) * Math.cos(rad(p.lon)), Math.cos(rad(p.lat)) * Math.sin(rad(p.lon)), Math.sin(rad(p.lat))];
  const p = v(a), q = v(b);
  const dot = Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
  const ang = Math.acos(dot);
  if (ang < 1e-10) return [a, b];
  let k = q.map((c, i) => c - dot * p[i]);
  let len = Math.hypot(...k);
  if (len < 1e-10) {
    const axis = Math.abs(p[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const d = p.reduce((s, c, i) => s + c * axis[i], 0);
    k = axis.map((c, i) => c - d * p[i]);
    len = Math.hypot(...k);
  }
  k = k.map((c) => c / len);
  return Array.from({ length: n + 1 }, (_, i) => {
    if (i === 0) return a;
    if (i === n) return b;
    const t = (ang * i) / n;
    const w = p.map((c, j) => c * Math.cos(t) + k[j] * Math.sin(t));
    return { lat: deg(Math.atan2(w[2], Math.hypot(w[0], w[1]))), lon: deg(Math.atan2(w[1], w[0])) };
  });
}

// Equirectangular global map: percent of the map's width/height.
export const geoToGlobalPct = ({ lat, lon }) => ({ x: (lon + 180) / 3.6, y: (90 - lat) / 1.8 });
export const globalPctToGeo = ({ x, y }) => ({ lat: 90 - y * 1.8, lon: x * 3.6 - 180 });

export function formatCoords({ lat, lon }, digits = 3) {
  return `${Math.abs(lat).toFixed(digits)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(digits)}° ${lon < 0 ? "W" : "E"}`;
}

export function formatHours(h) {
  const m = Math.max(0, Math.round(h * 60));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function formatClock(h) {
  const t = ((h % 24) + 24) % 24;
  const m = Math.round(t * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
