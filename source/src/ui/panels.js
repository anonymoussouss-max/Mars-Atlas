import { GLOBAL, KM_PER_X, KM_PER_Y, LOCAL, MISSIONS, SOURCES, JEZERO } from "../data/places.js";
import { escapeHtml as A, formatClock, formatCoords, formatHours } from "../lib/geo.js";
import { CAREER_LIMIT_MSV, EVA_LIMIT_H } from "../model/mission.js";
import { craterOxygen } from "../model/crater.js";
import { CRATER_ZONE_M } from "../model/route.js";
import { SURFACE_FACTOR, routeRestStops, timeline } from "../plan.js";
import { STORAGE_KEY, applyPlan, isLocal, loadSaved, planFromSaved, routePlaces, serializePlan, state, toHash } from "../state.js";
import { $, $$, closeDialog, icon, openDialog, refreshIcons, toast } from "./dom.js";
import jezeroUrl from "../assets/jezero-terrain.webp";

let hooks = {};
export const initPanels = (h) => { hooks = h; };

const statusLabel = { go: "GO", caution: "CAUTION", nogo: "NO-GO" };

// ---------- Place card with a synthetic ground-level approach view ----------
export function openPlace(place) {
  const local = isLocal(place);
  const photo = local
    ? `<div class="place-photo" style="background-position:${place.local.x}% ${place.local.y}%"></div>`
    : `<div class="place-photo global-photo" style="background-position:${((place.lon + 180) / 360) * 100}% ${((90 - place.lat) / 180) * 100}%"></div>`;
  const ground = local ? groundView(place) : "";
  const canStop = state.from.id !== place.id && state.to.id !== place.id && !state.stops.some((s) => s.place.id === place.id) && state.stops.length < 4;
  openDialog(A(place.name), `
    <p class="dialog-coords">${formatCoords(place)}${place.subtitle ? ` · ${A(place.subtitle)}` : ""}</p>
    ${ground || photo}
    <p>${A(place.description || "A custom waypoint selected on the surface map.")}</p>
    ${place.science ? `<p class="science-note">${icon("flask-conical")}<span><b>Science goal.</b> ${A(place.science)}</span></p>` : ""}
    <div class="dialog-actions">
      <button class="secondary" id="use-start">${icon("locate-fixed")}Set as start</button>
      ${canStop ? `<button class="secondary" id="use-stop">${icon("circle-plus")}Add as stop</button>` : ""}
      <button class="primary" id="use-destination">Set destination ${icon("arrow-right")}</button>
    </div>`);
  $("#use-start").onclick = () => { hooks.setPlace("from", place); closeDialog(); };
  $("#use-destination").onclick = () => { hooks.setPlace("to", place); closeDialog(); };
  if (canStop) $("#use-stop").onclick = () => { hooks.addStop(place); closeDialog(); };
}

function groundView(place) {
  const prev = routePlaces().find((p) => p.id !== place.id && isLocal(p)) ?? LOCAL[0];
  const from = prev.id === place.id ? LOCAL[0] : prev;
  const dx = (place.local.x - from.local.x) * KM_PER_X, dy = (place.local.y - from.local.y) * KM_PER_Y;
  const heading = Math.hypot(dx, dy) > 0.01 ? (Math.atan2(dx, -dy) * 180) / Math.PI : 0;
  const S = 12000, plane = 6000;
  const bx = plane / 2 - (S * place.local.x) / 100, by = plane / 2 - ((S / JEZERO.aspect) * place.local.y) / 100;
  const dir = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((heading % 360) + 360) % 360) / 45) % 8];
  return `<div class="ground-view" role="img" aria-label="Synthetic approach view toward ${A(place.name)}, heading ${dir}">
    <div class="gv-sky"></div>
    <div class="gv-plane" style="background-image:url(${jezeroUrl});background-size:${S}px ${S / JEZERO.aspect}px;background-position:${bx}px ${by}px;transform:rotateX(76deg) rotateZ(${-heading}deg)"></div>
    <div class="gv-haze"></div>
    <span class="gv-target">${icon("flag")}${A(place.name)}</span>
    <span class="gv-label">APPROACH VIEW · HEADING ${dir} · SYNTHETIC, FROM ORBITAL IMAGERY</span>
  </div>`;
}

