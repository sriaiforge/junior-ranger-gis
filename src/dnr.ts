import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import MapImageLayer from "@arcgis/core/layers/MapImageLayer.js";
import type Point from "@arcgis/core/geometry/Point.js";
import type Polygon from "@arcgis/core/geometry/Polygon.js";
import * as geodeticDistanceOperator from "@arcgis/core/geometry/operators/geodeticDistanceOperator.js";

// Public map services from the Washington State Department of Natural Resources.
// https://dnr.wa.gov/ (GIS open data). Both allow anonymous, cross-origin access.
const REC_SITES_URL =
  "https://gis.dnr.wa.gov/site2/rest/services/Recreation/DNR_Recreation_Sites/MapServer/0";
const MANAGED_LANDS_URL =
  "https://gis.dnr.wa.gov/site3/rest/services/Public_Boundaries/WADNR_PUBLIC_Managed_Lands/MapServer";

export const DNR_SITE_COLOR = "#0b6e6e";

/** SITE_TYPE codes used by the DNR recreation sites layer. */
export const SITE_TYPES: Record<string, string> = {
  CG: "Campground",
  DIS: "Dispersed camping",
  DUA: "Day-use area",
  ES: "Hut or cabin",
  TH: "Trailhead",
  POI: "Point of interest",
};

const siteTypeArcade = `Decode($feature.SITE_TYPE, ${Object.entries(SITE_TYPES)
  .map(([code, label]) => `"${code}", "${label}"`)
  .join(", ")}, $feature.SITE_TYPE)`;

/** ~state-level zoom; below this the statewide layers would just be clutter. */
const STATE_SCALE = 6_000_000;

export function createRecreationSites(): FeatureLayer {
  return new FeatureLayer({
    url: REC_SITES_URL,
    title: "DNR recreation sites",
    outFields: ["NAME", "SITE_TYPE", "ACTIVITIES", "WEBSITE"],
    minScale: STATE_SCALE,
    renderer: {
      type: "simple",
      symbol: {
        type: "simple-marker",
        style: "triangle",
        size: 10,
        color: DNR_SITE_COLOR,
        outline: { color: "#ffffff", width: 1 },
      },
    },
    popupTemplate: {
      title: "{NAME}",
      expressionInfos: [{ name: "type", title: "Type", expression: siteTypeArcade }],
      content:
        "<p><strong>{expression/type}</strong> · Washington DNR</p><p>{ACTIVITIES}</p>" +
        '<p><a href="{WEBSITE}" target="_blank" rel="noopener">Site page on dnr.wa.gov</a></p>',
    },
  });
}

/** DNR-managed state trust lands, drawn by DNR's server (13,000+ parcels). */
export function createTrustLands(): MapImageLayer {
  return new MapImageLayer({
    url: MANAGED_LANDS_URL,
    title: "DNR-managed trust lands",
    opacity: 0.5,
    visible: false,
    sublayers: [
      {
        id: 1,
        visible: true,
        popupTemplate: {
          title: "{SURFACE_TRUST_NM}",
          content:
            "<p>DNR-managed state trust land</p>" +
            "<p>County: {COUNTY_NM}<br>DNR region: {REGION_NM}</p>",
        },
      },
    ],
  });
}

export interface NearbySite {
  name: string;
  type: string;
  website: string;
  miles: number;
}

/**
 * Server-side spatial query: DNR recreation sites inside the search area,
 * nearest first. The polygon is sent to DNR's ArcGIS Server, which does the intersect.
 */
export async function dnrSitesWithin(
  layer: FeatureLayer,
  area: Polygon,
  origin: Point,
): Promise<NearbySite[]> {
  const { features } = await layer.queryFeatures({
    geometry: area,
    spatialRelationship: "intersects",
    outFields: ["NAME", "SITE_TYPE", "WEBSITE"],
    returnGeometry: true,
    outSpatialReference: { wkid: 4326 },
  });
  await geodeticDistanceOperator.load();
  return features
    .filter((f) => f.geometry)
    .map((f) => ({
      name: String(f.attributes.NAME ?? "").trim(),
      type: SITE_TYPES[f.attributes.SITE_TYPE] ?? String(f.attributes.SITE_TYPE ?? ""),
      website: String(f.attributes.WEBSITE ?? ""),
      miles: geodeticDistanceOperator.execute(origin, f.geometry!, { unit: "miles" }),
    }))
    .sort((a, b) => a.miles - b.miles);
}
