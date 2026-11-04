import { GLOBAL, KM_PER_X, KM_PER_Y, LOCAL, MISSIONS, localToGeo } from "../data/places.js";
import { MARS_RADIUS_KM, escapeHtml, formatCoords, formatHours, geoToGlobalPct, globalPctToGeo } from "../lib/geo.js";
import { CRATERS, paintHazards, paintTraversability } from "../model/terrain.js";
import { getTerrain } from "../plan.js";
import { customGlobal, customLocal, isLocal, routeScope, state } from "../state.js";
import { $, $$, icon, refreshIcons, toast } from "./dom.js";

let hooks = {};
let travPainted = false;
let hazardsPainted = false;

const world = () => $("#map-world");
const mapEl = () => $("#map");

// Percent position of a place on the current map-world.
export function pctOf(place) {
  if (state.view === "global") return geoToGlobalPct(place);
  return isLocal(place) ? place.local : null;
}

export function applyTransform() {
  world().style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  world().style.setProperty("--inv", String(1 / state.zoom));
  const w = world().offsetWidth * state.zoom;
  const kmPer66 = state.view === "global" ? ((2 * Math.PI * MARS_RADIUS_KM) / Math.max(1, w)) * 66 : ((100 * KM_PER_X) / Math.max(1, w)) * 66;
  $("#scale-text").textContent = kmPer66 >= 10 ? `${Math.round(kmPer66)} km` : `${kmPer66.toFixed(1)} km`;
}

export function setView(view) {
  state.view = view;
  state.zoom = 1; state.panX = 0; state.panY = 0;
  const m = mapEl();
  m.dataset.view = view;
  const g = view === "global";
  $("#region-name").textContent = g ? "Global Mars" : "Jezero detail";
  $("#map-area").textContent = g ? "MARS · GLOBAL SURFACE ATLAS" : "JEZERO CRATER · 18.4° N 77.5° E";
  $("#map-projection").textContent = g ? "EQUIRECTANGULAR" : "HRSC IMAGE · CTX ELEVATION";
  $("#imagery-credit").textContent = g ? "Viking MDIM 2.1 / MOLA · NASA/JPL/USGS" : "HRSC · ESA/DLR/FU Berlin · NASA";
  $$(".view-switch [data-view]").forEach((b) => b.classList.toggle("selected", b.dataset.view === view));
  $('.layer-menu [data-layer="satellite"] span').textContent = g ? "Viking color" : "HRSC color";
  $('.layer-menu [data-layer="terrain"] span').textContent = g ? "MOLA elevation" : "Contour sketch";
  $$(".overlay-toggle").forEach((l) => (l.hidden = l.dataset.only !== view));
  if (!g) hooks.ensureTerrain?.();
  applyTransform();
  hooks.render();
}

// Zoom and pan so the whole route is in view.
export function focusRoute(route) {
  const local = routeScope() === "local";
  if (local && state.view !== "jezero") { setView("jezero"); }
  else if (!local && state.view !== "global") { setView("global"); }
  const pts = local ? route.points : route.arc.map(geoToGlobalPct);
  if (!pts?.length) return;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if (!local && maxX - minX > 60) { state.zoom = 1; state.panX = 0; state.panY = 0; applyTransform(); return; }
  const w = world().offsetWidth, h = world().offsetHeight, mw = mapEl().clientWidth, mh = mapEl().clientHeight;
  const spanX = ((maxX - minX) / 100) * w, spanY = ((maxY - minY) / 100) * h;
  // Fit into the clear band between the top controls and the journey card.
  state.zoom = Math.max(1, Math.min(local ? 3 : 4, Math.min((mw * 0.6) / Math.max(40, spanX), (mh * 0.38) / Math.max(40, spanY))));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  state.panX = ((50 - cx) / 100) * w * state.zoom;
  state.panY = ((50 - cy) / 100) * h * state.zoom - mh * 0.04;
  applyTransform();
}

export function centerOn(p, zoom) {
  if (zoom) state.zoom = zoom;
  state.panX = ((50 - p.x) / 100) * world().offsetWidth * state.zoom;
  state.panY = ((50 - p.y) / 100) * world().offsetHeight * state.zoom;
  applyTransform();
}

const arcPath = (arc) => {
  const pts = arc.map(geoToGlobalPct);
  return pts.map((p, i) => `${i === 0 || Math.abs(p.x - pts[i - 1].x) > 50 ? "M" : "L"} ${(p.x * 10).toFixed(1)} ${(p.y * 10).toFixed(1)}`).join(" ");
};
const linePath = (pts) => pts.map((p, i) => `${i ? "L" : "M"} ${(p.x * 10).toFixed(1)} ${(p.y * 10).toFixed(1)}`).join(" ");

