import "./styles/fonts.css";
import "./styles/base.css";
import "./styles/features.css";
import "./styles/theme-iroha.css";

import { ALL_PLACES, LOCAL, MISSIONS } from "./data/places.js";
import { escapeHtml as A, formatClock, formatHours } from "./lib/geo.js";
import { guideRouteUpdate, initGuide } from "./ui/guide.js";
import { CRATERS } from "./model/terrain.js";
import { currentMission, currentRoute, ensureTerrain, getTerrain, onAsyncData, routeRestStops } from "./plan.js";
import { fromHash, isLocal, loadSaved, routeScope, state } from "./state.js";
import { $, $$, closeDialog, icon, refreshIcons, toast } from "./ui/dom.js";
import { closeHud, hudActive, hudKey, openHud } from "./ui/hud.js";
import { applyTransform, focusRoute, initMap, renderMap, setView, startPicking, stopPicking } from "./ui/map.js";
import {
  editTime, initPanels, openAbout, openBriefing, openCrater, openExplore, openRestSpot, openOxygenInfo, openPlace, openRouteDetails, openSafetyInfo,
  openSaved, saveMission, shareLink,
} from "./ui/panels.js";
import { renderProfile } from "./ui/profile.js";

const statusText = { go: "GO", caution: "CAUTION", nogo: "NO-GO" };
const searchable = () => [...ALL_PLACES, ...MISSIONS];

// ---------- Render ----------
function render() {
  const route = currentRoute();
  const mission = currentMission(route);
  const scope = route.scope;

  $("#crew-value").textContent = String(state.crew).padStart(2, "0");
  $("#crew-minus").disabled = state.crew <= 1;
  $("#crew-plus").disabled = state.crew >= 12;
  $("#reserve-value").innerHTML = `${state.reserve}<span>%</span>`;
  $("#reserve").style.setProperty("--fill", `${((state.reserve - 10) / 90) * 100}%`);
  $("#start-value").textContent = formatClock(state.start);
  $("#start-time").style.setProperty("--fill", `${((state.start - 4) / 16) * 100}%`);
  $("#from").value = state.from.name;
  $("#to").value = state.to.name;
  $$("[data-mode]").forEach((b) => b.classList.toggle("selected", b.dataset.mode === state.mode));

  renderStops();
  renderSolBar(mission);

  $("#oxygen-total").textContent = Math.ceil(mission.o2.total).toLocaleString();
  $("#base-oxygen").textContent = `${Math.ceil(mission.o2.base).toLocaleString()} L`;
  $("#reserve-oxygen").textContent = `+ ${Math.ceil(mission.o2.extra).toLocaleString()} L`;
  $("#walkback-value").textContent = mission.expedition ? "n/a" : `${mission.o2.walkBackKm.toFixed(1)} km`;
  $("#oxygen-note").textContent = `${Math.ceil(mission.o2.total / state.crew).toLocaleString()} L per crew member · ${formatHours(mission.o2.reserveHours)} of reserve`;
  const spread = mission.human.spread;
  $("#rec-row").hidden = !spread;
  if (spread) $("#rec-row").firstChild.textContent = state.mode === "rover" ? "Reserve to survive a breakdown " : "Reserve to cover 95% of walks ";
  if (spread) $("#rec-reserve").textContent = `${mission.human.recommendedReserve}%`;

  renderSafety(mission);

  $("#journey-kind").textContent = mission.expedition ? "YOUR EXPEDITION" : state.round ? "YOUR RETURN JOURNEY" : "YOUR SURFACE JOURNEY";
  $("#distance").innerHTML = `${route.km.toFixed(1)} <small>km</small>`;
  $("#travel-time").textContent = formatHours(mission.hours);
  $("#terrain-value").innerHTML = terrainLabel(route);
  $("#route-kind").textContent = scope === "local" ? (route.ready ? "Slope-aware surface route" : "Routing around steep ground…") : "Great-circle route · MOLA profile";
  renderProfile($("#profile-chart"), route);

  const temp = Math.round(mission.temps.now);
  $("#weather-temp").innerHTML = `${temp < 0 ? "−" : ""}${Math.abs(temp)}°<span>C</span>`;
  $("#weather-wind").textContent = { clear: "14 km/h", hazy: "26 km/h", storm: "62 km/h" }[state.dust];
  $("#weather-sky").textContent = state.start < mission.daylight.sunrise || state.start > mission.daylight.sunset ? "Night" : mission.dust.sky;
  $("#mission-date").value = state.date;
  $("#season-line").textContent = `${mission.season.season} (Ls ${Math.round(mission.season.ls)}°) · sunrise ${formatClock(mission.daylight.sunrise)}, sunset ${formatClock(mission.daylight.sunset)}`;
  guideRouteUpdate(route, mission);

  renderMap(route, mission, routeRestStops(route, mission));
  refreshIcons();
  return { route, mission };
}

