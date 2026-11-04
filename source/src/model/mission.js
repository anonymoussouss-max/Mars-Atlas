import { formatClock, formatHours } from "../lib/geo.js";
import { airTempC, seasonFor } from "./season.js";
import { crewBounds } from "./crater.js";
import { EXPEDITION, simulateSpread, simulateTrip, walkBackKm, walkBackLiters } from "./physiology.js";

export const EVA_LIMIT_H = 8;
export const EVA_CAUTION_H = 6.5;

export const CAREER_LIMIT_MSV = 600; // NASA-STD-3001 (2022) career effective-dose limit
const WEATHER = {
  quiet: { factor: 1, label: "Quiet" },
  elevated: { factor: 2, label: "Elevated" },
  spe: { factor: 1, label: "Solar storm" },
};
const DUST = {
  clear: { tau: 0.5, label: "Clear", sky: "Clear skies" },
  hazy: { tau: 1.5, label: "Hazy", sky: "Dusty haze" },
  storm: { tau: 4, label: "Dust storm", sky: "Dust storm" },
};

export function evaluateMission({ legs, stops, mode, crew, effort, reserve, hoursOverride, start, dust, weather, scope, maxFromBaseKm, maxSlope, date }) {
  const season = seasonFor(date);
  const SUNRISE = season.sunrise, SUNSET = season.sunset;
  const trip = simulateTrip(legs, stops, mode, effort);
  const expedition = scope === "global" && trip.hours > EVA_LIMIT_H;
  const scale = hoursOverride && trip.hours > 0 ? hoursOverride / trip.hours : 1;
  const hours = hoursOverride ?? trip.hours;

  const sols = expedition ? Math.ceil(trip.moving / EXPEDITION.driveHoursPerSol) : 0;
  const base = expedition ? crew * sols * EXPEDITION.o2KgPerPersonSol * EXPEDITION.litersPerKg : trip.liters * scale * crew;
  const extra = (base * reserve) / 100;
  const total = base + extra;
  const litersPerHour = hours > 0 ? base / crew / hours : 0;
  const reserveHours = litersPerHour > 0 ? extra / crew / litersPerHour : 0;
  const walkBack = walkBackKm(extra, crew);
  // Oxygen for each crater zone the route passes through, from the same pace, slope and fatigue model.
  const craters = expedition ? [] : Object.entries(trip.crater).map(([id, k]) => {
    const perPerson = k.liters * scale, b = crewBounds(perPerson, crew);
    return { id, km: k.km, hours: k.hours * scale, ascentM: k.ascentM, descentM: k.descentM, maxGradePct: k.maxGrade * 100, liters: perPerson * crew, low: b.p5, high: b.p95 };
  });
  const craterLiters = craters.reduce((s, k) => s + k.liters, 0);

  const spread = expedition ? null : simulateSpread(base / crew, hours, crew, total);
  const ceil5 = (pct) => Math.max(10, Math.ceil(pct / 5) * 5);
  const statReserve = spread ? ceil5((spread.p95 / base - 1) * 100) : reserve;
  // On a rover trip the real worst case is a breakdown at the far point, so the reserve must cover the walk home.
  const roverReserve = mode === "rover" && maxFromBaseKm != null && base > 0 ? ceil5((walkBackLiters(maxFromBaseKm, crew) / base) * 100) : 0;
  const recommendedReserve = Math.max(statReserve, roverReserve);

  const wx = WEATHER[weather];
  const doseRate = (season.doseMsvPerDay / 24) * wx.factor;
  const exposureHours = expedition ? sols * 24.66 : hours;
  const stormNow = weather === "spe" ? season.stormMsv : 0;
  const dose = doseRate * exposureHours + stormNow;
  const potentialDose = (season.doseHighMsvPerDay / 24) * exposureHours + season.stormMsv;

  const end = start + hours;
  const sunsetMargin = SUNSET - end;
  const temps = Array.from({ length: 13 }, (_, i) => airTempC(start + (hours * i) / 12, dust, season));
  const tMin = Math.min(...temps), tMax = Math.max(...temps);

  const checks = [];
  const add = (level, text) => checks.push({ level, text });

  if (expedition && mode === "walk") {
    add("nogo", `${Math.round(trip.hours).toLocaleString()} hours on foot is impossible in a spacesuit. Switch to a pressurized rover.`);
  } else if (expedition) {
    add("caution", `Planet-scale route: about ${sols} sols at ${EXPEDITION.driveHoursPerSol} h of driving per sol. Plan it as a pressurized-rover expedition, not a single EVA.`);
  } else {
    if (hours > EVA_LIMIT_H) add("nogo", `EVA lasts ${formatHours(hours)}, beyond the ${EVA_LIMIT_H} h suit limit. Add a rover leg or split the walk.`);
    else if (hours > EVA_CAUTION_H) add("caution", `Long EVA (${formatHours(hours)}). Plan a consumables check at the halfway point.`);
    else add("go", `EVA duration ${formatHours(hours)} is within the ${EVA_LIMIT_H} h suit limit.`);

    if (start < SUNRISE) add("caution", `Starts before sunrise (${formatClock(SUNRISE)}). Lighting and temperatures are at their worst.`);
    if (sunsetMargin < -1) add("nogo", `Returns ${formatHours(-sunsetMargin)} after sunset. Start earlier or shorten the route.`);
    else if (sunsetMargin < 0.75) add("caution", `Only ${sunsetMargin < 0 ? "no" : formatHours(sunsetMargin)} daylight margin before sunset.`);
    else add("go", `Back ${formatHours(sunsetMargin)} before sunset.`);

    if (tMin < -70) add("caution", `Air drops to ${Math.round(tMin)} °C during the EVA. Check suit heater margins.`);

    if (spread) {
      if (spread.coverage < 0.95) add("caution", `A ${reserve}% reserve covers ${Math.round(spread.coverage * 100)}% of simulated walks. Carry about ${recommendedReserve}% to cover 95%.`);
      else add("go", `A ${reserve}% reserve covers ${Math.round(spread.coverage * 100)}% of simulated walks, including stress and fatigue.`);
    }
    if (mode === "walk") {
      if (trip.peakEffort > 0.5) add("caution", `Effort peaks at ${Math.round(trip.peakEffort * 100)}% of VO₂max, past the 50% sustained limit for trained crew.`);
    }
  }

  if (maxSlope >= 20) add("caution", `Route has to cross ${Math.round(maxSlope)}° ground, over the 20° hazard limit. Take that stretch slowly and stay close to your buddy.`);
  else if (maxSlope > 0) add("go", `Steepest ground on the route is ${Math.round(maxSlope)}°, under the 20° hazard limit.`);

  if (crew < 2) add("caution", "Solo EVA. Surface walks are planned in pairs so each crew member has a buddy.");
  else add("go", `${crew} crew members: buddy system in place.`);

  if (dust === "storm") add("nogo", "Dust storm: low visibility and reduced solar power. Stay in the habitat.");
  else if (dust === "hazy") add("caution", "Hazy sky: reduced visibility at range and lower solar power.");

  if (weather === "spe") add("nogo", "Solar particle event in progress. Shelter in the habitat until the alert clears.");
  else if (weather === "elevated") add("caution", "Elevated space weather. Keep the route close to shelter.");
  else add("go", `Radiation estimate ${dose.toFixed(dose < 1 ? 3 : 1)} mSv for this ${expedition ? "trip" : "walk"}. It could reach about ${potentialDose.toFixed(1)} mSv in a storm like May 2024.`);

  if (mode === "rover" && maxFromBaseKm != null) {
    if (maxFromBaseKm > walkBack) add("caution", `Rover goes ${maxFromBaseKm.toFixed(1)} km from base, beyond the ${walkBack.toFixed(1)} km walk-back radius. To survive a breakdown there, carry about ${roverReserve}% reserve.`);
    else add("go", `Rover stays inside the ${walkBack.toFixed(1)} km walk-back radius.`);
  }

  const status = checks.some((c) => c.level === "nogo") ? "nogo" : checks.some((c) => c.level === "caution") ? "caution" : "go";
  const travelHours = (trip.moving + trip.resting) * scale;
  return {
    hours, travelHours, dwellHours: trip.dwelling * scale, legHours: trip.legHours.map((h) => h * scale), sols,
    o2: { base, extra, total, reserveHours, walkBackKm: walkBack, craters, craterLiters, otherLiters: base - craterLiters },
    human: {
      avgKmh: trip.moving > 0 ? legs.reduce((s, l) => s + l.km, 0) / trip.moving : 0, peakEffort: trip.peakEffort, peakFatigue: trip.peakFatigue,
      rests: trip.rests, restAtKm: trip.restAtKm, restHours: trip.resting, litersPerMinute: litersPerHour / 60, spread, recommendedReserve,
    },
    radiation: { dose, doseRate, potential: potentialDose, weather: wx.label, careerShare: dose / CAREER_LIMIT_MSV,
      columnGcm2: season.columnGcm2, galeColumnGcm2: season.galeColumnGcm2, thinAirExtraPct: season.thinAirExtraPct },
    daylight: { start, end, sunsetMargin, sunrise: SUNRISE, sunset: SUNSET },
    temps: { min: tMin, max: tMax, now: airTempC(start, dust, season) },
    airAt: (h) => airTempC(h, dust, season),
    season, dust: DUST[dust], expedition, checks, status,
  };
}
