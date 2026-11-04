import { geoToGlobalPct } from "../lib/geo.js";
import FRAME from "./jezero-frame.json";

// Jezero detail frame. Local places use x/y = percent of the regional image (ESA/DLR/FU Berlin, PIA24096).
// An affine fit to 8 features matched against the georeferenced CTX DEM ties the image to real coordinates
// (scripts/fit-affine.js): about 230 m RMS, about 380 m leave-one-out.
export const JEZERO = { aspect: 4096 / 3879 };
export const FRAME_ERROR_M = { fit: FRAME.fitRmsM, leaveOneOut: FRAME.leaveOneOutRmsM };
export const KM_PER_X = FRAME.kmPerPctU;
export const KM_PER_Y = FRAME.kmPerPctV;

const [fa, fb, fc, fd, fe, ff] = FRAME.affine;
const fdet = fa * fe - fb * fd;
const { originX, originY, pixelM, radiusM, stdParallelDeg } = FRAME.dem;
const mPerDegLat = (radiusM * Math.PI) / 180;
const mPerDegLon = mPerDegLat * Math.cos((stdParallelDeg * Math.PI) / 180);

export const localToGeo = ({ x, y }) => {
  const col = fa * x + fb * y + fc, row = fd * x + fe * y + ff;
  return { lat: (originY - row * pixelM) / mPerDegLat, lon: (originX + col * pixelM) / mPerDegLon };
};
export const geoToLocal = ({ lat, lon }) => {
  const col = (lon * mPerDegLon - originX) / pixelM, row = (originY - lat * mPerDegLat) / pixelM;
  return { x: (fe * (col - fc) - fb * (row - ff)) / fdet, y: (-fd * (col - fc) + fa * (row - ff)) / fdet };
};
export const localKm = (a, b) => Math.hypot((b.x - a.x) * KM_PER_X, (b.y - a.y) * KM_PER_Y);

export const LOCAL = [
  { id: "base", name: "Jezero Basecamp", subtitle: "Habitat · Starting point", x: 65.61, y: 63.06, type: "base",
    description: "Your home away from Earth. A conceptual surface habitat on the floor of Jezero Crater." },
  { id: "delta", name: "Western Delta", subtitle: "Ancient river delta", x: 46, y: 44, type: "landmark",
    description: "An ancient river once deposited layers of sediment here. One of the most compelling places to search for signs of past life.",
    science: "Sample fine-grained mudstones at the delta front, where organics are most likely to be preserved." },
  { id: "kodiak", name: "Kodiak Butte", subtitle: "Sedimentary outcrop", x: 45.8, y: 55.5, type: "landmark",
    description: "An isolated remnant of the ancient delta, with rock layers that tell the story of a long-lost Martian lake.",
    science: "Photograph the layer stack to reconstruct how the lake level changed over time." },
  { id: "belva", name: "Belva Crater", subtitle: "Impact crater · 900 m wide", x: 40.15, y: 46.73, type: "landmark",
    description: "A small impact crater within Jezero. Its exposed rock layers offer a window into the region’s history.",
    science: "Read the crater wall like a core sample: the impact exposed layers that are buried elsewhere." },
  { id: "octavia", name: "Octavia E. Butler Landing", subtitle: "Perseverance touchdown · 2021", lat: 18.4447, lon: 77.4508, type: "science",
    description: "Where NASA’s Perseverance rover touched down on 18 February 2021. A natural first stop to inspect the rover’s early worksite.",
    science: "Compare the crater-floor rocks here with Perseverance’s first samples." },
  { id: "lookout", name: "Lookout Ridge", subtitle: "Elevated observation point", x: 21.71, y: 34.18, type: "landmark",
    description: "A conceptual overlook above the western delta. A quiet place to take in the next frontier.",
    science: "Panoramic imaging of the delta and inlet channel for context mapping." },
  { id: "sample", name: "Sample Station 03", subtitle: "Research waypoint", x: 77.32, y: 48.29, type: "science",
    description: "A conceptual research waypoint for collecting and cataloging surface samples.",
    science: "Cache samples and log them with location, time and photographs." },
].map((p) => {
  if (Number.isFinite(p.lat)) Object.assign(p, geoToLocal(p));
  return { ...p, region: "jezero", ...localToGeo(p), local: { x: p.x, y: p.y } };
});

