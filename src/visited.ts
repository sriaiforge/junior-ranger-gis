import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import { ARCGIS_API_KEY, VISITED_URL, VISITS_LAYER_URL } from "./config";

export interface Visit {
  parkCode: string;
  /** ISO date, e.g. "2024-07-04". */
  date?: string;
  note?: string;
}

export interface Visits {
  visits: Map<string, Visit>;
  /** Where the visit list came from, shown in the page footer. */
  source: "hosted-layer" | "json";
}

/**
 * Loads which parks have been visited.
 *
 * All visited-status reads go through this module. When VITE_VISITS_LAYER_URL is set,
 * visits come from an ArcGIS hosted feature layer (edited in ArcGIS, no redeploy needed);
 * otherwise, or if that request fails, from public/data/visited.json.
 */
export async function loadVisits(): Promise<Visits> {
  if (VISITS_LAYER_URL) {
    try {
      return { visits: await fromHostedLayer(VISITS_LAYER_URL), source: "hosted-layer" };
    } catch (error) {
      console.warn("Hosted visits layer unavailable; using visited.json.", error);
    }
  }
  return { visits: await fromJson(), source: "json" };
}

async function fromHostedLayer(url: string): Promise<Map<string, Visit>> {
  const layer = new FeatureLayer({ url, apiKey: ARCGIS_API_KEY });
  const { features } = await layer.queryFeatures({
    where: "1=1",
    outFields: ["park_code", "visited_on", "note"],
    returnGeometry: false,
  });
  const visits = new Map<string, Visit>();
  for (const { attributes: a } of features) {
    const code = String(a.park_code ?? "").trim().toLowerCase();
    if (!code) continue;
    visits.set(code, {
      parkCode: code,
      date: toIsoDate(a.visited_on),
      note: a.note ? String(a.note) : undefined,
    });
  }
  return visits;
}

/** visited_on may be text ("2024-07-04") or an ArcGIS date field (epoch milliseconds). */
function toIsoDate(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return new Date(value).toISOString().slice(0, 10);
  return String(value);
}

async function fromJson(): Promise<Map<string, Visit>> {
  const response = await fetch(VISITED_URL);
  if (!response.ok) {
    throw new Error(`Could not load visited list (${response.status})`);
  }
  const data = (await response.json()) as { visits?: Visit[] };
  return new Map((data.visits ?? []).map((visit) => [visit.parkCode.toLowerCase(), visit]));
}
