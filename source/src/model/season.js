// Mission date → Mars season, daylight, temperature and radiation estimates at Jezero.
// Astronomy: Allison & McEwen (2000) solar longitude. Radiation: Guo et al. (2015), RAD at Gale.
// Temperature: anchored to Perseverance MEDA (average −55 °C, 50-60 °C daily swing), scaled by calculated sunlight.
const D2R = Math.PI / 180;
const JEZERO_LAT = 18.4;

export function solarLongitude(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const d = jd + 69.184 / 86400 - 2451545; // days since J2000 (TT)
  const M = 19.3871 + 0.52402073 * d;
  const alpha = 270.3871 + 0.524038496 * d;
  const sinM = (k) => Math.sin(k * M * D2R);
  const eqCenter = (10.691 + 3e-7 * d) * sinM(1) + 0.623 * sinM(2) + 0.05 * sinM(3) + 0.005 * sinM(4) + 0.0005 * sinM(5);
  return ((alpha + eqCenter) % 360 + 360) % 360;
}

const SEASONS = ["Northern spring", "Northern summer", "Northern autumn", "Northern winter"];

// Sunlight at local noon relative to the annual average, from solar distance and sun height.
function noonSun(ls) {
  const dec = Math.asin(0.42565 * Math.sin(ls * D2R));
  const r = (1 - 0.0934 ** 2) / (1 + 0.0934 * Math.cos((ls - 251) * D2R));
  return { dec, value: Math.cos(JEZERO_LAT * D2R - dec) / r ** 2 };
}
const ANNUAL = Array.from({ length: 36 }, (_, i) => noonSun(i * 10).value).reduce((s, v) => s + v, 0) / 36;

// Approximate seasonal shape with the known low near Ls 150 and high near Ls 255. Peak-to-peak 25%, per RAD/REMS at Gale.
function pressurePa(ls) {
  const shape = 0.6 * Math.cos((ls - 255) * D2R) + 0.4 * Math.cos((2 * ls - 480) * D2R);
  const GALE_MEAN = 840, JEZERO_FACTOR = Math.exp(-1.8 / 11); // Jezero sits about 1.8 km above Gale; scale height about 11 km
  return { gale: GALE_MEAN, jezero: GALE_MEAN * JEZERO_FACTOR * (1 + 0.125 * shape) };
}

// Solar cycle phase is a rough projection: 11-year period from the 2024-25 maximum. Real cycles vary.
// The 250-800 MV range is set so a 2012-13 date reproduces RAD's measured 0.64 mSv/day to within about 10%.
function solarModulation(date) {
  const year = date.getUTCFullYear() + date.getUTCMonth() / 12;
  return 525 + 275 * Math.cos((2 * Math.PI * (year - 2024.8)) / 11);
}

export const STORM_UGY = 8100; // May 2024 event total, Curiosity RAD: the largest it has measured
const STORM_Q = 1.5; // assumption: storm protons weigh less per gray than cosmic rays

export function seasonFor(dateStr) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  const ls = solarLongitude(date);
  const { dec, value } = noonSun(ls);
  const sun = value / ANNUAL;
  const cosH = -Math.tan(JEZERO_LAT * D2R) * Math.tan(dec);
  const halfDay = Math.acos(Math.max(-1, Math.min(1, cosH))) / D2R / 15;

  const p = pressurePa(ls);
  // Dose(X) = D₀ × e^(−μX), X = air overhead in g/cm² = pressure ÷ Mars gravity. μ = 0.022 cm²/g matches
  // RAD's measured −0.13 µGy/day per Pa at Gale (Guo et al. 2015), so this only rescales Gale's measured dose.
  const MU = 0.022, column = (pa) => pa / 3.71 / 10;
  const pressureScale = Math.exp(-MU * (column(p.jezero) - column(p.gale)));
  const phi = solarModulation(date);
  // Dose equivalent: about 0.35 mSv/day at Φ≈1100 MV, up to 1.15 mSv/day at Φ≈250 MV (Guo et al. 2015).
  const eqAt = (f) => 1.15 - ((Math.max(250, Math.min(1100, f)) - 250) / 850) * 0.8;
  return {
    ls, season: SEASONS[Math.floor(ls / 90) % 4], sun, sunrise: 12 - halfDay, sunset: 12 + halfDay, pressurePa: p.jezero, phi,
    columnGcm2: column(p.jezero), galeColumnGcm2: column(p.gale), thinAirExtraPct: (pressureScale - 1) * 100,
    doseMsvPerDay: eqAt(phi) * pressureScale,
    doseHighMsvPerDay: 1.15 * pressureScale,
    gyPerSv: 0.21 / 0.64,
    meanC: -55 + 8 * (sun - 1),
    swingC: 55 * sun,
    stormMsv: (STORM_UGY / 1000) * STORM_Q,
  };
}

export function airTempC(hour, dust, s) {
  const h = ((hour % 24) + 24) % 24;
  const damp = { clear: 1, hazy: 0.8, storm: 0.55 }[dust] ?? 1;
  const hi = 14.5, lo = s.sunrise - 0.5;
  let u; // 0 at the coldest hour, 1 at the warmest
  if (h >= lo && h <= hi) u = (1 - Math.cos((Math.PI * (h - lo)) / (hi - lo))) / 2;
  else { const since = h > hi ? h - hi : h + 24 - hi; u = 1 - (1 - Math.cos((Math.PI * since) / (24 - hi + lo))) / 2; }
  return s.meanC + (u - 0.5) * s.swingC * damp;
}
