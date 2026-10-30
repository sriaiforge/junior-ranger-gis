/** App settings. Home is a city center, not a street address. */
export const HOME = {
  name: "Woodinville, WA",
  longitude: -122.1635,
  latitude: 47.7543,
};

export const DEFAULT_RADIUS_MILES = 300;

const base = import.meta.env.BASE_URL;
export const PARKS_URL = `${base}data/parks.geojson`;
export const VISITED_URL = `${base}data/visited.json`;

/** Optional. Without a key the map falls back to the OpenStreetMap basemap. */
/**
 * Optional. ArcGIS hosted feature layer with the visit list (fields: park_code, visited_on, note).
 * Falls back to public/data/visited.json when unset or unreachable.
 */
export const VISITS_LAYER_URL: string | undefined = import.meta.env.VITE_VISITS_LAYER_URL || undefined;

export const ARCGIS_API_KEY: string | undefined = import.meta.env.VITE_ARCGIS_API_KEY || undefined;