function terrainLabel(route) {
  if (route.scope !== "local") return route.profile ? `Climb ${climbOf(route.profile).toFixed(1)} km` : "Unsurveyed";
  if (!route.ready) return "Surveying…";
  const s = route.maxSlope;
  const label = s < 15 ? "Easy" : s < 20 ? "Mixed" : "Steep";
  const bars = s < 15 ? "▂▂▃" : s < 20 ? "▂▅▃" : "▅▇▆";
  return `${label} <span class="terrain-dots">${bars}</span>`;
}
const climbOf = (v) => v.slice(1).reduce((s, x, i) => s + Math.max(0, x - v[i]), 0);

function renderSafety(m) {
  const pill = $("#status-pill");
  pill.textContent = statusText[m.status];
  pill.className = `status-pill ${m.status}`;
  $("#safety-card").dataset.status = m.status;
  $("#dose-value").textContent = `${m.radiation.dose.toFixed(m.radiation.dose < 1 ? 3 : 1)} mSv`;
  $("#dose-context").textContent = `${(m.radiation.careerShare * 100).toFixed(m.radiation.careerShare < 0.01 ? 3 : 1)}% of career limit · ${m.radiation.weather}`;
  $("#potential-value").textContent = `${m.radiation.potential.toFixed(1)} mSv`;
  $("#temp-value").textContent = `${Math.round(m.temps.min)} to ${Math.round(m.temps.max)} °C`;
  $("#temp-context").textContent = `${m.dust.label} · τ ≈ ${m.dust.tau}`;
  $("#daylight-value").textContent = m.expedition ? "Multi-sol" : m.daylight.sunsetMargin >= 0 ? formatHours(m.daylight.sunsetMargin) : `−${formatHours(-m.daylight.sunsetMargin)}`;
  $("#daylight-context").textContent = m.expedition ? "Pressurized rover expedition" : `Back ${formatClock(m.daylight.end)} · sunset ${formatClock(m.daylight.sunset)}`;
  $("#eva-value").textContent = formatHours(m.hours);
  $("#eva-context").textContent = [m.human.restHours ? `${formatHours(m.human.restHours)} rest` : "", m.dwellHours ? `${formatHours(m.dwellHours)} science` : ""].filter(Boolean).join(" · ") || "no stops";
  $("#effort-value").textContent = m.expedition ? "Per sol" : `${Math.round(m.human.peakEffort * 100)}% peak`;
  $("#effort-context").textContent = m.expedition ? "0.84 kg O₂ per person per sol" : state.mode === "walk" ? `of VO₂max · fatigue up to +${Math.round(m.human.peakFatigue * 100)}%` : "of VO₂max, seated in rover";
  $("#pace-value").textContent = `${m.human.avgKmh.toFixed(1)} km/h`;
  $("#pace-context").textContent = state.mode === "walk" ? `slows on climbs · ${m.human.rests} rest${m.human.rests === 1 ? "" : "s"}` : "slows on steep ground";
  const order = { nogo: 0, caution: 1, go: 2 };
  $("#checks").innerHTML = [...m.checks].sort((a, b) => order[a.level] - order[b.level]).map((c) => `<li class="${c.level}">${icon(c.level === "go" ? "circle-check" : c.level === "caution" ? "circle-alert" : "octagon-alert")}<span>${A(c.text)}</span></li>`).join("");
  const sys = $("#system-status");
  const advisories = m.checks.filter((c) => c.level !== "go").length;
  sys.dataset.status = m.status;
  sys.querySelector("span").textContent = m.status === "go" ? "ALL SYSTEMS NOMINAL" : m.status === "nogo" ? "NO-GO · REVIEW PLAN" : `${advisories} ADVISOR${advisories === 1 ? "Y" : "IES"}`;
}

