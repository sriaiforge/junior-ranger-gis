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
- **Distance query.** "Unvisited parks within N miles of" home (Woodinville, WA) or any place:
  1. A geodesic buffer around the starting point (`geodesicBufferOperator`): a true-distance circle on the
     ellipsoid, not a flat circle in Web Mercator, which would be distorted at this latitude.
  2. A spatial query (`intersects`) for unvisited parks inside the buffer.
  3. A geodetic distance (`geodeticDistanceOperator`) from the starting point to each result, sorted nearest
     first.
  4. A `FeatureEffect` that dims parks outside the area instead of hiding them.
- **Search near any place.** Type a city, address or park name to search from there:
  - A name that starts a Junior Ranger park's name ("Yellowstone", "Glacier") uses that park, so
    it isn't confused with a town of the same name.
  - Anything else is geocoded with the ArcGIS World Geocoding Service (`locator.addressToLocations`).
  - Leave the box blank to search from home.
- **Washington DNR open data.** Two live layers from DNR's public ArcGIS Server, used directly
  (nothing copied into this repo):
  - **Recreation sites** (219 campgrounds, trailheads, huts and day-use areas): a `FeatureLayer`
    with popups.
  - **State trust lands** (13,500+ parcels): a `MapImageLayer` that DNR's server renders. Popups
    show the trust (e.g. Common School), county and DNR region.
  - The nearby search also sends its search circle to DNR's server as a **server-side spatial
    query** and lists the DNR recreation sites inside it, nearest first. For example, 54 within
    60 miles of Woodinville.
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
scripts/fetch_parks.py ──► public/data/parks.geojson ──────────┐
                                                               ├─► src/parks.ts (merge) ─► GeoJSONLayer
ArcGIS hosted feature layer ─┐                                 │
  (fallback: visited.json) ──┴─► src/visited.ts ───────────────┘
```

| File | Purpose |
| --- | --- |
| `scripts/fetch_parks.py` | NPS API → GeoJSON (standard library only) |
| `scripts/export_visits.py` | Visit list → GeoJSON points for publishing as a hosted layer |
| `src/visited.ts` | The only module that knows where visited status is stored (hosted layer or JSON) |
| `src/parks.ts` | Joins visits onto park features |
| `src/map.ts` | Map, basemap, layer, renderer, pop-up |
| `src/analysis.ts` | Buffer, spatial query, distance |
| `src/geocode.ts` | Place name → point (park names, then ArcGIS geocoding) |
| `src/dnr.ts` | Washington DNR layers and the server-side nearby query |
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
  Place search works either way: with a key it uses the current geocoding service, and without one
  it uses the public World Geocoder endpoint, which allows anonymous searches that aren't stored.

## Spatial SQL with PostGIS

The same parks are also loaded into a local **PostgreSQL 17 + PostGIS 3** database (Docker), where
the analysis runs as SQL. The live site doesn't use the database (GitHub Pages only serves static
files); this part shows the data modeling and spatial SQL side.

```bash
npm run db:up       # build and start the database (Docker; db/Dockerfile)
npm run db:load     # load parks.geojson + visited.json (scripts/load_db.py)
npm run db:queries  # run db/queries.sql
npm run db:psql     # interactive SQL shell
npm run db:down     # stop it
```

On a Mac without Docker Desktop, [Colima](https://github.com/abiosoft/colima) works:
`brew install colima docker docker-compose && colima start`.

**Schema** ([db/schema.sql](db/schema.sql)): `parks` stores each park's location as
`geography(Point, 4326)`, so distances are true meters on the WGS84 ellipsoid. A GiST index covers
that column. `visits` has a foreign key to `parks`, and a `park_status` view joins the two.

**Queries** ([db/queries.sql](db/queries.sql)):

| # | Question | PostGIS features |
| --- | --- | --- |
| 1 | Unvisited parks within 300 miles of home, nearest first | `ST_DWithin`, `ST_Distance` on `geography` |
| 2 | Progress by state | `unnest` of a `text[]` column, `FILTER` aggregates |
| 3 | Nearest unvisited park to each visited park | `CROSS JOIN LATERAL` + KNN `<->` operator |
| 4 | Road-trip clusters of unvisited parks | `ST_Transform` to EPSG:5070, `ST_ClusterDBSCAN` |
| 5 | Does query 1 use the spatial index? | `EXPLAIN` → `Bitmap Index Scan on parks_location_gix` |

Query 1 returns the same 9 parks and distances as the browser-side analysis on the live map:

```
                    name                    |     states     | miles
