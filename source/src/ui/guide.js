// "Atlas", the astronaut guide. Route briefings and walk warnings come straight from the calculations, so they always
// work. Typed questions go to the AI through /api/guide, which may only explain those same calculated facts.
import { formatClock, formatHours, escapeHtml as A } from "../lib/geo.js";
import { routeRestStops } from "../plan.js";
import { state } from "../state.js";
import { $, icon, refreshIcons } from "./dom.js";

const API = import.meta.env.VITE_GUIDE_API || "https://mars-atlas-backend.vercel.app/api/chat";
let plan = () => null;
let lastKey = null;
let briefed = false;
let spoken = new Set();
let history = [];

const ASTRONAUT = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="13" y="42" width="38" height="20" rx="9" fill="#ddd9ed"/><rect x="25" y="46" width="14" height="9" rx="2" fill="#e54b93"/><circle cx="32" cy="26" r="21" fill="#efedf7"/><circle cx="32" cy="26" r="21" fill="none" stroke="#b9b5cb" stroke-width="2"/><rect x="16" y="15" width="32" height="23" rx="11" fill="#1a1536"/><path d="M21 22c3-3 7-4 11-4" stroke="#b2abd4" stroke-width="2.5" stroke-linecap="round" fill="none"/><circle cx="26" cy="27" r="2" fill="#8fddf0"/><circle cx="38" cy="27" r="2" fill="#8fddf0"/><path d="M28 32c2.4 1.6 5.6 1.6 8 0" stroke="#8fddf0" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`;

function add(text, who = "atlas", level = "") {
  const log = $("#guide-log");
  const row = document.createElement("div");
  row.className = `guide-msg ${who} ${level}`;
  row.textContent = text;
  log.append(row);
  log.scrollTop = log.scrollHeight;
  return row;
}
const setOpen = (open) => {
  $("#guide-panel").hidden = !open;
  $("#guide-button").setAttribute("aria-expanded", String(open));
  if (open) { $("#guide-badge").hidden = true; $("#guide-log").scrollTop = $("#guide-log").scrollHeight; }
};
const notifyClosed = () => { if ($("#guide-panel").hidden) $("#guide-badge").hidden = false; };

function facts(route, m) {
  const s = m.season;
  const f = {
    from: state.from.name, to: state.to.name, stops: state.stops.map((x) => x.place.name), travelMode: state.mode, crew: state.crew,
    missionDate: state.date, marsSeason: s.season, solarLongitudeDeg: Math.round(s.ls),
    distanceKm: +route.km.toFixed(1), duration: formatHours(m.hours), goNoGo: m.status,
    oxygenBaseLiters: Math.ceil(m.o2.base), oxygenReserveLiters: Math.ceil(m.o2.extra), oxygenTotalLitersReserveAlreadyIncluded: Math.ceil(m.o2.total),
    reservePercentChosen: state.reserve, reservePercentRecommended: m.human.recommendedReserve,
    radiationEstimateMsv: +m.radiation.dose.toFixed(3), radiationPotentialMsv: +m.radiation.potential.toFixed(1),
    airTempRangeC: [Math.round(m.temps.min), Math.round(m.temps.max)], sunset: formatClock(m.daylight.sunset), backBeforeSunset: formatHours(Math.max(0, m.daylight.sunsetMargin)),
    checks: m.checks.map((c) => `${c.level}: ${c.text}`),
    answerRule: "Quote these numbers exactly. Never add, multiply or otherwise calculate new numbers from them. The total oxygen already includes the reserve.",
    dataNote: "Seasonal weather and radiation are estimates, not forecasts. Fatigue and stress use assumptions. Hazards only include slope; rocks and sand are not mapped.",
  };
  if (route.scope === "local" && route.ready) Object.assign(f, { climbM: Math.round(route.ascentM), descentM: Math.round(route.descentM), steepestDeg: Math.round(route.maxSlope), restStops: m.human.rests, averagePaceKmh: +m.human.avgKmh.toFixed(1), walkBackRadiusKm: +m.o2.walkBackKm.toFixed(1),
    cratersNearRoute: (route.craters ?? []).slice(0, 6).map((k) => ({ name: k.crater.name ?? "unnamed", diameterM: k.crater.diameterM, depthM: k.crater.depthM, wallSlopeDeg: k.crater.rimSlopeDeg, routeCrossesIt: k.crosses, metersFromRim: Math.max(0, k.edgeM), oxygenLitersOnThisCraterStretch: Math.ceil(m.o2.craters?.find((o) => o.id === k.crater.id)?.liters ?? 0) })),
    oxygenThroughCratersLiters: Math.ceil(m.o2.craterLiters ?? 0), oxygenElsewhereLiters: Math.ceil(m.o2.otherLiters ?? m.o2.base),
    airOverheadGramsPerCm2: +(m.radiation.columnGcm2 ?? 0).toFixed(1), extraDoseVsGaleFromThinnerAirPercent: +(m.radiation.thinAirExtraPct ?? 0).toFixed(1),
    restStops: routeRestStops(route, m).map((s) => ({ atKm: +s.km.toFixed(1), groundSlopeDeg: Math.round(s.spot.slope), metersOffRoute: s.offRouteM, skyBlockedPercent: s.spot.skyBlockedPct, note: "Not shelter. A solar storm needs the habitat or a rover." })) });
  return f;
}

// Spoken as soon as a route is chosen. Built from the calculations only.
function briefing(route, m) {
  const parts = [`${state.from.name} to ${state.to.name}: ${route.km.toFixed(1)} km, about ${formatHours(m.hours)}. Status: ${{ go: "GO", caution: "CAUTION", nogo: "NO-GO" }[m.status]}.`];
  if (route.scope === "local" && route.ready) parts.push(`Terrain: ${Math.round(route.ascentM)} m of climbing, steepest ground ${Math.round(route.maxSlope)}°.`);
  const near = route.craters ?? [], stops = routeRestStops(route, m);
  if (near.length) { const k = near[0]; parts.push(`Craters: ${near.length} on or near the route. Closest: ${k.crater.name ?? "a crater"} ${k.crater.diameterM} m wide, ${k.crater.depthM} m deep, ${k.crosses ? "and the route crosses it" : `${k.edgeM} m from its rim`}.`); }
  if (stops.length) parts.push(`Rest stops: ${stops.length}, first at ${stops[0].km.toFixed(1)} km. They're marked on the map.`);
  parts.push(`Oxygen: take ${Math.ceil(m.o2.total).toLocaleString()} L.${m.human.spread ? ` I'd carry at least a ${m.human.recommendedReserve}% reserve; you have ${state.reserve}%.` : ""}`);
  parts.push(`Radiation: about ${m.radiation.dose.toFixed(m.radiation.dose < 1 ? 2 : 1)} mSv, possibly up to ${m.radiation.potential.toFixed(1)} mSv if a major solar storm hits. This is an estimate.`);
  parts.push(`Weather: ${m.season.season.toLowerCase()}, ${Math.round(m.temps.min)} to ${Math.round(m.temps.max)} °C, sunset near ${formatClock(m.daylight.sunset)}. This is an estimate, not a forecast.`);
  return parts.join("\n");
}