function renderSolBar(m) {
  const pct = (h) => `${(Math.min(24, Math.max(0, h)) / 24) * 100}%`;
  const end = Math.min(24, m.daylight.end);
  $("#sol-bar").innerHTML = `
    <span class="sol-night" style="left:0;width:${pct(m.daylight.sunrise)}"></span>
    <span class="sol-night" style="left:${pct(m.daylight.sunset)};right:0"></span>
    <span class="sol-eva ${m.daylight.sunsetMargin < 0 ? "late" : ""}" style="left:${pct(m.daylight.start)};width:calc(${pct(end)} - ${pct(m.daylight.start)})"></span>
    <span class="sol-tick" style="left:25%">06</span><span class="sol-tick" style="left:50%">12</span><span class="sol-tick" style="left:75%">18</span>`;
}

function renderStops() {
  $("#stops").innerHTML = state.stops.map((s, i) => `<div class="stop-chip"><span class="stop-dot">${i + 1}</span><button class="stop-name" data-open-stop="${i}">${A(s.place.name)}</button>
    <select data-dwell="${i}" aria-label="Time at ${A(s.place.name)}">${[0.25, 0.5, 0.75, 1, 1.5].map((d) => `<option value="${d}" ${d === s.dwell ? "selected" : ""}>${d < 1 ? Math.round(d * 60) + " min" : d + " h"}</option>`).join("")}</select>
    <button class="stop-remove" data-remove-stop="${i}" aria-label="Remove ${A(s.place.name)}">${icon("x")}</button></div>`).join("");
  $("#add-stop").hidden = state.stops.length >= 4;
}

// ---------- Actions ----------
function setPlace(target, place) {
  state[target] = place;
  state.hours = null;
  if (!isLocal(place) && state.view !== "global") setView("global");
  closeSuggestions();
  $("#search-results").hidden = true;
  stopPicking();
  render();
}

function addStop(place) {
  if (state.stops.length >= 4) { toast("Up to four science stops per EVA."); return; }
  state.stops.push({ place, dwell: 0.5 });
  state.hours = null;
  if (!isLocal(place) && state.view !== "global") setView("global");
  closeSuggestions();
  stopPicking();
  render();
  toast(`${place.name} added as stop ${state.stops.length}`);
}

function placePicked(target, place) {
  if (target === "stop") addStop(place);
  else setPlace(target, place);
}

function closeSuggestions() {
  $$(".suggestions").forEach((s) => (s.hidden = true));
  $$('[role="combobox"]').forEach((c) => c.setAttribute("aria-expanded", "false"));
}

function showSuggestions(target, query = "") {
  const q = query.toLowerCase();
  const pool = target === "stop" ? (routeScope() === "local" ? LOCAL : ALL_PLACES) : ALL_PLACES;
  const matches = pool.filter((p) => p.name.toLowerCase().includes(q));
  const box = $(`#suggestions-${target}`);
  box.innerHTML = matches.map((p) => `<button data-suggestion="${p.id}" data-target="${target}">${icon("map-pin")}<span>${A(p.name)}<small>${A(p.subtitle)}</small></span></button>`).join("") +
    `<button data-pick="${target}">${icon("crosshair")}Choose a point on the map</button>`;
  box.hidden = false;
  $(`#${target}`)?.setAttribute("aria-expanded", "true");
  refreshIcons();
}