function renderCraters() {
  const box = $("#crater-layer");
  box.hidden = state.view !== "jezero" || !state.overlays.craters;
  if (box.dataset.done) return;
  box.dataset.done = "1";
  box.innerHTML = CRATERS.map((c) => `<button class="crater-ring" data-crater="${c.id}" style="left:${c.x}%;top:${c.y}%;width:${c.diameterM / (KM_PER_X * 1000)}%;height:${c.diameterM / (KM_PER_Y * 1000)}%" aria-label="Crater, ${c.diameterM} meters wide" title="${c.name ? `${c.name}: ` : ""}${c.diameterM} m wide, ${c.depthM} m deep"></button>`).join("");
}

function renderRestSpots(stops) {
  const t = getTerrain();
  const onRoute = new Set(stops.map((s) => s.spot.id));
  const dots = state.view === "jezero" && state.overlays.allRest && t ? t.restSpots.filter((s) => !onRoute.has(s.id)).map((s) => `<button class="rest-dot" data-rest="${s.id}" style="left:${s.x}%;top:${s.y}%" aria-label="Potential rest spot, ${s.skyBlockedPct}% of sky blocked"></button>`) : [];
  const marks = state.view === "jezero" ? stops.map((s) => `<button class="map-marker rest-marker" data-rest="${s.spot.id}" style="left:${s.spot.x}%;top:${s.spot.y}%" aria-label="Rest stop ${s.n}"><span class="rest-pin">${icon("timer")}</span><span class="marker-label">Rest ${s.n}</span></button>`) : [];
  return [...dots, ...marks].join("");
}

export function renderMap(route, mission, stops = []) {
  const g = state.view === "global";
  const scope = routeScope();
  const localRouteInGlobal = g && scope === "local";
  const showRoute = !localRouteInGlobal && !(state.view === "jezero" && scope === "global");

  let d = "", mid = null;
  if (showRoute && scope === "global") {
    d = arcPath(route.arc);
    mid = geoToGlobalPct(route.arc[Math.floor(route.arc.length / 2)]);
  } else if (showRoute) {
    d = linePath(route.points);
    mid = route.samples[Math.floor(route.samples.length / 2)];
  }
  for (const id of ["route-line", "route-shadow", "route-dash"]) $(`#${id}`).setAttribute("d", d);
  const straight = showRoute && scope === "local" && route.ready && route.km > route.straightKm * 1.04;
  $("#route-straight").setAttribute("d", straight ? linePath([route.points[0], route.points[route.points.length - 1]]) : "");
  $(".route-overlay").classList.toggle("pending", scope === "local" && !route.ready);

  const chip = $("#route-time");
  chip.hidden = !showRoute;
  if (mid) {
    chip.style.left = `${Math.min(88, Math.max(12, mid.x + 4))}%`;
    chip.style.top = `${Math.min(90, Math.max(10, mid.y - 3))}%`;
    chip.innerHTML = `${icon(state.mode === "walk" ? "footprints" : "truck")}<b>${formatHours(mission.hours)}</b><span>${route.ready || scope === "global" ? "Estimated journey" : "Routing around hazards…"}</span>`;
  }

  renderMarkers(localRouteInGlobal, showRoute);
  $("#map-markers").insertAdjacentHTML("beforeend", renderRestSpots(stops));
  renderCraters();
  renderHazards();
  renderWalkback(route, mission, scope);
  renderTraversability();
  refreshIcons();
}