export const GLOBAL = [
  { id: "olympus", name: "Olympus Mons", subtitle: "Shield volcano · Tharsis", lat: 18.65, lon: -133.8, type: "landmark",
    description: "The enormous shield volcano of the Tharsis region, visible in the Viking global mosaic." },
  { id: "ascraeus", name: "Ascraeus Mons", subtitle: "Shield volcano · Tharsis", lat: 11.8, lon: -104.5, type: "landmark",
    description: "One of the three great volcanoes aligned along the Tharsis rise." },
  { id: "valles", name: "Valles Marineris", subtitle: "Canyon system", lat: -13.7, lon: -59.2, type: "landmark",
    description: "A vast canyon system stretching across the Martian equatorial region." },
  { id: "hellas", name: "Hellas Planitia", subtitle: "Impact basin", lat: -42.4, lon: 70.5, type: "landmark",
    description: "A huge impact basin in the southern highlands, clearly visible in the elevation layer." },
  { id: "elysium", name: "Elysium Mons", subtitle: "Volcanic province", lat: 24.8, lon: 147.3, type: "landmark",
    description: "A prominent volcano in the Elysium volcanic region." },
  { id: "gale", name: "Gale Crater", subtitle: "Curiosity landing region", lat: -5.4, lon: 137.8, type: "science",
    description: "The impact crater explored by NASA’s Curiosity rover." },
  { id: "jezero", name: "Jezero Crater", subtitle: "Perseverance landing region", lat: 18.38, lon: 77.58, type: "science",
    description: "The crater explored by Perseverance. Open Jezero detail to plan a slope-aware local excursion." },
].map((p) => ({ ...p, region: "global" }));

// NASA landing sites (published landing coordinates), shown with the "Landing sites" overlay.
export const MISSIONS = [
  { id: "viking1", name: "Viking 1", subtitle: "Chryse Planitia · 1976", lat: 22.27, lon: -47.95 },
  { id: "viking2", name: "Viking 2", subtitle: "Utopia Planitia · 1976", lat: 47.64, lon: 134.29 },
  { id: "pathfinder", name: "Mars Pathfinder", subtitle: "Ares Vallis · 1997", lat: 19.13, lon: -33.22 },
  { id: "spirit", name: "Spirit", subtitle: "Gusev Crater · 2004", lat: -14.57, lon: 175.47 },
  { id: "opportunity", name: "Opportunity", subtitle: "Meridiani Planum · 2004", lat: -1.95, lon: -5.53 },
  { id: "phoenix", name: "Phoenix", subtitle: "Vastitas Borealis · 2008", lat: 68.22, lon: -125.75 },
  { id: "curiosity", name: "Curiosity", subtitle: "Gale Crater · 2012", lat: -4.59, lon: 137.44 },
  { id: "insight", name: "InSight", subtitle: "Elysium Planitia · 2018", lat: 4.5, lon: 135.62 },
  { id: "perseverance", name: "Perseverance", subtitle: "Jezero Crater · 2021", lat: 18.44, lon: 77.45 },
].map((p) => ({ ...p, type: "mission", region: "global", description: `NASA landing site: ${p.name}, ${p.subtitle.replace(" · ", ", landed ")}.` }));

export const ALL_PLACES = [...LOCAL, ...GLOBAL];

export const placeKey = (p) => (p.region === "global" ? geoToGlobalPct(p) : p.local);

