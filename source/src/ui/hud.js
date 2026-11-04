import { formatClock, formatHours } from "../lib/geo.js";
import { KM_PER_X, KM_PER_Y } from "../data/places.js";
import { routeRestStops } from "../plan.js";
import { guideWalkEvent } from "./guide.js";
import { SLOPE, hazardDistance } from "../model/terrain.js";
import { pointAt } from "../model/route.js";
import { routeScope, state } from "../state.js";
import { $, icon, refreshIcons, toast } from "./dom.js";
import { applyTransform, centerOn, setView } from "./map.js";

let ctx = null;
let saved = null;

export const hudActive = () => !!ctx;

// Splits the EVA into moving and dwelling segments on the mission clock.
function schedule(route, mission) {
  const scale = state.hours ? state.hours / (mission.travelHours + mission.dwellHours || 1) : 1;
  const segs = [];
  let t = 0;
  route.legs.forEach((leg, i) => {
    const dur = mission.legHours[i] ?? 0;
    segs.push({ kind: "move", leg, t0: t, t1: t + dur, next: leg.to });
    t += dur;
    const stop = state.stops[i];
    if (i < state.stops.length && stop.dwell > 0) {
      segs.push({ kind: "dwell", place: leg.to, t0: t, t1: t + stop.dwell * scale, next: route.legs[i + 1]?.to ?? leg.to });
      t += stop.dwell * scale;
    }
  });
  return { segs, total: t };
}

export function openHud(route, mission, onExit) {
  if (routeScope() !== "local") { toast("The HUD walk-through runs on Jezero surface routes. Pick two Jezero places first."); return; }
  if (!route.ready) { toast("Still reading the terrain. Try again in a moment."); return; }
  saved = { view: state.view, zoom: state.zoom, panX: state.panX, panY: state.panY };
  if (state.view !== "jezero") setView("jezero");
  const sched = schedule(route, mission);
  ctx = { route, mission, sched, restStops: routeRestStops(route, mission), t: 0, playing: true, last: performance.now(), onExit, raf: 0 };
  $("#map").classList.add("hud-on");
  $("#hud").hidden = false;
  $("#walker").hidden = false;
  buildTape();
  bind();
  frame(performance.now());
}

export function closeHud() {
  if (!ctx) return;
  cancelAnimationFrame(ctx.raf);
  const done = ctx.onExit;
  ctx = null;
  $("#map").classList.remove("hud-on");
  $("#hud").hidden = true;
  $("#walker").hidden = true;
  $("#route-walked").setAttribute("d", "");
  if (state.view !== saved.view) setView(saved.view);
  Object.assign(state, { zoom: saved.zoom, panX: saved.panX, panY: saved.panY });
  applyTransform();
  done?.();
}

function bind() {
  $("#hud-play").onclick = () => { ctx.playing = !ctx.playing; ctx.last = performance.now(); setPlayIcon(); };
  $("#hud-exit").onclick = closeHud;
  $("#hud-scrub").oninput = (e) => { ctx.t = (e.target.value / 1000) * ctx.sched.total; ctx.playing = false; setPlayIcon(); update(); };
  setPlayIcon();
}

function setPlayIcon() {
  $("#hud-play").innerHTML = icon(ctx.playing ? "pause" : "play");
  $("#hud-play").setAttribute("aria-label", ctx.playing ? "Pause the walk" : "Play the walk");
  refreshIcons();
}

export function hudKey(e) {
  if (!ctx) return false;
  if (e.key === "Escape") { closeHud(); return true; }
  if (e.key === " " && !e.target.closest("input,select,button")) { e.preventDefault(); $("#hud-play").click(); return true; }
  return false;
}

function frame(now) {
  if (!ctx) return;
  if (ctx.playing) {
    const speed = +$("#hud-speed").value;
    ctx.t += ((now - ctx.last) / 1000) * (speed / 3600);
    if (ctx.t >= ctx.sched.total) { ctx.t = ctx.sched.total; ctx.playing = false; setPlayIcon(); toast("Marswalk complete. Welcome back."); }
  }
  ctx.last = now;
  update();
  ctx.raf = requestAnimationFrame(frame);
}