function setTab(tab) {
  $$("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  state.activeTab = tab;
  if (tab === "explore") openExplore();
  else { $("#explore-panel").hidden = true; if (tab === "saved") openSaved(); }
}

function updateSavedCount() {
  $("#saved-count").textContent = loadSaved().length || "";
}

function runSearch() {
  const q = $("#map-search").value.toLowerCase().trim();
  const found = searchable().filter((p) => p.name.toLowerCase().includes(q) || (p.subtitle || "").toLowerCase().includes(q));
  const box = $("#search-results");
  box.innerHTML = found.length
    ? found.map((p) => `<button data-search-place="${p.id}">${icon("map-pin")}<span>${A(p.name)}<small>${A(p.subtitle)}</small></span>${icon("arrow-up-right")}</button>`).join("")
    : `<p>No landmarks found. Try “delta” or choose a point on the map.</p><button id="search-custom">${icon("crosshair")}Place a custom destination</button>`;
  box.hidden = false;
  refreshIcons();
  $$("[data-search-place]").forEach((b) => (b.onclick = () => { box.hidden = true; openPlace(searchable().find((p) => p.id === b.dataset.searchPlace)); }));
  $("#search-custom")?.addEventListener("click", () => { box.hidden = true; startPicking("to"); });
}

// ---------- Wiring ----------
function wire() {
  for (const target of ["from", "to"]) {
    const input = $(`#${target}`);
    input.addEventListener("focus", () => { input.select(); showSuggestions(target); });
    input.addEventListener("input", () => showSuggestions(target, input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeSuggestions(); input.value = state[target].name; }
      if (e.key === "Enter") {
        const hit = ALL_PLACES.find((p) => p.name.toLowerCase().includes(input.value.toLowerCase()));
        hit ? setPlace(target, hit) : startPicking(target);
      }
      if (e.key === "ArrowDown") { e.preventDefault(); $(`#suggestions-${target} button`)?.focus(); }
    });
    input.addEventListener("blur", () => setTimeout(() => { if (!$(`#suggestions-${target}`).contains(document.activeElement)) input.value = state[target].name; }, 150));
  }
  $("#add-stop").onclick = (e) => { e.stopPropagation(); showSuggestions("stop"); };

  document.addEventListener("click", (e) => {
    const sug = e.target.closest("[data-suggestion]");
    if (sug) {
      const place = ALL_PLACES.find((p) => p.id === sug.dataset.suggestion);
      sug.dataset.target === "stop" ? addStop(place) : setPlace(sug.dataset.target, place);
    }
    const pick = e.target.closest("[data-pick]");
    if (pick) { closeSuggestions(); startPicking(pick.dataset.pick); }
    if (!e.target.closest(".location-fields,.stop-adder")) closeSuggestions();
    const ringEl = e.target.closest("[data-crater]");
    if (ringEl) {
      const c = CRATERS.find((k) => k.id === ringEl.dataset.crater);
      openCrater(c, currentRoute().craters?.find((k) => k.crater.id === c.id), currentMission().o2.craters?.find((k) => k.id === c.id));
    }
    const restEl = e.target.closest("[data-rest]");
    if (restEl) {
      const route = currentRoute();
      const stop = routeRestStops(route, currentMission(route)).find((s) => s.spot.id === restEl.dataset.rest);
      const spot = stop?.spot ?? getTerrain()?.restSpots.find((s) => s.id === restEl.dataset.rest);
      if (spot) openRestSpot(spot, stop);
    }
    const poi = e.target.closest("[data-place]");
    if (poi) openPlace(searchable().find((p) => p.id === poi.dataset.place));
    const ep = e.target.closest("[data-endpoint]");
    if (ep) openPlace(state[ep.dataset.endpoint]);
    if (e.target.closest("[data-zoom-route]")) focusRoute(currentRoute());
    const st = e.target.closest("[data-stop-index],[data-open-stop]");
    if (st) openPlace(state.stops[+(st.dataset.stopIndex ?? st.dataset.openStop)].place);
    const rm = e.target.closest("[data-remove-stop]");
    if (rm) { state.stops.splice(+rm.dataset.removeStop, 1); state.hours = null; render(); }
    if (!e.target.closest(".search-container")) $("#search-results").hidden = true;
  });
  document.addEventListener("change", (e) => {
    const d = e.target.closest("[data-dwell]");
    if (d) { state.stops[+d.dataset.dwell].dwell = +d.value; state.hours = null; render(); }
  });

  $("#swap").onclick = () => { [state.from, state.to] = [state.to, state.from]; state.stops.reverse(); state.hours = null; render(); };
  $$("[data-mode]").forEach((b) => (b.onclick = () => { state.mode = b.dataset.mode; state.hours = null; render(); }));
  $("#crew-minus").onclick = () => { state.crew = Math.max(1, state.crew - 1); render(); };
  $("#crew-plus").onclick = () => { state.crew = Math.min(12, state.crew + 1); render(); };
  $("#activity").onchange = (e) => { state.activity = Number(e.target.value); render(); };
  $("#reserve").oninput = (e) => { state.reserve = Number(e.target.value); render(); };
  $("#round-trip").onchange = (e) => { state.round = e.target.checked; state.hours = null; render(); };
  $("#start-time").oninput = (e) => { state.start = Number(e.target.value); render(); };
  $("#mission-date").onchange = (e) => { if (e.target.value) { state.date = e.target.value; render(); } };
  $("#dust").onchange = (e) => { state.dust = e.target.value; render(); };
  $("#space-weather").onchange = (e) => { state.weather = e.target.value; render(); };

  $("#calculate").onclick = () => {
    const { route, mission } = render();
    focusRoute(route);
    $("#calculate").classList.add("calculated");
    if (innerWidth <= 700) $("#map").scrollIntoView({ behavior: "smooth" });
    toast(`Route calculated · ${route.km.toFixed(1)} km · ${Math.ceil(mission.o2.total).toLocaleString()} L O₂ · ${statusText[mission.status]}`);
    setTimeout(() => $("#calculate").classList.remove("calculated"), 1000);
  };
  $("#focus-route").onclick = () => focusRoute(currentRoute());

  const withPlan = (fn) => () => { const route = currentRoute(); fn(route, currentMission(route)); };
  $("#route-details").onclick = withPlan(openRouteDetails);
  $("#edit-time").onclick = withPlan((_, m) => editTime(m));
  $("#save-mission").onclick = withPlan(saveMission);
  $("#open-briefing").onclick = withPlan(openBriefing);
  $("#share-link").onclick = shareLink;
  const hud = withPlan((route, mission) => openHud(route, mission, render));
  $("#launch-hud").onclick = hud;
  $("#hud-tool").onclick = hud;
  $("#oxygen-info").onclick = openOxygenInfo;
  $("#safety-info").onclick = openSafetyInfo;
  $("#credits").onclick = openAbout;
  $("#profile").onclick = openAbout;

  $("#map-search").oninput = runSearch;
  $("#map-search").onfocus = runSearch;
  $("#search-form").onsubmit = (e) => { e.preventDefault(); runSearch(); };

  $$("[data-tab]").forEach((b) => (b.onclick = () => { setTab(b.dataset.tab); if (b.dataset.tab === "planner" && innerWidth <= 700) $(".planner").scrollIntoView({ behavior: "smooth" }); }));
  $("#close-dialog").onclick = closeDialog;
  $("#dialog").addEventListener("click", (e) => {
    if (e.target !== $("#dialog")) return;
    const r = $("#dialog").getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog();
  });
  $("#dialog").addEventListener("close", () => { if (state.activeTab === "saved") setTab("planner"); });

  document.addEventListener("keydown", (e) => {
    if (hudKey(e)) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); $("#map-search").focus(); }
    if (e.key === "Escape") {
      stopPicking(); closeSuggestions();
      $("#search-results").hidden = true; $("#layer-menu").hidden = true;
      document.querySelector(".workspace").classList.remove("expanded-map");
      requestAnimationFrame(applyTransform);
    }
  });
  window.addEventListener("afterprint", () => ($("#print-root").innerHTML = ""));
  window.addEventListener("hashchange", () => { if (fromHash(location.hash)) planLoaded(); });
}

function syncInputs() {
  $("#reserve").value = state.reserve;
  $("#activity").value = String(state.activity);
  $("#round-trip").checked = state.round;
  $("#start-time").value = state.start;
  $("#dust").value = state.dust;
  $("#space-weather").value = state.weather;
}

function planLoaded() {
  if (hudActive()) closeHud();
  syncInputs();
  setView(routeScope() === "local" ? "jezero" : "global");
  requestAnimationFrame(() => focusRoute(currentRoute()));
}

// ---------- Boot ----------
const hooks = { render, setPlace, addStop, placePicked, setTab, planLoaded, savedChanged: updateSavedCount, ensureTerrain, hudActive };
initGuide(() => { const route = currentRoute(); return { route, mission: currentMission(route) }; });
initMap(hooks);
initPanels(hooks);
wire();
updateSavedCount();
onAsyncData(render);

if (fromHash(location.hash)) {
  syncInputs();
  setView(routeScope() === "local" ? "jezero" : "global");
  requestAnimationFrame(() => focusRoute(currentRoute()));
} else {
  syncInputs();
  setView("global");
}
if (window.requestIdleCallback) requestIdleCallback(ensureTerrain, { timeout: 1200 });
else setTimeout(ensureTerrain, 800);
