import "@arcgis/core/assets/esri/themes/light/main.css";
import "./style.css";

import Graphic from "@arcgis/core/Graphic.js";
import type Point from "@arcgis/core/geometry/Point.js";
import FeatureFilter from "@arcgis/core/layers/support/FeatureFilter.js";
import FeatureEffect from "@arcgis/core/layers/support/FeatureEffect.js";
import type GeoJSONLayerView from "@arcgis/core/views/layers/GeoJSONLayerView.js";
import { DEFAULT_RADIUS_MILES, HOME } from "./config";
import { loadVisits } from "./visited";
import { loadParks, type Park } from "./parks";
import { createMap, type ParkMap } from "./map";
import { findUnvisitedNearby, homePoint, type NearbyResult } from "./analysis";

type VisitedFilter = "all" | "visited" | "unvisited";

const els = {
  progress: byId<HTMLParagraphElement>("progress"),
  status: byId<HTMLParagraphElement>("status"),
  list: byId<HTMLUListElement>("park-list"),
  listHeading: byId<HTMLHeadingElement>("park-list-heading"),
  search: byId<HTMLInputElement>("search"),
  radius: byId<HTMLInputElement>("radius"),
  nearbyForm: byId<HTMLFormElement>("nearby-form"),
  clearNearby: byId<HTMLButtonElement>("clear-nearby"),
  homeName: byId<HTMLSpanElement>("home-name"),
  map: byId<HTMLDivElement>("map"),
};