function update() {
  const { route, mission, sched, t } = ctx;
  const seg = sched.segs.find((s) => t <= s.t1) ?? sched.segs[sched.segs.length - 1];
  let pos, heading = ctx.heading ?? 0, remainingKm = 0;
  if (seg.kind === "move") {
    const f = seg.t1 > seg.t0 ? (t - seg.t0) / (seg.t1 - seg.t0) : 1;
    const p = pointAt(seg.leg.path, Math.min(1, Math.max(0, f)));
    pos = p; heading = p.heading;
    remainingKm = seg.leg.km * (1 - f);
  } else {
    pos = seg.place.local;
  }
  ctx.heading = heading;

  const walker = $("#walker");
  walker.style.left = `${pos.x}%`;
  walker.style.top = `${pos.y}%`;
  walker.style.setProperty("--heading", `${heading}deg`);
  centerOn(pos, 4);
  drawWalked(route, t, sched);

  const frac = sched.total ? t / sched.total : 0;
  const used = mission.o2.base * frac;
  const o2Left = 1 - used / mission.o2.total;
  $("#hud-o2").textContent = `${Math.round(o2Left * 100)}%`;
  $("#hud-o2-bar").style.width = `${o2Left * 100}%`;
  $("#hud-o2").parentElement.classList.toggle("low", o2Left < 0.35);
  $("#hud-dose").textContent = `${(mission.radiation.doseRate * t).toFixed(3)} mSv`;
  const clock = state.start + t;
  $("#hud-temp").textContent = `${Math.round(mission.airAt(clock))} °C · ${formatClock(clock)}`;
  const toSunset = mission.daylight.sunset - clock;
  if (o2Left < 0.5) guideWalkEvent("o2-50", `Oxygen is at ${Math.round(o2Left * 100)}%. You're past the halfway mark of your supply, so check your remaining distance.`);
  if (o2Left < 0.3) guideWalkEvent("o2-30", `Oxygen is down to ${Math.round(o2Left * 100)}%. Don't add stops from here, and head straight to your destination.`, "warn");
  if (toSunset > 0 && toSunset < 1) guideWalkEvent("sunset", `Sunset is under an hour away, and it gets cold fast after dark.`, "warn");
  $("#hud-sunset").textContent = toSunset > 0 ? formatHours(toSunset) : "after dark";
  $("#hud-sunset").parentElement.classList.toggle("low", toSunset < 1);

  const next = seg.kind === "dwell" ? seg.place : seg.next;
  $("#hud-next").textContent = seg.kind === "dwell" ? `At ${next.name} · science stop` : next.name;
  $("#hud-dist").textContent = seg.kind === "dwell" ? `${formatHours(seg.t1 - t)} left here` : `${remainingKm.toFixed(2)} km`;
  $("#hud-eta").textContent = formatClock(state.start + seg.t1);
  $("#hud-elapsed").textContent = `${formatHours(t)} of ${formatHours(sched.total)}`;
  $("#hud-heading").textContent = `${String(Math.round(heading) % 360).padStart(3, "0")}°`;
  $("#hud-tape").style.transform = `translateX(${-heading * 4}px)`;
  $("#hud-scrub").value = String(Math.round(frac * 1000));

  const ahead = route.hazards
    .map((h) => ({ h: h.hazard, km: hazardDistance(h.hazard, pos) }))
    .filter((x) => x.km < 0.6)
    .sort((a, b) => a.km - b.km)[0];
  const alert = $("#hud-alert");
  const onRoute = steepAhead(route, pos);
  const stepKm = route.km / (route.samples.length - 1);
  let nearest = 0, bestD = Infinity;
  route.samples.forEach((p, i) => { const q = (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2; if (q < bestD) { bestD = q; nearest = i; } });
  const walkedKm = nearest * stepKm;
  for (const s of ctx.restStops) if (s.km - walkedKm > 0 && s.km - walkedKm < 0.25) guideWalkEvent(`rest-${s.n}`, `Rest stop ${s.n} is coming up in about ${Math.round((s.km - walkedKm) * 1000)} m: ${Math.round(s.spot.slope)}° ground. Take 10 minutes. It isn't shelter from a solar storm.`);
  for (const k of route.craters ?? []) {
    const edge = Math.hypot((k.crater.x - pos.x) * KM_PER_X, (k.crater.y - pos.y) * KM_PER_Y) * 1000 - k.crater.diameterM / 2;
    if (edge < 150) guideWalkEvent(`crater-${k.crater.id}`, `${k.crater.name ?? "A crater"} is close: ${k.crater.diameterM} m wide and ${k.crater.depthM} m deep, with walls around ${k.crater.rimSlopeDeg}°. ${k.crosses ? "The route crosses it, so watch your footing." : "Stay on the route and keep off the rim."}`, "warn");
  }
  alert.hidden = !ahead && !onRoute;
  if (onRoute) guideWalkEvent(`steep-${Math.round(onRoute.slope)}`, `Steep ground coming up: ${Math.round(onRoute.slope)}° in about ${Math.round(onRoute.km * 1000)} m. Slow down and stay close to your buddy. It will cost extra oxygen.`, "warn");
  if (seg.kind === "dwell") guideWalkEvent(`stop-${seg.place.id}`, `You've reached ${seg.place.name}. ${seg.place.science ?? "Take your time here."}`);
  if (onRoute) alert.querySelector("span").textContent = onRoute.km < 0.05 ? `Steep ground here: ${Math.round(onRoute.slope)}°. Take it slowly.` : `Steep ground in ${Math.round(onRoute.km * 1000)} m: ${Math.round(onRoute.slope)}°`;
  else if (ahead) alert.querySelector("span").textContent = ahead.km < 0.1 ? `${ahead.h.name}: right here. ${ahead.h.note}` : `${ahead.h.name}, ${Math.round(ahead.km * 1000)} m away`;
}

// Next stretch of the route over the hazard limit, within 500 m ahead.
function steepAhead(route, pos) {
  let at = 0, best = Infinity;
  route.samples.forEach((p, i) => { const d = (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2; if (d < best) { best = d; at = i; } });
  const stepKm = route.km / (route.samples.length - 1);
  for (let i = at; i < route.samples.length && (i - at) * stepKm <= 0.5; i++) {
    if (route.slopes[i] >= SLOPE.hazard) return { km: (i - at) * stepKm, slope: route.slopes[i] };
  }
  return null;
}

function drawWalked(route, t, sched) {
  const pts = [];
  for (const s of sched.segs) {
    if (s.kind !== "move" || t <= s.t0) continue;
    const f = Math.min(1, (t - s.t0) / (s.t1 - s.t0 || 1));
    const n = Math.max(2, Math.round(f * 60));
    for (let i = 0; i <= n; i++) pts.push(pointAt(s.leg.path, (f * i) / n));
  }
  $("#route-walked").setAttribute("d", pts.map((p, i) => `${i ? "L" : "M"}${(p.x * 10).toFixed(1)} ${(p.y * 10).toFixed(1)}`).join(""));
}

function buildTape() {
  const marks = [];
  for (let d = -180; d <= 540; d += 15) {
    const n = ((d % 360) + 360) % 360;
    const label = { 0: "N", 90: "E", 180: "S", 270: "W" }[n] ?? (n % 45 === 0 ? String(n) : "");
    marks.push(`<span style="left:${(d + 180) * 4}px" class="${label.length === 1 ? "cardinal" : ""}">${label || "·"}</span>`);
  }
  $("#hud-tape").innerHTML = marks.join("");
}
