import { VISITED_URL } from "./config";

export interface Visit {
  parkCode: string;
  /** ISO date, e.g. "2024-07-04". */
  date?: string;
  note?: string;
}

/**
 * Loads which parks have been visited.
 *
 * All visited-status reads go through this one function, so the source can
 * later move from a JSON file to an ArcGIS Online hosted feature layer
 * (for Field Maps / Survey123 check-ins) without touching the map code.
 */
export async function loadVisits(): Promise<Map<string, Visit>> {
  const response = await fetch(VISITED_URL);
  if (!response.ok) {
    throw new Error(`Could not load visited list (${response.status})`);
  }
  const data = (await response.json()) as { visits?: Visit[] };
  return new Map((data.visits ?? []).map((visit) => [visit.parkCode.toLowerCase(), visit]));
}