// Every data layer and where it comes from. "kind" is honest about what is measured vs modelled.
export const SOURCES = [
  { layer: "Global color basemap", source: "Viking MDIM 2.1 mosaic", mission: "NASA Viking Orbiters 1 & 2 (USGS mosaic, via JPL Mars Trek)", kind: "Measured imagery" },
  { layer: "Global elevation", source: "MOLA shaded elevation", mission: "NASA Mars Global Surveyor · Mars Orbiter Laser Altimeter (via JPL Mars Trek)", kind: "Measured topography" },
  { layer: "Global route elevation profile", source: "Height read back from the MOLA color map", mission: "Derived from MOLA", kind: "Rough estimate, under-reads high summits" },
  { layer: "Jezero regional imagery", source: "PIA24096", mission: "ESA Mars Express · HRSC (DLR/FU Berlin), NASA Image Library", kind: "Measured imagery" },
  { layer: "Jezero elevation, slope, steep zones", source: "Mars 2020 Science Investigation CTX DEM mosaic, 20 m/pixel (USGS)", mission: "NASA Mars Reconnaissance Orbiter · Context Camera", kind: "Measured topography" },
  { layer: "Map alignment (image to coordinates)", source: "Affine fit to hand-matched features and craters against the DEM", mission: "Mars Atlas", kind: "Derived, about 140 m typical error" },
  { layer: "Crater diameter, depth, rim slope", source: "Detected in the CTX DEM. Belva's rim traced at 920 m (880-1,000 m around the rim); published width 900 m", mission: "NASA MRO Context Camera", kind: "Derived from measured topography" },
  { layer: "Rest spots and sky blocked", source: "Flat ground and horizon angles from the CTX DEM", mission: "Mars Atlas", kind: "Derived. Radiation reduction is a rough upper bound" },
  { layer: "Slope limits (15°, 20°, 30°)", source: "Mission planning assumption", mission: "Mars Atlas", kind: "Illustrative" },
  { layer: "Landing sites", source: "Published landing coordinates", mission: "Viking, Pathfinder, MER, Phoenix, MSL, InSight, Mars 2020", kind: "Measured" },
  { layer: "Mars season and daylight", source: "Solar longitude and sun angle, Allison & McEwen 2000", mission: "Calculated from the mission date", kind: "Derived, flat horizon" },
  { layer: "Radiation estimate", source: "Dose vs. pressure and solar activity, Guo et al. 2015", mission: "NASA Curiosity RAD at Gale, scaled to Jezero", kind: "Derived estimate, not measured at Jezero" },
  { layer: "Potential radiation", source: "May 2024 storm, 8,100 µGy total; solar-minimum rate", mission: "NASA Curiosity RAD", kind: "Measured, used as a what-if" },
  { layer: "Temperature", source: "Average −55 °C, 50-60 °C daily swing, scaled by sunlight", mission: "NASA Perseverance MEDA", kind: "Derived estimate" },
  { layer: "Air pressure, solar cycle projection, dust effect", source: "Rough approximations", mission: "Mars Atlas", kind: "Illustrative" },
  { layer: "Suited oxygen rate and walking pace", source: "Mars Spacesuit Mass Requirements, ICES-2026-127", mission: "NASA Johnson Space Center (10 km walk-back study, Apollo)", kind: "Measured, some extrapolated" },
  { layer: "Climbing cost", source: "ACSM walking equation, adjusted for suit weight on Mars", mission: "Exercise physiology standard, not tested in a suit", kind: "Derived" },
  { layer: "Fatigue, rest, stress episodes, person spread", source: "Mission planning assumption", mission: "Mars Atlas", kind: "Illustrative" },
  { layer: "Rover speed and seated oxygen rate", source: "Mission planning assumption", mission: "Mars Atlas", kind: "Illustrative" },
  { layer: "Habitat, sample station, lookout", source: "Mission concept", mission: "Mars Atlas", kind: "Illustrative" },
];