export function openCrater(c, onRoute, routeO2) {
  const status = !onRoute ? "It isn't near your current route." : onRoute.crosses ? "Your current route crosses it." : `Your current route passes about ${onRoute.edgeM} m from its rim.`;
  const o = craterOxygen(c, { effort: state.activity, crew: state.crew });
  const L = (v) => Math.round(v).toLocaleString();
  const cheaper = !o.cross.allowed ? "around" : o.cross.p50 <= o.around.p50 ? "cross" : "around";
  const opt = (name, k, extra) => `<div><small>${name}</small><strong>${L(k.p50)} L</strong><span class="fine">${L(k.p5)}–${L(k.p95)} L · ${k.km.toFixed(2)} km · ${formatHours(k.hours)}${extra}</span></div>`;
  openDialog(A(c.name ?? "Crater"), `<p class="dialog-coords">Measured from NASA CTX elevation data${c.method ? ` (${c.method})` : ""}</p>
    <div class="detail-grid"><div><small>DIAMETER</small><strong>${c.diameterM} m</strong></div><div><small>DEPTH</small><strong>${c.depthM} m</strong></div><div><small>STEEPEST WALL (AVERAGE)</small><strong>${c.rimSlopeDeg}°</strong></div><div><small>DEPTH ÷ DIAMETER</small><strong>${(c.depthM / c.diameterM).toFixed(2)}</strong></div></div>
    <p>${status} Measurements use 20 m elevation data, so true wall slopes can be steeper than shown.</p>
    <h4>Oxygen to get past it · ${state.crew} crew</h4>
    <div class="detail-grid">
      ${opt("STRAIGHT ACROSS THE BOWL", o.cross, ` · ${c.depthM} m down and up${o.cross.allowed ? "" : " · <b>no-go, wall over 30°</b>"}`)}
      ${opt("AROUND THE RIM", o.around, ` · ${Math.round(o.detourKm * 1000)} m farther`)}
    </div>
    <p>${cheaper === "cross" ? `Crossing uses less oxygen${o.cross.hazard ? ", but its walls are over the 20° hazard limit, so going around is safer" : ""}.` : o.cross.allowed ? "Going around uses less oxygen than climbing in and out." : "The walls are too steep to cross on foot, so go around."} Body power while crossing: about ${Math.round(o.cross.peakW)} W per person (metabolic, not mechanical).</p>
    ${routeO2 ? `<p>On your current route, the stretch within ${CRATER_ZONE_M} m of this crater uses <b>${L(routeO2.liters)} L</b> (${L(routeO2.low)}–${L(routeO2.high)} L) over ${routeO2.km.toFixed(2)} km, climbing ${Math.round(routeO2.ascentM)} m. That comes from the real elevation along the route.</p>` : ""}
    <p class="fine">O₂ = power × time ÷ 21,000 J per litre. Power comes from pace, slope and fatigue; the bowl is modelled as straight walls at the measured slope, starting fresh. Ranges cover 90% of 300 runs with measurement error (diameter ±5%, depth ±15%, wall ±3°) and people differing by about 10%. Stress episodes are covered by your reserve, not these numbers.</p>`);
}

export function openRestSpot(s, stop) {
  openDialog(stop ? `Rest stop ${stop.n}` : "Potential rest spot", `<div class="detail-grid"><div><small>GROUND SLOPE</small><strong>${Math.round(s.slope)}°</strong></div><div><small>ELEVATION</small><strong>${Math.round(s.elev)} m</strong></div><div><small>SKY BLOCKED BY TERRAIN</small><strong>${s.skyBlockedPct}%</strong></div>${stop ? `<div><small>FROM YOUR ROUTE</small><strong>${stop.offRouteM} m</strong></div>` : ""}</div>
    <p>${s.onRoute ? "No marked rest spot is close enough here, so this is the flattest nearby point on your route." : "Flat, open ground outside any mapped crater."} ${s.skyBlockedPct >= 1 ? `Terrain blocks at most about ${s.skyBlockedPct}% of cosmic radiation here, and probably less, since radiation comes mostly from overhead.` : "The ground here is open, so terrain gives almost no radiation protection."} <b>This is not shelter.</b> In a solar storm, go to the habitat or a pressurized rover.</p>
    <p class="fine">Boulders smaller than the elevation data can see aren't checked. Detours to reach a rest spot aren't added to route distance.</p>`);
}

