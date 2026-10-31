import esriConfig from "@arcgis/core/config.js";
import Map from "@arcgis/core/Map.js";
import Basemap from "@arcgis/core/Basemap.js";
import BasemapStyle from "@arcgis/core/support/BasemapStyle.js";
import MapView from "@arcgis/core/views/MapView.js";
import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer.js";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer.js";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol.js";
import PopupTemplate from "@arcgis/core/PopupTemplate.js";
import { ARCGIS_API_KEY } from "./config";
import type { ParkData } from "./parks";
import { createRecreationSites, createTrustLands } from "./dnr";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import type MapImageLayer from "@arcgis/core/layers/MapImageLayer.js";

export const VISITED_COLOR = "#1b7a3d";
export const UNVISITED_COLOR = "#8a4b08";

// Visited and not-visited differ by shape as well as color (WCAG 1.4.1).
const renderer = new UniqueValueRenderer({
  field: "visited",
  legendOptions: { title: "Visit status" },
  uniqueValueInfos: [
    {
      value: 1,
      label: "Visited",
      symbol: new SimpleMarkerSymbol({
        style: "circle",
        color: VISITED_COLOR,
        size: 11,
        outline: { color: "#ffffff", width: 1.5 },
      }),
    },
    {
      value: 0,
      label: "Not visited yet",
      symbol: new SimpleMarkerSymbol({
        style: "diamond",
        color: "#ffffff",
        size: 12,
        outline: { color: UNVISITED_COLOR, width: 2 },
      }),
    },
  ],
});

const popupTemplate = new PopupTemplate({
  title: "{name}",
  expressionInfos: [
    {
      // Google Maps directions URL (no API key needed); starts from the visitor's location.
      // Destination is the park name + first state, which Google resolves to the park itself.
      name: "directions",
      title: "Directions",
      expression:
        '"https://www.google.com/maps/dir/?api=1&destination=" + UrlEncode($feature.name + ", " + Split($feature.states, ",")[0])',
    },
    {
      name: "status",
      title: "Visit status",
      expression:
        'IIf($feature.visited == 1, IIf(IsEmpty($feature.visitDate) || $feature.visitDate == "", "Visited", "Visited " + $feature.visitDate), "Not visited yet")',
    },
  ],
  content:
    "<p>{designation} · {states}</p><p><strong>{expression/status}</strong></p>" +
    '<p><a href="{url}" target="_blank" rel="noopener">Park page on nps.gov</a> · ' +
    '<a href="{expression/directions}" target="_blank" rel="noopener">Directions (Google Maps)</a></p>',
});

function basemap(): Basemap | string {
  if (!ARCGIS_API_KEY) return "osm";
  esriConfig.apiKey = ARCGIS_API_KEY;
  return new Basemap({ style: new BasemapStyle({ id: "arcgis/outdoor" }) });
}

export interface ParkMap {
  view: MapView;
  layer: GeoJSONLayer;
  recSites: FeatureLayer;
  trustLands: MapImageLayer;
}

export async function createMap(container: HTMLDivElement, data: ParkData): Promise<ParkMap> {
  const blob = new Blob([JSON.stringify(data.geojson)], { type: "application/geo+json" });

  const layer = new GeoJSONLayer({
    url: URL.createObjectURL(blob),
    title: "Junior Ranger parks",
    outFields: ["*"],
    renderer,
    popupTemplate,
  });

  // Washington DNR layers sit under the parks so park symbols stay on top.
  const trustLands = createTrustLands();
  const recSites = createRecreationSites();
  const map = new Map({ basemap: basemap(), layers: [trustLands, recSites, layer] });

  const view = new MapView({
    container,
    map,
    center: [-98.5, 39.8],
    zoom: 3,
    constraints: { minZoom: 2 },
  });

  await view.when();
  await layer.load();
  return { view, layer, recSites, trustLands };
}
