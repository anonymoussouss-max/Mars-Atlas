# Mars Atlas

A layered, integrated map for planning a Marswalk: NASA imagery and topography, a hazard-aware route planner, life-support and radiation budgets, a go/no-go check, a helmet HUD walk-through and a printable EVA briefing.

## Run it

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # dist/ — separate, cacheable images
npm run build:single   # dist-single/index.html — one self-contained file to share or submit
npm run images         # re-create the WebP maps from scripts/source-images
```

## What it does

- **Two map scales.** Global Mars (Viking color + MOLA elevation, NASA landing sites) and Jezero Crater detail (HRSC regional image, aligned to the CTX elevation mosaic).
- **Slope-aware routing.** Jezero routes are least-cost paths (A*) over real slopes from the CTX elevation mosaic, summarized on a grid of about 95 m. Steep zones are found from the data. Walking and rover modes have different slope limits.
- **Science stops.** Up to four waypoints with dwell times; the timeline, oxygen and daylight checks include them.
- **Profiles.** Real elevation, climb and steepest slope along Jezero routes; approximate MOLA elevation along global great-circle routes.
- **Safety.** Oxygen with reserve, walk-back radius (how far the crew could walk home on reserve O₂), radiation dose from Curiosity RAD’s measured surface rate, daylight window, temperature, dust and space weather, all rolled into a GO / CAUTION / NO-GO check.
- **Helmet HUD.** Plays the EVA along the route: compass, O₂ remaining, dose, temperature, sunset countdown, next waypoint and hazard alerts.
- **Approach view.** Each Jezero place has a synthetic ground-level perspective built from the orbital image.
- **Briefing and sharing.** Print or save a one-page EVA briefing; share links reproduce the exact plan.

## Project layout

```
src/
  data/places.js      places, Jezero frame (image % ↔ lat/lon), hazards, landing sites, data sources
  model/terrain.js    terrain grid from the Jezero image, hazard costs, traversability layer
  model/route.js      A* routing, smoothing, route statistics
  model/elevation.js  elevation read back from the MOLA color map
  model/mission.js    oxygen, radiation, daylight, temperature, go/no-go rules
  plan.js             builds the current route and mission (cached)
  state.js            plan state, share links, saved missions
  ui/                 map, HUD, panels/dialogs, profile chart, DOM helpers
  styles/base.css     the original Mars Atlas design
  styles/features.css new features and polish
```

## Turning on the AI guide

Atlas's briefings and walk warnings work without AI. Typed questions use Groq (`openai/gpt-oss-120b`) through `api/guide.js`:

1. Deploy this folder to Vercel. Set the environment variable `GROQ_API_KEY`. Never put the key in the page or in the repo.
2. To upgrade later, set `GUIDE_MODEL` to another model id.
3. If the page is hosted elsewhere, build it with `VITE_GUIDE_API` set to the full URL of the function.

## Rebuilding the terrain

Download the public-domain [CTX DEM mosaic](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic) (87 MB, kept out of this repo). Then:

```bash
node scripts/fit-affine.js scripts/jezero-control-points.json frame.json   # image % to DEM pixels, from 8 matched features
node scripts/build-terrain.js <dem.tif> frame.json                         # writes src/data/terrain-grid.js and jezero-frame.json
node scripts/check-frame.js <dem.tif> scripts/source-images/jezero-terrain.jpg frame.json check.png 0 25 100 95   # visual check
```

## Data honesty

Measured: Viking MDIM 2.1 mosaic, MOLA topography, HRSC Jezero image (ESA/DLR/FU Berlin), CTX elevation mosaic at 20 m per pixel, landing coordinates, Curiosity RAD dose rate (0.64 mSv/day, Hassler et al., *Science* 2014). Derived: the image-to-coordinates alignment (about 230 m RMS, 380 m leave-one-out) and the global MOLA elevation read-back (rough, under-reads high summits). Sourced from NASA ICES-2026-127: suited oxygen rates at speed, walking paces, VO2max limits, crew and suit mass. Illustrative: slope limits, habitat, temperature/daylight/dust model, fatigue drift, rest schedule, stress episodes, person-to-person spread, rover speed and seated rate. Rocks and soft sand are not mapped yet. The in-app “Data sources” dialog lists every layer. Not for real mission planning.
