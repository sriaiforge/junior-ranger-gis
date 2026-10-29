import Point from "@arcgis/core/geometry/Point.js";
import * as locator from "@arcgis/core/rest/locator.js";
import { ARCGIS_API_KEY } from "./config";
import type { Park } from "./parks";

// With an API key, use the current ArcGIS geocoding service. Without one, use the
// public World Geocoder endpoint, which allows anonymous search (results not stored).
const GEOCODE_URL = ARCGIS_API_KEY
  ? "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer"
  : "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

export interface Place {
  point: Point;
  label: string;
}

/**
 * Turns a place name, address or park name into a point. Returns null if nothing matches.
 *
 * Park names are checked first, so "Yellowstone" means the national park rather than
 * the town of Yellowstone, Indiana. Everything else goes to the geocoder.
 */
export async function findPlace(text: string, parks: Park[]): Promise<Place | null> {
  const query = text.trim();
  if (!query) return null;

  const park = parkStartingWith(query, parks);
  if (park) return park;

  try {
    const [candidate] = await locator.addressToLocations(GEOCODE_URL, {
      address: { SingleLine: query },
      maxLocations: 1,
      forStorage: false,
    });
    if (candidate?.location && (candidate.score ?? 0) >= 80) {
      return { point: candidate.location, label: candidate.address ?? query };
    }
  } catch (error) {
    console.warn("Geocoding failed; trying park names instead.", error);
  }

  return parkContaining(query, parks);
}

function toPlace(park: Park): Place {
  return {
    point: new Point({ longitude: park.longitude, latitude: park.latitude }),
    label: park.name,
  };
}

/** The shortest park name that starts with the text ("Glacier" → Glacier National Park). */
function parkStartingWith(query: string, parks: Park[]): Place | null {
  if (query.length < 4) return null;
  const q = query.toLowerCase();
  const matches = parks
    .filter((p) => p.name.toLowerCase().startsWith(q))
    .sort((a, b) => a.name.length - b.name.length);
  return matches[0] ? toPlace(matches[0]) : null;
}

/** Last resort when the geocoder finds nothing: any park whose name contains the text. */
function parkContaining(query: string, parks: Park[]): Place | null {
  const q = query.toLowerCase();
  const match = parks.find((p) => p.name.toLowerCase().includes(q));
  return match ? toPlace(match) : null;
}