function renderMarkers(collapsed, showRoute) {
  const g = state.view === "global";
  const used = new Set([state.from.id, state.to.id, ...state.stops.map((s) => s.place.id)]);
  const pois = (g ? [...GLOBAL, ...(state.overlays.missions ? MISSIONS : [])] : LOCAL).filter((p) => !used.has(p.id) && !(collapsed && p.id === "jezero"));
  const html = pois.map((p) => {
    const at = pctOf(p);
    const sym = p.type === "mission" ? "rocket" : p.type === "science" ? "flask-conical" : p.type === "base" ? "tent-tree" : "mountain";
    return `<button class="map-marker poi ${p.type}" data-place="${p.id}" style="left:${at.x}%;top:${at.y}%" aria-label="Explore ${escapeHtml(p.name)}"><span class="marker-symbol">${icon(sym)}</span><span class="marker-label">${escapeHtml(p.name)}</span></button>`;
  });

  if (collapsed) {
    const at = geoToGlobalPct(GLOBAL.find((p) => p.id === "jezero"));
    html.push(`<button class="map-marker endpoint origin" data-zoom-route style="left:${at.x}%;top:${at.y}%" aria-label="Zoom to the Jezero mission"><span class="endpoint-halo"><span>${icon("tent-tree")}</span></span><span class="endpoint-label">Jezero mission<small>ZOOM TO ROUTE</small></span></button>`);
  } else if (showRoute) {
    const ep = (p, role) => {
      const at = pctOf(p);
      if (!at) return "";
      return `<button class="map-marker endpoint ${role}" data-endpoint="${role === "origin" ? "from" : "to"}" style="left:${at.x}%;top:${at.y}%" aria-label="${role === "origin" ? "Starting point" : "Destination"}: ${escapeHtml(p.name)}"><span class="${role === "origin" ? "endpoint-halo" : "destination-pin"}"><span>${icon(role === "origin" ? "tent-tree" : "flag")}</span></span><span class="endpoint-label">${escapeHtml(p.name)}<small>${role === "origin" ? "STARTING POINT" : "YOUR DESTINATION"}</small></span></button>`;
    };
    html.push(ep(state.from, "origin"));
    if (!(state.round && state.to.id === state.from.id)) html.push(ep(state.to, "destination"));
    state.stops.forEach((s, i) => {
      const at = pctOf(s.place);
      if (at) html.push(`<button class="map-marker stop-marker" data-stop-index="${i}" style="left:${at.x}%;top:${at.y}%" aria-label="Stop ${i + 1}: ${escapeHtml(s.place.name)}"><span class="stop-dot">${i + 1}</span><span class="marker-label">${escapeHtml(s.place.name)}</span></button>`);
    });
  }
  $("#map-markers").innerHTML = html.join("");
}

function renderHazards() {
  const t = getTerrain();
  if (!t) return;
  if (!hazardsPainted) { paintHazards(t, $("#hazard-overlay")); hazardsPainted = true; }
  $("#hazard-labels").innerHTML = t.hazards.slice(0, 5).map((hz) => `<div class="hazard" style="left:${hz.x}%;top:${hz.y}%" title="${escapeHtml(hz.note)}">${icon("triangle-alert")}${escapeHtml(hz.name)}</div>`).join("");
}

function renderWalkback(route, mission, scope) {
  const ring = $("#walkback-ring");
  const on = state.view === "jezero" && scope === "local" && state.overlays.walkback;
  $("#walkback-overlay").classList.toggle("on", on);
  if (!on) return;
  const c = route.base.local, r = mission.o2.walkBackKm;
  ring.setAttribute("cx", c.x * 10); ring.setAttribute("cy", c.y * 10);
  ring.setAttribute("rx", (r / KM_PER_X) * 10); ring.setAttribute("ry", (r / KM_PER_Y) * 10);
  ring.classList.toggle("exceeded", state.mode === "rover" && route.maxFromBaseKm > r);
}

function renderTraversability() {
  const t = getTerrain();
  if (t && !travPainted) { paintTraversability(t, $("#trav-layer")); travPainted = true; }
  mapEl().classList.toggle("show-trav", state.view === "jezero" && state.overlays.trav && !!t);
}

function eventToPct(e) {
  const r = world().getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
}

export function startPicking(target) {
  state.picking = target;
  if (innerWidth <= 700) mapEl().scrollIntoView({ behavior: "smooth" });
  $("#pick-banner").hidden = false;
  const what = { from: "starting point", to: "destination", stop: "science stop" }[target];
  $("#pick-banner span").textContent = `Click the map to place your ${what}`;
  mapEl().classList.add("picking");
}
export function stopPicking() {
  state.picking = null;
  $("#pick-banner").hidden = true;
  mapEl().classList.remove("picking");
}

