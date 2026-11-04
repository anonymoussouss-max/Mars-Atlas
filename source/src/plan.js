import { LOCAL, localKm } from "./data/places.js";
import { greatCircle, haversineKm } from "./lib/geo.js";
import { evaluateMission } from "./model/mission.js";
import { elevationAt, loadElevation } from "./model/elevation.js";
import { planLocalRoute, resample } from "./model/route.js";
import { loadTerrain, skyBlockedPctAt } from "./model/terrain.js";
import { routePlaces, routeScope, state } from "./state.js";
import elevationUrl from "./assets/mars-elevation.webp";

export const SURFACE_FACTOR = 1.18; // global routes: great-circle distance × allowance for real terrain

let terrain = null;
let elevation = null;
let cache = { key: "", route: null };
const listeners = new Set();
export const onAsyncData = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());

export const terrainReady = () => !!terrain;
export const getTerrain = () => terrain;

export function ensureTerrain() {
  if (!terrain) loadTerrain().then((t) => { terrain = t; cache.key = ""; notify(); }).catch((e) => console.error("Terrain unavailable", e));
}
function ensureElevation() {
  if (!elevation) loadElevation(elevationUrl).then((px) => { elevation = px; cache.key = ""; notify(); }).catch((e) => console.error("Elevation unavailable", e));
}

const keyOf = (places, mode) => places.map((p) => `${p.id}:${(p.x ?? p.lat)?.toFixed?.(3)}:${(p.y ?? p.lon)?.toFixed?.(3)}`).join("|") + mode + !!terrain + !!elevation;

// Builds the route for the current plan: a slope-aware grid path inside Jezero, great circles elsewhere.
export function currentRoute() {
  const places = routePlaces();
  const scope = routeScope();
  const key = keyOf(places, state.mode) + scope;
  if (cache.key === key) return cache.route;

  let route;
  if (scope === "local") {
    if (terrain) {
      route = { scope, ready: true, ...planLocalRoute(terrain, places, state.mode) };
    } else {
      ensureTerrain();
      const pts = places.map((p) => p.local);
      const km = pts.slice(1).reduce((s, p, i) => s + localKm(pts[i], p), 0);
      const legs = places.slice(1).map((p, i) => {
        const k = localKm(pts[i], pts[i + 1]);
        return { from: places[i], to: p, path: [pts[i], pts[i + 1]], km: k, straightKm: k, segs: [{ km: k, grade: 0, slope: 0, flat: true }] };
      });
      route = { scope, ready: false, points: pts, km, straightKm: km, legs, samples: resample(pts, 120), roughness: [], roughShare: 0, slopes: [], elevations: [], ascentM: 0, descentM: 0, maxSlope: 0, hazards: [] };
    }
    route.base = LOCAL[0];
    route.maxFromBaseKm = Math.max(...route.samples.map((p) => localKm(p, LOCAL[0].local)));
  } else {
    ensureElevation();
    const legs = [];
    for (let i = 0; i < places.length - 1; i++) {
      const a = places[i], b = places[i + 1];
      const k = haversineKm(a, b) * SURFACE_FACTOR;
      legs.push({ from: a, to: b, km: k, arc: greatCircle(a, b, 64), segs: [{ km: k, grade: 0, slope: 0, flat: true }] });
    }
    const arc = legs.flatMap((l, i) => (i ? l.arc.slice(1) : l.arc));
    const km = legs.reduce((s, l) => s + l.km, 0);
    const profile = elevation ? smooth(arc.map((p) => elevationAt(elevation, p))) : null;
    route = { scope, ready: true, legs, arc, km, straightKm: km / SURFACE_FACTOR, profile, maxFromBaseKm: null };
  }
  cache = { key, route };
  return route;
}

// Moving average: the color-ramp read-back is noisy point to point.
function smooth(v, k = 3) {
  return v.map((_, i) => {
    const a = v.slice(Math.max(0, i - k), i + k + 1);
    return a.reduce((s, x) => s + x, 0) / a.length;
  });
}

// Matches each planned rest to the nearest good rest spot, or the flattest nearby point on the route itself.
export function routeRestStops(route, mission) {
  if (!terrain || route.scope !== "local" || !route.ready || state.mode !== "walk") return [];
  const last = route.samples.length - 1;
  return mission.human.restAtKm.map((km, i) => {
    const idx = Math.min(last, Math.round((km / route.km) * last));
    const p = route.samples[idx];
    let spot = null, d = Infinity;
    for (const s of terrain.restSpots) { const k = localKm(p, s); if (k < d) { d = k; spot = s; } }
    if (spot && d <= 0.25) return { n: i + 1, km, spot, offRouteM: Math.round(d * 1000) };
    let flat = idx;
    for (let j = Math.max(0, idx - 3); j <= Math.min(last, idx + 3); j++) if (route.slopes[j] < route.slopes[flat]) flat = j;
    return { n: i + 1, km, offRouteM: 0, spot: { id: `route-${i}`, ...route.samples[flat], skyBlockedPct: skyBlockedPctAt(terrain, route.samples[flat]), slope: route.slopes[flat], elev: route.elevations[flat], onRoute: true } };
  });
}

export function currentMission(route = currentRoute()) {
  return evaluateMission({
    legs: route.legs,
    stops: state.stops,
    mode: state.mode,
    crew: state.crew,
    effort: state.activity,
    date: state.date,
    reserve: state.reserve,
    hoursOverride: state.hours,
    start: state.start,
    dust: state.dust,
    weather: state.weather,
    scope: route.scope,
    maxFromBaseKm: route.maxFromBaseKm,
    maxSlope: route.scope === "local" ? route.maxSlope : 0,
  });
}

// Clock times for each place on the route (arrive / leave), used by the briefing and HUD.
export function timeline(route, mission) {
  const places = routePlaces();
  const scale = state.hours ? state.hours / (mission.travelHours + mission.dwellHours || 1) : 1;
  let t = state.start;
  const rows = [{ place: places[0], arrive: null, leave: t, dwell: 0 }];
  route.legs.forEach((leg, i) => {
    t += mission.legHours[i] ?? 0;
    const stop = state.stops[i];
    const dwell = i < state.stops.length ? stop.dwell * scale : 0;
    rows.push({ place: places[i + 1], arrive: t, leave: t + dwell, dwell });
    t += dwell;
  });
  return rows;
}
