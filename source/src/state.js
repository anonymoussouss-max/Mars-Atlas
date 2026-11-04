import { ALL_PLACES, LOCAL, localToGeo } from "./data/places.js";

export const STORAGE_KEY = "mars-atlas-missions";

export const state = {
  from: LOCAL[0],
  to: LOCAL[1],
  stops: [],
  mode: "walk",
  crew: 2,
  reserve: 30,
  activity: 0.43,
  date: "2040-03-15",
  round: false,
  hours: null,
  start: 8,
  dust: "clear",
  weather: "quiet",
  view: "global",
  zoom: 1,
  panX: 0,
  panY: 0,
  layer: "satellite",
  overlays: { trav: false, walkback: true, missions: false, craters: true, allRest: false },
  picking: null,
  activeTab: "planner",
};

export const isLocal = (p) => p.region === "jezero";
export const routePlaces = () => {
  const list = [state.from, ...state.stops.map((s) => s.place), state.to];
  return state.round ? [...list, state.from] : list;
};
export const routeScope = () => (routePlaces().every(isLocal) ? "local" : "global");

export const byId = (id) => ALL_PLACES.find((p) => p.id === id);

export function customLocal(x, y, name = "Custom waypoint") {
  return { id: `custom-${Date.now()}-${Math.round(Math.random() * 1e4)}`, name, subtitle: "Custom waypoint", type: "custom", region: "jezero", x, y, local: { x, y }, ...localToGeo({ x, y }) };
}
export function customGlobal(lat, lon, name = "Custom waypoint") {
  return { id: `custom-${Date.now()}-${Math.round(Math.random() * 1e4)}`, name, subtitle: "Custom waypoint", type: "custom", region: "global", lat, lon };
}

// Compact, URL-safe representation of a plan (for share links and saved missions).
const encodePlace = (p) => (p.id.startsWith("custom") ? (p.region === "jezero" ? { x: +p.x.toFixed(2), y: +p.y.toFixed(2), n: p.name } : { lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3), n: p.name }) : p.id);
const decodePlace = (v) => {
  if (typeof v === "string") return byId(v);
  if (v && Number.isFinite(v.x)) return customLocal(v.x, v.y, v.n);
  if (v && Number.isFinite(v.lat)) return customGlobal(v.lat, v.lon, v.n);
  return null;
};

export function serializePlan(s = state) {
  return {
    f: encodePlace(s.from), t: encodePlace(s.to), s: s.stops.map((x) => [encodePlace(x.place), x.dwell]),
    m: s.mode, c: s.crew, a: s.activity, dt: s.date, r: s.reserve, rt: s.round ? 1 : 0, h: s.hours, st: s.start, d: s.dust, w: s.weather,
  };
}

export function applyPlan(p) {
  const from = decodePlace(p.f), to = decodePlace(p.t);
  if (!from || !to) return false;
  Object.assign(state, {
    from, to,
    stops: (p.s || []).map(([pl, dwell]) => ({ place: decodePlace(pl), dwell: +dwell || 0.5 })).filter((x) => x.place),
    mode: p.m === "rover" ? "rover" : "walk",
    crew: Math.min(12, Math.max(1, +p.c || 2)),
    activity: { 0.35: 0.35, 0.43: 0.43, 0.5: 0.5, 0.7: 0.35, 1.2: 0.43, 1.8: 0.5 }[+p.a] ?? 0.43, // older links stored L/min
    reserve: Math.min(100, Math.max(10, +p.r || 30)),
    date: /^\d{4}-\d{2}-\d{2}$/.test(p.dt) ? p.dt : "2040-03-15",
    round: !!p.rt,
    hours: Number.isFinite(p.h) && p.h > 0 ? p.h : null,
    start: Math.min(20, Math.max(4, Number.isFinite(+p.st) ? +p.st : 8)),
    dust: ["clear", "hazy", "storm"].includes(p.d) ? p.d : "clear",
    weather: ["quiet", "elevated", "spe"].includes(p.w) ? p.w : "quiet",
  });
  return true;
}

export const toHash = () => "#plan=" + btoa(unescape(encodeURIComponent(JSON.stringify(serializePlan())))).replace(/=+$/, "");
export function fromHash(hash) {
  const m = /plan=([A-Za-z0-9+/_-]+)/.exec(hash);
  if (!m) return false;
  try { return applyPlan(JSON.parse(decodeURIComponent(escape(atob(m[1]))))); } catch { return false; }
}

export function loadSaved() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(list) ? list.filter((m) => m && typeof m.name === "string" && (m.plan || (m.from && m.to))) : [];
  } catch { return []; }
}

// Missions saved by the first version of Mars Atlas stored whole place objects.
export function planFromSaved(m) {
  if (m.plan) return m.plan;
  const legacy = (pl) => byId(pl.id) ? pl.id : { lat: pl.lat, lon: pl.lon, n: pl.name };
  return { f: legacy(m.from), t: legacy(m.to), s: [], m: m.mode, c: m.crew, a: m.activity, r: m.reserve, rt: m.round ? 1 : 0, h: m.hours };
}
