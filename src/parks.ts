import { PARKS_URL } from "./config";
import type { Visit } from "./visited";

export interface Park {
  parkCode: string;
  name: string;
  designation: string;
  states: string;
  url: string;
  longitude: number;
  latitude: number;
  visited: boolean;
  visitDate: string;
}

interface ParkFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, string | number>;
}

interface ParkCollection {
  type: "FeatureCollection";
  features: ParkFeature[];
}

export interface ParkData {
  parks: Park[];
  /** GeoJSON with `visited` (1/0) and `visitDate` added, for the map layer. */
  geojson: ParkCollection;
}

export async function loadParks(visits: Map<string, Visit>): Promise<ParkData> {
  const response = await fetch(PARKS_URL);
  if (!response.ok) {
    throw new Error(`Could not load park data (${response.status})`);
  }
  const source = (await response.json()) as ParkCollection;

  const features = source.features.map((feature): ParkFeature => {
    const code = String(feature.properties.parkCode).toLowerCase();
    const visit = visits.get(code);
    return {
      ...feature,
      properties: {
        ...feature.properties,
        visited: visit ? 1 : 0,
        visitDate: visit?.date ?? "",
      },
    };
  });

  const parks = features.map(({ geometry, properties: p }) => ({
    parkCode: String(p.parkCode),
    name: String(p.name),
    designation: String(p.designation ?? ""),
    states: String(p.states ?? ""),
    url: String(p.url ?? ""),
    longitude: geometry.coordinates[0],
    latitude: geometry.coordinates[1],
    visited: p.visited === 1,
    visitDate: String(p.visitDate),
  }));

  return { parks, geojson: { type: "FeatureCollection", features } };
}