--------------------------------------------+----------------+-------
 Ebey's Landing National Historical Reserve | WA             |    40
 Mount Rainier National Park                | WA             |    65
 San Juan Island National Historical Park   | WA             |    67
 Olympic National Park                      | WA             |    70
 Fort Vancouver National Historic Site      | OR, WA         |   149
 ...
```

Query 4 finds trip-sized groups, for example Mount Rushmore + Badlands + Jewel Cave + Wind Cave,
or Mesa Verde + Hovenweep + Aztec Ruins. DBSCAN groups parks that are each within 50 miles of another
park in the group. It needs planar coordinates, so the points are first projected to USA
Contiguous Albers Equal Area.

## Mark a park as visited

The visit list lives in an **ArcGIS hosted feature layer** ("Junior Ranger visits"), one point
per visited park with fields `park_code`, `park_name`, `visited_on` and `note`. The site reads it
when the page loads, so adding a visit in ArcGIS shows up on the map **without a redeploy**.

- **Add a visit:** open the layer in ArcGIS Map Viewer, add a point at the park, and fill in
  `park_code` (the park's 4-letter NPS code, also in its nps.gov URL, e.g. `mora`).
- **Access:** free ArcGIS Location Platform layers can't be shared publicly, so the site reads
  the layer with the same referrer-restricted API key it uses for the basemap. That key was
  granted read access to this one item.
- **Config:** the layer URL is the repo variable `VITE_VISITS_LAYER_URL` (not a secret), ending
  in `/FeatureServer/0`.

**Fallback:** if `VITE_VISITS_LAYER_URL` isn't set or the layer can't be reached, the site uses
`public/data/visited.json`. The page footer says which source it used.

```json
{
  "visits": [
    { "parkCode": "mora", "date": "2023-08-12", "note": "Got the badge at Paradise" }
  ]
}
```

To publish a new layer from the JSON list, run `python3 scripts/export_visits.py` and upload
`exports/visits.geojson` in ArcGIS as a hosted feature layer.

## Deploy (GitHub Pages)

1. Commit `public/data/parks.geojson` after running `npm run data`.
2. Push to GitHub. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Optional: add a repo **secret** `VITE_ARCGIS_API_KEY` (Esri basemap, geocoding, hosted layer
   access) and a repo **variable** `VITE_VISITS_LAYER_URL` (hosted visits layer).
4. Each push to `main` runs `.github/workflows/deploy.yml`. After editing visits in ArcGIS,
   no deploy is needed.

## Roadmap

- [x] Load the parks into **PostGIS** and run the distance query in SQL (`ST_DWithin` on `geography`)
- [ ] Serve the PostGIS query live (e.g. a Supabase function) with a fallback to the browser query
- [x] Move visited status to an **ArcGIS hosted feature layer**
- [ ] Check in from the field with **ArcGIS Field Maps** or **Survey123**
- [x] Group nearby unvisited parks into road trips (DBSCAN clustering, in SQL)
- [ ] Show the road-trip clusters on the map
- [x] Add **Washington DNR** open data: state trust lands, recreation sites
- [ ] Add DNR wildfire risk data
- [ ] Automated accessibility checks (axe) in CI

## Data and credits

- Park data: [NPS Data API](https://www.nps.gov/subjects/developer/api-documentation.htm)
  (public domain U.S. government data).
- Washington DNR recreation sites and managed lands: [Washington State Department of Natural
  Resources](https://dnr.wa.gov/) public GIS services (provided "as is").
- Map: [ArcGIS Maps SDK for JavaScript](https://developers.arcgis.com/javascript/latest/), Esri.
- Basemap: Esri or © OpenStreetMap contributors.