export function guideRouteUpdate(route, m) {
  const key = [state.from.id, state.to.id, state.stops.map((s) => s.place.id).join(), state.mode, state.date, route.ready].join("|");
  if (key === lastKey) return;
  lastKey = key;
  spoken = new Set();
  if (route.scope === "local" && !route.ready) return;
  add(briefing(route, m));
  const warning = m.checks.find((c) => c.level === "nogo") ?? m.checks.find((c) => c.level === "caution");
  if (warning) add(warning.text, "atlas", "warn");
  if (briefed) setOpen(true); else notifyClosed(); // don't cover the map on first load
  briefed = true;
}

// Warnings during the walk-through. Each is spoken once per route.
export function guideWalkEvent(id, text, level = "") {
  if (spoken.has(id)) return;
  spoken.add(id);
  add(text, "atlas", level);
  setOpen(true);
}

async function ask(question) {
  add(question, "you");
  const wait = add("Checking the numbers…", "atlas", "thinking");
  const { route, mission } = plan();
  try {
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, facts: facts(route, mission), history: history.slice(-6) }) });
    const data = await res.json();
    if (!res.ok || !data.reply) throw new Error(data.error || `HTTP ${res.status}`);
    wait.className = "guide-msg atlas";
    wait.textContent = data.reply;
    history.push({ role: "user", content: question }, { role: "assistant", content: data.reply });
  } catch {
    wait.className = "guide-msg atlas warn";
    wait.textContent = "My AI link is offline, so I can't answer typed questions right now. The briefing and walk warnings still work, because they come straight from the calculations.";
  }
  $("#guide-log").scrollTop = $("#guide-log").scrollHeight;
}

export function initGuide(getPlan) {
  plan = getPlan;
  const box = document.createElement("div");
  box.className = "guide";
  box.innerHTML = `<div class="guide-panel" id="guide-panel" role="dialog" aria-label="Atlas, your astronaut guide" hidden>
    <div class="guide-head"><span class="guide-face">${ASTRONAUT}</span><div><b>Atlas</b><small>Your Marswalk guide</small></div><button id="guide-close" aria-label="Close guide">${icon("x")}</button></div>
    <div class="guide-log" id="guide-log" aria-live="polite"></div>
    <form class="guide-form" id="guide-form"><input id="guide-input" maxlength="300" placeholder="Ask Atlas about this route" aria-label="Ask Atlas about this route" autocomplete="off"><button aria-label="Send">${icon("arrow-up-right")}</button></form>
    <p class="guide-note">Estimates only, not for real mission planning. AI answers can be wrong.</p>
  </div>
  <button class="guide-button" id="guide-button" aria-label="Open Atlas, your astronaut guide" aria-expanded="false" aria-controls="guide-panel">${ASTRONAUT}<span class="guide-badge" id="guide-badge" hidden></span></button>`;
  $("#map").append(box);
  refreshIcons();
  $("#guide-button").onclick = () => setOpen($("#guide-panel").hidden);
  $("#guide-close").onclick = () => setOpen(false);
  $("#guide-form").onsubmit = (e) => {
    e.preventDefault();
    const q = $("#guide-input").value.trim();
    if (!q) return;
    $("#guide-input").value = "";
    ask(q);
  };
}