// ---------- Explore ----------
export function openExplore() {
  const el = $("#explore-panel");
  const list = state.view === "global" ? [...GLOBAL, ...(state.overlays.missions ? MISSIONS : [])] : LOCAL;
  el.innerHTML = `<div class="explore-header"><div><span class="dialog-eyebrow">GET TO KNOW THE NEIGHBORHOOD</span><h2>A world to discover.</h2></div><button id="close-explore" aria-label="Close exploration panel">${icon("x")}</button></div>
    <p>${state.view === "global" ? "Volcanoes, canyons and every NASA landing site, on one planet." : "Billions of years of history. Just outside your habitat."}</p>
    <div class="explore-list">${list.filter((p) => p.type !== "base").map((p) => {
      const pos = isLocal(p) ? `${p.local.x}% ${p.local.y}%` : `${((p.lon + 180) / 360) * 100}% ${((90 - p.lat) / 180) * 100}%`;
      return `<button data-explore="${p.id}"><span class="explore-thumb" style="background-position:${pos}"></span><span><strong>${A(p.name)}</strong><small>${A(p.subtitle)}</small></span>${icon("arrow-up-right")}</button>`;
    }).join("")}</div>`;
  el.hidden = false;
  refreshIcons();
  $("#close-explore").onclick = () => { el.hidden = true; hooks.setTab("planner"); };
  $$("[data-explore]").forEach((b) => (b.onclick = () => openPlace([...list].find((p) => p.id === b.dataset.explore))));
}

// ---------- Saved missions ----------
export function openSaved() {
  const saved = loadSaved();
  openDialog("Journeys worth keeping.", saved.length
    ? `<div class="saved-list">${saved.map((m) => `<div class="saved-item"><button data-load="${m.id}">${icon("route")}<span><strong>${A(m.name)}</strong><small>${A(m.summary || "")}</small></span>${icon("arrow-up-right")}</button><button class="delete-mission" data-delete="${m.id}" aria-label="Delete ${A(m.name)}">${icon("trash-2")}</button></div>`).join("")}</div>`
    : `<div class="empty-state">${icon("bookmark")}<h3>A world of possibilities.</h3><p>Your saved missions will live here. Plan a journey and tap the bookmark to keep it.</p></div>`);
  $$("[data-load]").forEach((b) => (b.onclick = () => {
    const m = saved.find((x) => String(x.id) === b.dataset.load);
    if (applyPlan(planFromSaved(m))) { hooks.planLoaded(); closeDialog(); toast("Mission loaded"); }
    else toast("This mission was saved by an older version and can’t be restored.");
  }));
  $$("[data-delete]").forEach((b) => (b.onclick = () => {
    const rest = saved.filter((x) => String(x.id) !== b.dataset.delete);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rest)); hooks.savedChanged(); openSaved(); } catch { toast("Unable to update saved missions."); }
  }));
}

export function saveMission(route, mission) {
  const fallback = `${state.from.name} → ${state.to.name}`;
  openDialog("Keep the adventure.", `<p>Save this journey to your mission collection on this device.</p><form id="save-form"><label for="mission-name">MISSION NAME</label><input id="mission-name" maxlength="65" value="${A(fallback)}" required><button class="primary full-width" type="submit">${icon("bookmark")}Save mission</button></form>`);
  $("#save-form").onsubmit = (e) => {
    e.preventDefault();
    const entry = { id: Date.now(), name: $("#mission-name").value.trim() || "Mars mission", plan: serializePlan(), summary: `${route.km.toFixed(1)} km · ${formatHours(mission.hours)} · ${statusLabel[mission.status]}` };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...loadSaved(), entry]));
      hooks.savedChanged(); closeDialog(); toast("Mission saved. The frontier can wait.");
    } catch { toast("Unable to save: browser storage is unavailable."); }
  };
}

// ---------- Info dialogs ----------
export function openAbout() {
  openDialog("A new point of view.", `<div class="about-planet"></div>
    <p>Mars Atlas layers data from several NASA missions into one map a crew can use to plan a Marswalk: where to go, how to get there around hazards, what it will cost in oxygen and radiation, and whether conditions on the day are a go.</p>
    ${sourcesTable()}
    <p class="fine">Global routes use great-circle arcs with a ${SURFACE_FACTOR}× allowance for real terrain. Jezero routes are least-cost paths across real slopes from the CTX elevation mosaic, at about 95 m grid spacing, so features smaller than that are not seen. Rocks and soft sand are not mapped yet. Habitat and weather are illustrative. This is an independent concept, not a NASA application, and not for real mission planning.</p>`, { wide: true });
}