export function initMap(h) {
  hooks = h;
  const m = mapEl();
  let drag = null;
  const ignore = "button,input,select,article,form,.layer-menu,.search-results,.explore-panel,.hud-controls,.weather-card";

  m.addEventListener("pointerdown", (e) => {
    if (e.target.closest(ignore)) return;
    drag = { x: e.clientX, y: e.clientY, panX: state.panX, panY: state.panY, moved: false };
  });
  window.addEventListener("pointermove", (e) => {
    if (!drag || state.picking || hooks.hudActive()) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) {
      drag.moved = true;
      state.panX = Math.max(-m.clientWidth * state.zoom * 0.5, Math.min(m.clientWidth * state.zoom * 0.5, drag.panX + dx));
      state.panY = Math.max(-m.clientHeight * state.zoom * 0.5, Math.min(m.clientHeight * state.zoom * 0.5, drag.panY + dy));
      applyTransform();
      m.classList.add("dragging");
    }
  });
  window.addEventListener("pointerup", (e) => {
    if (drag && state.picking && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8 && !e.target.closest(ignore)) {
      const p = eventToPct(e);
      if (p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100) toast("Choose a point on the Mars surface.");
      else {
        const place = state.view === "global" ? (({ lat, lon }) => customGlobal(lat, lon))(globalPctToGeo(p)) : customLocal(Math.min(98, Math.max(2, p.x)), Math.min(98, Math.max(2, p.y)));
        hooks.placePicked(state.picking, place);
      }
    }
    drag = null;
    m.classList.remove("dragging");
  });

  m.addEventListener("pointermove", (e) => {
    const p = eventToPct(e);
    if (p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100) return;
    $("#coordinate-readout").textContent = formatCoords(state.view === "global" ? globalPctToGeo(p) : localToGeo(p));
  });

  m.addEventListener("wheel", (e) => {
    if (e.target.closest("input,.explore-panel,.search-results,.layer-menu") || innerWidth <= 700 || hooks.hudActive()) return;
    e.preventDefault();
    const r = world().getBoundingClientRect();
    const before = state.zoom;
    state.zoom = Math.max(1, Math.min(10, state.zoom + (e.deltaY < 0 ? 0.25 : -0.25)) );
    const k = state.zoom / before;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    state.panX += (e.clientX - cx) * (1 - k);
    state.panY += (e.clientY - cy) * (1 - k);
    if (state.zoom === 1) { state.panX = 0; state.panY = 0; }
    applyTransform();
  }, { passive: false });

  m.addEventListener("keydown", (e) => {
    if (e.target !== m) return;
    const step = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[e.key];
    if (step) { e.preventDefault(); state.panX += step[0]; state.panY += step[1]; applyTransform(); }
    if (e.key === "+" || e.key === "=") { e.preventDefault(); $("#zoom-in").click(); }
    if (e.key === "-") { e.preventDefault(); $("#zoom-out").click(); }
    if (e.key === "0") { e.preventDefault(); $("#compass").click(); }
  });

  $("#zoom-in").onclick = () => { state.zoom = Math.min(10, state.zoom + 0.5); applyTransform(); };
  $("#zoom-out").onclick = () => { state.zoom = Math.max(1, state.zoom - 0.5); if (state.zoom === 1) { state.panX = 0; state.panY = 0; } applyTransform(); };
  $("#compass").onclick = () => { state.zoom = 1; state.panX = 0; state.panY = 0; applyTransform(); };
  $("#locate").onclick = () => {
    setView(isLocal(state.from) ? "jezero" : "global");
    centerOn(pctOf(state.from) ?? geoToGlobalPct(state.from), state.view === "global" ? 3 : 2);
    toast("Centered on " + state.from.name);
  };
  $("#fullscreen").onclick = () => {
    document.querySelector(".workspace").classList.toggle("expanded-map");
    requestAnimationFrame(applyTransform);
    toast(document.querySelector(".workspace").classList.contains("expanded-map") ? "Map expanded · press Escape to return" : "Planner restored");
  };
  $$(".view-switch [data-view]").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $("#map-guide").onclick = () => setView(state.view === "global" ? "jezero" : "global");
  $("#cancel-pick").onclick = stopPicking;

  $("#layers-button").onclick = () => {
    const open = !$("#layer-menu").hidden;
    $("#layer-menu").hidden = open;
    $("#layers-button").setAttribute("aria-expanded", String(!open));
  };
  const layerButtons = $$(".layer-menu [data-layer]");
  layerButtons.forEach((b) => (b.onclick = () => {
    state.layer = b.dataset.layer;
    m.dataset.layer = state.layer;
    layerButtons.forEach((x) => x.classList.toggle("selected", x === b));
    toast(b.textContent.trim() + " layer enabled");
  }));
  $$("[data-overlay]").forEach((inp) => (inp.onchange = () => {
    state.overlays[inp.dataset.overlay] = inp.checked;
    if (inp.dataset.overlay === "trav" && inp.checked) hooks.ensureTerrain();
    hooks.render();
  }));
  $$("[data-filter]").forEach((b) => (b.onclick = () => {
    if (b.dataset.filter === "hazards" && state.view === "global") { toast("Hazard zones are mapped in Jezero detail."); return; }
    b.classList.toggle("active");
    if (b.dataset.filter === "hazards") m.classList.toggle("show-hazards", b.classList.contains("active"));
    else m.classList.toggle("hide-landmarks", !b.classList.contains("active"));
  }));
  window.addEventListener("resize", applyTransform);
}
