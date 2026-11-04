import { localKm } from "../data/places.js";
import { state } from "../state.js";

const W = 360, H = 54;

// Small route profile: ground roughness for Jezero routes, approximate MOLA elevation for global ones.
export function renderProfile(el, route) {
  if (route.scope === "local") {
    if (!route.ready) { el.innerHTML = `<p class="profile-empty">Reading the terrain to plan around steep ground…</p>`; return; }
    const v = route.elevations;
    const d = cumulative(route.samples);
    const lo = Math.min(...v), hi = Math.max(...v);
    el.innerHTML = chart({
      values: v, dist: d, min: lo - 8, max: Math.max(hi, lo + 30) + 8, gradient: false,
      title: "ELEVATION ALONG ROUTE (CTX)", note: `↑ ${Math.round(route.ascentM)} m · ↓ ${Math.round(route.descentM)} m · steepest ${Math.round(route.maxSlope)}°`,
      marks: stopMarks(route, d),
    });
    return;
  }
  if (!route.profile) { el.innerHTML = `<p class="profile-empty">Loading MOLA elevation…</p>`; return; }
  const v = route.profile;
  const total = route.km;
  const dist = v.map((_, i) => (total * i) / (v.length - 1));
  const lo = Math.min(...v), hi = Math.max(...v);
  el.innerHTML = chart({
    values: v, dist, min: Math.min(lo, -1) - 0.5, max: hi + 0.5, gradient: false,
    title: "ELEVATION ALONG ROUTE (MOLA, APPROX.)", note: `${lo.toFixed(1)} to ${hi.toFixed(1)} km · climb ${climb(v).toFixed(1)} km`,
    marks: [],
  });
}

function chart({ values, dist, min, max, gradient, title, note, marks }) {
  const total = dist[dist.length - 1] || 1;
  const X = (d) => (d / total) * W, Y = (v) => H - 4 - ((v - min) / (max - min || 1)) * (H - 10);
  const line = values.map((v, i) => `${i ? "L" : "M"}${X(dist[i]).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const area = `${line}L${W},${H}L0,${H}Z`;
  const fill = gradient ? "url(#pf-rough)" : "url(#pf-elev)";
  return `<div class="profile-head"><span>${title}</span><span>${note}</span></div>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${title}: ${note}">
    <defs>
      <linearGradient id="pf-rough" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#877fb1" stop-opacity=".55"/><stop offset=".55" stop-color="#8277b9" stop-opacity=".7"/><stop offset="1" stop-color="#d84288" stop-opacity=".85"/></linearGradient>
      <linearGradient id="pf-elev" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#766ab2" stop-opacity=".5"/><stop offset=".5" stop-color="#7b6fb5" stop-opacity=".6"/><stop offset="1" stop-color="#d24285" stop-opacity=".75"/></linearGradient>
    </defs>
    <path d="${area}" fill="${fill}"/><path d="${line}" fill="none" stroke="#4f496c" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
    ${marks.map((m) => `<line x1="${X(m.d)}" x2="${X(m.d)}" y1="0" y2="${H}" class="pf-mark"/><text x="${X(m.d) + 3}" y="9" class="pf-label">${m.label}</text>`).join("")}
  </svg>
  <div class="profile-axis"><span>0 km</span><span>${total.toFixed(1)} km</span></div>`;
}

function cumulative(pts) {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + localKm(pts[i - 1], pts[i]));
  return out;
}

function stopMarks(route, dist) {
  if (!state.stops.length || !route.legs.length) return [];
  let acc = 0;
  return state.stops.map((s, i) => {
    acc += route.legs[i].km;
    return { d: Math.min(dist[dist.length - 1], acc), label: String(i + 1) };
  });
}

const climb = (v) => v.slice(1).reduce((s, x, i) => s + Math.max(0, x - v[i]), 0);