const sourcesTable = () => `<div class="sources"><table><thead><tr><th>Layer</th><th>Source</th><th>Mission / instrument</th><th>What it is</th></tr></thead><tbody>${SOURCES.map((s) => `<tr><td>${A(s.layer)}</td><td>${A(s.source)}</td><td>${A(s.mission)}</td><td><span class="kind kind-${s.kind.startsWith("Measured") ? "measured" : s.kind.startsWith("Illustrative") ? "illustrative" : "derived"}">${A(s.kind)}</span></td></tr>`).join("")}</tbody></table></div>`;

export function openOxygenInfo() {
  openDialog("A little breathing room.", `<p>An illustrative oxygen model for exploring mission tradeoffs. It is not a validated life-support calculation.</p>
    <div class="formula">O₂ = sum over every piece of the route of<br>power × time ÷ 21,000 J/L × crew<br><span>Power depends on pace, slope and fatigue. Total = crater stretches + everything else + your reserve.</span></div>
    <p><b>From NASA data (ICES-2026-127).</b> About 19 ml/kg/min at 2.2 mph in Mars gravity, VO₂max reached near 3.5 mph, a 36 ml/kg/min VO₂max flight rule, a walking pace of 1.7 mph for walks over an hour, and an 82 kg crew member. Effort settings are 35%, 43% and 50% of VO₂max. Climbing adds the standard ACSM grade cost, adjusted for suit weight in Mars gravity, and the crew slows down to hold their effort level.</p>
    <p><b>Our assumptions.</b> I found no validated model for these, so they're estimates: fatigue raises oxygen cost 5% per working hour; a 10-minute rest each hour recovers 30% of it; stress episodes happen about once per 2 hours, last 5 to 15 minutes and add 20% to 60%; people differ by about 10%.</p>
    <p><b>Recommended reserve.</b> The plan is walked 400 times with those random stress episodes and differences, and the reserve is set to cover 95% of them.</p>
    <p><b>Walk-back radius.</b> How far the crew could walk home on the reserve alone, at NASA's walk-back pace of 2.2 mph for the first hour. If a rover breaks down outside this ring, the reserve is not enough to walk back.</p>`);
}

export function openSafetyInfo() {
  openDialog("How the go/no-go check works.", `<p>Each plan is checked against simple flight rules. Any <b>NO-GO</b> stops the plan; a <b>CAUTION</b> needs a crew decision.</p>
    <div class="detail-grid">
      <div><small>EVA LIMIT</small><strong>${EVA_LIMIT_H} h</strong></div>
      <div><small>SLOPE HAZARD LIMIT</small><strong>20°</strong></div>
      <div><small>MEASURED DOSE RANGE</small><strong>0.35–1.15 mSv/day</strong></div>
      <div><small>CAREER LIMIT</small><strong>${CAREER_LIMIT_MSV} mSv</strong></div>
    </div>
    <p><b>Radiation estimate</b> scales Curiosity’s measurements (Guo et al., 2015) by the air above Jezero and a rough projection of the solar cycle for your date. Dose = D₀ × e<sup>−μX</sup>, where X is the mass of air overhead (pressure ÷ Mars gravity, in g/cm²) and μ = 0.022 cm²/g, a value that matches how RAD’s dose changed with pressure at Gale. Jezero sits higher than Gale, so it has less air overhead and a few percent more dose. <b>Potential radiation</b> adds the solar-minimum rate and a full storm the size of May 2024, 8,100 µGy, the largest Curiosity has measured. A bigger storm is possible. NASA’s career limit is 600 mSv.</p>
    <p><b>Season and daylight</b> are calculated from your mission date. <b>Temperature</b> is scaled from Perseverance’s readings by the calculated sunlight, so it’s an estimate, not a forecast. <b>Steep zones</b> come from real elevation data (CTX, 20 m per pixel), using planning limits we chose: 20° is a hazard and 30° is no-go on foot. Rocks and soft sand are not mapped yet.</p>`);
}