const state = {
  filter: "all" as VisitedFilter,
  search: "",
  nearby: null as NearbyResult | null,
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let parks: Park[] = [];
let parkMap: ParkMap;
let layerView: GeoJSONLayerView;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function announce(message: string): void {
  els.status.textContent = message;
}

/** A two-letter search is treated as a state code (so "WA" doesn't match "Hawaii"). */
function isStateCode(term: string): boolean {
  return /^[a-z]{2}$/i.test(term);
}

function matchesSearch(park: Park, term: string): boolean {
  if (!term) return true;
  const t = term.toLowerCase();
  const states = park.states.toLowerCase().split(",");
  return isStateCode(t) ? states.includes(t) : park.name.toLowerCase().includes(t);
}

function visiblePark(park: Park): boolean {
  if (state.filter === "visited" && !park.visited) return false;
  if (state.filter === "unvisited" && park.visited) return false;
  if (state.nearby && !state.nearby.distances.has(park.parkCode)) return false;
  return matchesSearch(park, state.search);
}

/** SQL where clause matching the list filters, for the map layer view. */
function whereClause(): string {
  const parts: string[] = [];
  if (state.filter === "visited") parts.push("visited = 1");
  if (state.filter === "unvisited") parts.push("visited = 0");
  const term = state.search.trim().replace(/['%_]/g, "").toUpperCase();
  if (term && isStateCode(term)) {
    // states is a comma-separated list such as "OR,WA".
    parts.push(
      `(states = '${term}' OR states LIKE '${term},%' OR states LIKE '%,${term}' OR states LIKE '%,${term},%')`,
    );
  } else if (term) {
    parts.push(`UPPER(name) LIKE '%${term}%'`);
  }
  return parts.join(" AND ") || "1=1";
}

function updateProgress(): void {
  const visited = parks.filter((p) => p.visited).length;
  els.progress.textContent = `Visited ${visited} of ${parks.length} Junior Ranger parks.`;
}

function renderList(): void {
  const shown = parks.filter(visiblePark);
  if (state.nearby) {
    const d = state.nearby.distances;
    shown.sort((a, b) => (d.get(a.parkCode) ?? 0) - (d.get(b.parkCode) ?? 0));
  }

  const items = shown.map((park) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "park-item";
    button.dataset.parkCode = park.parkCode;

    const name = document.createElement("span");
    name.className = "park-name";
    name.textContent = park.name;

    const meta = document.createElement("span");
    meta.className = "park-meta";
    const miles = state.nearby?.distances.get(park.parkCode);
    meta.textContent = [
      park.states.replaceAll(",", ", "),
      miles !== undefined ? `${Math.round(miles)} miles away` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    const status = document.createElement("span");
    status.className = park.visited ? "badge badge-visited" : "badge badge-unvisited";
    status.textContent = park.visited
      ? park.visitDate
        ? `Visited ${park.visitDate}`
        : "Visited"
      : "Not visited";

    button.append(name, meta, status);
    li.append(button);
    return li;
  });

  els.list.replaceChildren(...items);
  els.listHeading.textContent = `Parks (${shown.length})`;

  if (shown.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No parks match these filters.";
    els.list.append(li);
  }

  const where = state.nearby
    ? `${shown.length} unvisited parks within ${els.radius.value} miles of ${HOME.name}, nearest first.`
    : `Showing ${shown.length} of ${parks.length} parks.`;
  announce(where);
}

function applyFilters(): void {
  layerView.filter = new FeatureFilter({ where: whereClause() });
  renderList();
}

async function zoomToPark(code: string): Promise<void> {
  if (!/^[a-z0-9]+$/i.test(code)) return;
  const { features } = await parkMap.layer.queryFeatures({
    where: `parkCode = '${code}'`,
    outFields: ["*"],
    returnGeometry: true,
  });
  const feature = features[0];
  if (!feature?.geometry) return;
  await parkMap.view.goTo({ target: feature.geometry, zoom: 8 }, { animate: !reduceMotion });
  parkMap.view.openPopup({ features: [feature], location: feature.geometry as Point });
}

function drawHome(): void {
  parkMap.view.graphics.add(
    new Graphic({
      geometry: homePoint,
      symbol: {
        type: "simple-marker",
        style: "x",
        size: 14,
        color: "#1d3b8b",
        outline: { color: "#1d3b8b", width: 3 },
      },
      attributes: { name: HOME.name },
      popupTemplate: { title: `Home: ${HOME.name}` },
    }),
  );
}

async function runNearby(miles: number): Promise<void> {
  announce("Searching…");
  const result = await findUnvisitedNearby(parkMap.layer, miles);
  state.nearby = result;

  const { view, layer } = parkMap;
  view.graphics.removeMany(view.graphics.filter((g) => g.attributes?.role === "buffer").toArray());
  view.graphics.add(
    new Graphic({
      geometry: result.buffer,
      attributes: { role: "buffer" },
      symbol: {
        type: "simple-fill",
        color: [29, 59, 139, 0.08],
        outline: { color: [29, 59, 139, 0.9], width: 1.5, style: "dash" },
      },
    }),
    0,
  );

  // Dim everything outside the search area instead of hiding it.
  layer.featureEffect = new FeatureEffect({
    filter: new FeatureFilter({ geometry: result.buffer, spatialRelationship: "intersects", where: "visited = 0" }),
    excludedEffect: "opacity(25%) grayscale(100%)",
  });

  els.clearNearby.hidden = false;
  renderList();
  if (result.buffer.extent) {
    await view.goTo(result.buffer.extent.expand(1.1), { animate: !reduceMotion });
  }
}

function clearNearby(): void {
  state.nearby = null;
  parkMap.layer.featureEffect = null;
  const g = parkMap.view.graphics;
  g.removeMany(g.filter((x) => x.attributes?.role === "buffer").toArray());
  els.clearNearby.hidden = true;
  renderList();
  els.radius.focus();
}

function wireUi(): void {
  document.querySelectorAll<HTMLInputElement>('input[name="visited-filter"]').forEach((radio) =>
    radio.addEventListener("change", () => {
      state.filter = radio.value as VisitedFilter;
      applyFilters();
    }),
  );

  let timer: number | undefined;
  els.search.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      state.search = els.search.value.trim();
      applyFilters();
    }, 250);
  });

  els.nearbyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const miles = els.radius.valueAsNumber;
    if (!Number.isFinite(miles) || miles <= 0) return;
    runNearby(miles).catch(showError);
  });
  els.clearNearby.addEventListener("click", clearNearby);

  els.list.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button.park-item");
    if (button?.dataset.parkCode) zoomToPark(button.dataset.parkCode).catch(showError);
  });

  // Skip link: move focus, not just scroll.
  document.querySelector(".skip-link")?.addEventListener("click", (event) => {
    event.preventDefault();
    els.listHeading.focus();
  });
}

function showError(error: unknown): void {
  console.error(error);
  announce(`Something went wrong: ${error instanceof Error ? error.message : String(error)}`);
}

async function start(): Promise<void> {
  els.homeName.textContent = HOME.name;
  els.radius.value = String(DEFAULT_RADIUS_MILES);

  const visits = await loadVisits();
  const data = await loadParks(visits);
  parks = data.parks;
  updateProgress();

  parkMap = await createMap(els.map, data);
  layerView = await parkMap.view.whenLayerView(parkMap.layer);
  drawHome();

  wireUi();
  renderList();
}

start().catch((error) => {
  els.progress.textContent = "The map could not load.";
  showError(error);
});
