# Junior Ranger Map

An interactive map of the National Park Service sites that offer a
[Junior Ranger program](https://www.nps.gov/kids/become-a-junior-ranger.htm), showing which ones I've
visited and which unvisited parks are within driving range of home.

**This is a personal learning project.** I built it to learn the ArcGIS Maps SDK for JavaScript,
GeoJSON and spatial analysis, drawing on my background in TypeScript and accessibility.

**Live map:** https://sriaiforge.github.io/junior-ranger-gis/

## Features

- **NPS data pipeline.** A Python script uses the NPS Data API to find every park with the
  "Junior Ranger Program" activity, joins in each park's coordinates, and writes GeoJSON.
- **ArcGIS map.** The ArcGIS Maps SDK for JavaScript (5.x) draws the parks as a `GeoJSONLayer` with a
  `UniqueValueRenderer` and pop-ups built with Arcade expressions.
- **Visited / not visited filter.** Uses a client-side `FeatureFilter` on the layer view, plus a
  search by park name or state.
- **Distance query.** "Unvisited parks within N miles of Woodinville, WA":
  1. A geodesic buffer around home (`geodesicBufferOperator`): a true-distance circle on the
     ellipsoid, not a flat circle in Web Mercator, which would be distorted at this latitude.
  2. A spatial query (`intersects`) for unvisited parks inside the buffer.
  3. A geodetic distance (`geodeticDistanceOperator`) from home to each result, sorted nearest
     first.
  4. A `FeatureEffect` that dims parks outside the area instead of hiding them.
- **Accessibility (WCAG 2.2 AA target).**
  - Every map feature is also in an HTML list, so the map isn't the only way to get the information.
  - Visited and unvisited parks differ by shape (circle vs. diamond), not only by color (1.4.1).
  - Filter and search results are announced in a `role="status"` live region.
  - A skip link moves keyboard focus to the park list, and every control has a visible focus ring.
  - Real `<label>`, `<fieldset>` and `<legend>` markup.
  - Motion is reduced when the user asks for it (`prefers-reduced-motion`).
  - The layout reflows to a single column on narrow screens.

## How it works

```
scripts/fetch_parks.py ──► public/data/parks.geojson ─┐
                                                      ├─► src/parks.ts (merge) ─► GeoJSONLayer
public/data/visited.json ──► src/visited.ts ──────────┘
```

| File | Purpose |
| --- | --- |
| `scripts/fetch_parks.py` | NPS API → GeoJSON (standard library only) |
| `src/visited.ts` | The only module that knows where visited status is stored |
| `src/parks.ts` | Joins visits onto park features |
| `src/map.ts` | Map, basemap, layer, renderer, pop-up |
| `src/analysis.ts` | Buffer, spatial query, distance |
| `src/main.ts` | UI: filters, list, live-region messages |
| `src/config.ts` | Home location, default radius |

The NPS API key is used only by the Python script and never reaches the browser.

## Run it locally

Requires Node 20+ and Python 3.10+.

```bash
npm install
cp .env.example .env   # then add your keys
npm run data           # fetch parks into public/data/parks.geojson
npm run dev
```

- **NPS key (required to fetch data):** free from the
  [NPS developer site](https://www.nps.gov/subjects/developer/get-started.htm).
- **ArcGIS key (optional):** with a free [ArcGIS Location Platform](https://location.arcgis.com/sign-up/)
  account, the map uses the Esri "Outdoor" basemap. Without one, it falls back to OpenStreetMap.
  Restrict the key to your site's URL, because browser keys are visible to anyone who views the page.

## Mark a park as visited

Add the park's 4-letter NPS code (the `parkCode` in `parks.geojson`, also in its nps.gov URL)
to `public/data/visited.json`:

```json
{
  "visits": [
    { "parkCode": "mora", "date": "2023-08-12", "note": "Got the badge at Paradise" }
  ]
}
```

## Deploy (GitHub Pages)

1. Commit `public/data/parks.geojson` after running `npm run data`.
2. Push to GitHub. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Optional: add a repo secret `VITE_ARCGIS_API_KEY`.
4. Each push to `main` runs `.github/workflows/deploy.yml`.

## Roadmap

- [ ] Load the parks into **PostGIS** and run the distance query in SQL (`ST_DWithin` on `geography`)
- [ ] Move visited status to an **ArcGIS Online hosted feature layer**
- [ ] Check in from the field with **ArcGIS Field Maps** or **Survey123**
- [ ] Group nearby unvisited parks into road trips (DBSCAN clustering)
- [ ] Add **Washington DNR** open data: state trust lands, recreation sites, wildfire risk
- [ ] Automated accessibility checks (axe) in CI

## Data and credits

- Park data: [NPS Data API](https://www.nps.gov/subjects/developer/api-documentation.htm)
  (public domain U.S. government data).
- Map: [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/latest/), Esri.
- Basemap: Esri or © OpenStreetMap contributors.