export function openRouteDetails(route, mission) {
  const rows = timeline(route, mission);
  const detour = route.scope === "local" && route.ready ? Math.round((route.km / route.straightKm - 1) * 100) : null;
  const hz = (route.hazards || []).filter((h) => h.nearby);
  openDialog("Your route, at a glance.", `
    <div class="detail-grid">
      <div><small>DISTANCE</small><strong>${route.km.toFixed(1)} km</strong></div>
      <div><small>DURATION</small><strong>${formatHours(mission.hours)}</strong></div>
      <div><small>CREW</small><strong>${state.crew} explorer${state.crew > 1 ? "s" : ""}</strong></div>
      <div><small>OXYGEN + RESERVE</small><strong>${Math.ceil(mission.o2.total).toLocaleString()} L</strong></div>
    </div>
    ${timelineTable(rows)}
    ${detour !== null ? `<p>The slope-aware path is <b>${detour}% longer</b> than a straight line (${route.straightKm.toFixed(1)} km) because it ${hz.length ? `steers around ${hz.map((h) => h.hazard.name.toLowerCase()).join(", ")}` : "follows smoother ground"}.</p>` : `<p>Global routes follow the shortest great-circle arc, with a ${SURFACE_FACTOR}× allowance for real terrain.</p>`}`, { wide: true });
}

const timelineTable = (rows) => `<table class="timeline"><thead><tr><th>Time</th><th>Place</th><th>Activity</th></tr></thead><tbody>${rows.map((r, i) => {
  const last = i === rows.length - 1;
  const what = i === 0 ? "Depart" : last ? (state.round ? "Return to start" : "Arrive") : `Science stop · ${Math.round(r.dwell * 60)} min`;
  return `<tr><td>${formatClock(i === 0 ? r.leave : r.arrive)}</td><td>${A(r.place.name)}</td><td>${what}</td></tr>`;
}).join("")}</tbody></table>`;

export function editTime(mission) {
  openDialog("Every journey has its pace.", `<p>Set the total EVA duration yourself. Oxygen, radiation and daylight checks update to match.</p>
    <form id="time-form"><label for="custom-hours">TOTAL JOURNEY TIME (HOURS)</label><input id="custom-hours" type="number" min="0.1" max="999" step="0.1" required value="${mission.hours.toFixed(1)}">
    <div class="dialog-actions"><button type="button" class="secondary" id="auto-time">Use travel speed</button><button class="primary" type="submit">Update estimate ${icon("arrow-right")}</button></div></form>`);
  $("#time-form").onsubmit = (e) => { e.preventDefault(); state.hours = Number($("#custom-hours").value); hooks.render(); closeDialog(); toast("Custom travel time applied"); };
  $("#auto-time").onclick = () => { state.hours = null; hooks.render(); closeDialog(); };
}

