import Point from "@arcgis/core/geometry/Point.js";
import type Polygon from "@arcgis/core/geometry/Polygon.js";
import type GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import * as geodesicBufferOperator from "@arcgis/core/geometry/operators/geodesicBufferOperator.js";
import * as geodeticDistanceOperator from "@arcgis/core/geometry/operators/geodeticDistanceOperator.js";
import { HOME } from "./config";

export const homePoint = new Point({ longitude: HOME.longitude, latitude: HOME.latitude });

export interface NearbyResult {
  buffer: Polygon;
  /** Park codes of unvisited parks inside the buffer, mapped to miles from the origin. */
  distances: Map<string, number>;
}

/**
 * Finds unvisited parks within `miles` of a point (home, or a searched place).
 *
 * 1. Build a geodesic buffer (a true-distance circle on the ellipsoid) around the point.
 * 2. Spatial query: unvisited park points that intersect the buffer.
 * 3. Geodetic distance from the point to each result, for sorting.
 */
export async function findUnvisitedNearby(
  layer: GeoJSONLayer,
  origin: Point,
  miles: number,
): Promise<NearbyResult> {
  await Promise.all([geodesicBufferOperator.load(), geodeticDistanceOperator.load()]);

  const buffer = geodesicBufferOperator.execute(origin, miles, { unit: "miles" });
  if (!buffer) throw new Error("Could not build the search area.");

  const query = layer.createQuery();
  query.geometry = buffer;
  query.spatialRelationship = "intersects";
  query.where = "visited = 0";
  query.outFields = ["parkCode"];
  query.returnGeometry = true;

  const { features } = await layer.queryFeatures(query);

  const distances = new Map<string, number>();
  for (const feature of features) {
    if (!feature.geometry) continue;
    const d = geodeticDistanceOperator.execute(origin, feature.geometry, { unit: "miles" });
    distances.set(String(feature.attributes.parkCode), d);
  }
  return { buffer, distances };
}