// ---------- Mission briefing (printable) ----------
function briefingHtml(route, mission) {
  const rows = timeline(route, mission);
  const places = routePlaces();
  const science = places.filter((p, i, a) => p.science && a.findIndex((q) => q.id === p.id) === i);
  const hz = (route.hazards || []).filter((h) => h.nearby);
  const restStops = routeRestStops(route, mission);
  const title = `${A(state.from.name)} → ${A(state.to.name)}`;
  return `<div class="briefing">
    <header class="br-head"><div><span class="dialog-eyebrow">MARS ATLAS · EVA BRIEFING</span><h3>${title}</h3><p>${state.mode === "walk" ? "On foot" : "Surface rover"} · ${state.crew} crew · start ${formatClock(state.start)} local solar time${state.round ? " · return trip" : ""}</p></div><span class="status-pill ${mission.status}">${statusLabel[mission.status]}</span></header>
    <div class="br-grid">
      <div><small>DISTANCE</small><b>${route.km.toFixed(1)} km</b></div>
      <div><small>DURATION</small><b>${formatHours(mission.hours)}</b></div>
      <div><small>OXYGEN (WITH ${state.reserve}% RESERVE)</small><b>${Math.ceil(mission.o2.total).toLocaleString()} L</b></div>
      <div><small>PER CREW MEMBER</small><b>${Math.ceil(mission.o2.total / state.crew).toLocaleString()} L</b></div>
      ${mission.o2.craters.length ? `<div><small>OXYGEN THROUGH CRATERS</small><b>${Math.ceil(mission.o2.craterLiters).toLocaleString()} L</b></div><div><small>OXYGEN ELSEWHERE</small><b>${Math.ceil(mission.o2.otherLiters).toLocaleString()} L</b></div>` : ""}
      <div><small>AIR OVERHEAD</small><b>${mission.radiation.columnGcm2.toFixed(1)} g/cm²</b></div>
      <div><small>EXTRA DOSE VS GALE AVERAGE (THINNER AIR)</small><b>+${mission.radiation.thinAirExtraPct.toFixed(1)}%</b></div>
      <div><small>RADIATION ESTIMATE</small><b>${mission.radiation.dose.toFixed(3)} mSv</b></div>
      <div><small>POTENTIAL RADIATION</small><b>${mission.radiation.potential.toFixed(1)} mSv</b></div>
      <div><small>MISSION DATE</small><b>${A(state.date)}</b></div>
      <div><small>MARS SEASON</small><b>${A(mission.season.season)}</b></div>
      <div><small>BACK BEFORE SUNSET</small><b>${mission.daylight.sunsetMargin >= 0 ? formatHours(mission.daylight.sunsetMargin) : "No"}</b></div>
      <div><small>AIR TEMPERATURE</small><b>${Math.round(mission.temps.min)} to ${Math.round(mission.temps.max)} °C</b></div>
      <div><small>WALK-BACK RADIUS</small><b>${mission.o2.walkBackKm.toFixed(1)} km</b></div>
      <div><small>AVERAGE PACE</small><b>${mission.human.avgKmh.toFixed(1)} km/h</b></div>
      <div><small>PEAK EFFORT</small><b>${Math.round(mission.human.peakEffort * 100)}% VO₂max</b></div>
      <div><small>RESTS</small><b>${mission.human.rests}</b></div>
      <div><small>RESERVE FOR 95% OF WALKS</small><b>${mission.human.spread ? `${mission.human.recommendedReserve}%` : "n/a"}</b></div>
    </div>
    <h4>Timeline</h4>${timelineTable(rows)}
    <h4>Go / no-go</h4><ul class="checks">${mission.checks.map((c) => `<li class="${c.level}">${A(c.text)}</li>`).join("")}</ul>
    ${route.scope === "local" && route.ready ? `<h4>Terrain</h4><p class="br-terrain">Climb ${Math.round(route.ascentM)} m, descend ${Math.round(route.descentM)} m, steepest ground ${Math.round(route.maxSlope)}° (CTX elevation, 20 m per pixel).</p>` : ""}
    ${hz.length ? `<h4>Steep ground near the route</h4><ul class="br-list">${hz.map((h) => `<li><b>${A(h.hazard.name)}</b> · ${h.inside ? "the route touches this zone" : `closest approach ${Math.round(h.clearanceKm * 1000)} m`}. ${A(h.hazard.note)}</li>`).join("")}</ul>` : ""}
    ${route.craters?.length ? `<h4>Craters on or near the route</h4><ul class="br-list">${route.craters.slice(0, 6).map((k) => `<li><b>${A(k.crater.name ?? "Crater")}</b> · ${k.crater.diameterM} m wide, ${k.crater.depthM} m deep, ${k.crosses ? "route crosses it" : `${k.edgeM} m from its rim`}.</li>`).join("")}</ul>` : ""}
    ${restStops.length ? `<h4>Rest stops</h4><ul class="br-list">${restStops.map((s) => `<li><b>Rest ${s.n}</b> · at ${s.km.toFixed(1)} km, ${Math.round(s.spot.slope)}° ground, ${s.offRouteM} m off route, ${s.spot.skyBlockedPct}% of sky blocked.</li>`).join("")}</ul>` : ""}
    ${science.length ? `<h4>Science objectives</h4><ul class="br-list">${science.map((p) => `<li><b>${A(p.name)}</b> · ${A(p.science)}</li>`).join("")}</ul>` : ""}
    <h4>Data sources</h4>${sourcesTable()}
    <p class="fine">Concept briefing generated by Mars Atlas. Terrain comes from real elevation data, but positions are good to a few hundred meters. Fatigue and stress are estimates. Habitat, temperature and dust are illustrative. Not for real mission planning.</p>
  </div>`;
}

export function openBriefing(route, mission) {
  openDialog("Mission briefing", `${briefingHtml(route, mission)}<div class="dialog-actions"><button class="secondary" id="copy-share">${icon("share-2")}Copy share link</button><button class="primary" id="print-briefing">${icon("printer")}Print or save as PDF</button></div>`, { wide: true, eyebrow: "MARS ATLAS / FLIGHT DIRECTOR" });
  $("#print-briefing").onclick = () => {
    $("#print-root").innerHTML = briefingHtml(route, mission);
    closeDialog();
    requestAnimationFrame(() => window.print());
  };
  $("#copy-share").onclick = shareLink;
}

export async function shareLink() {
  const url = location.href.split("#")[0] + toHash();
  history.replaceState(null, "", toHash());
  try { await navigator.clipboard.writeText(url); toast("Share link copied. Anyone with it opens this exact plan."); }
  catch { toast("Link added to the address bar. Copy it from there to share."); }
}
