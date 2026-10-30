import "@arcgis/core/assets/esri/themes/light/main.css";
import "./style.css";

import Graphic from "@arcgis/core/Graphic.js";
import type Point from "@arcgis/core/geometry/Point.js";
import Extent from "@arcgis/core/geometry/Extent.js";
import FeatureFilter from "@arcgis/core/layers/support/FeatureFilter.js";
import FeatureEffect from "@arcgis/core/layers/support/FeatureEffect.js";
import type GeoJSONLayerView from "@arcgis/core/views/layers/GeoJSONLayerView.js";
import { DEFAULT_RADIUS_MILES, HOME } from "./config";
import { loadVisits } from "./visited";
import { loadParks, type Park } from "./parks";
import { createMap, type ParkMap } from "./map";
import { findUnvisitedNearby, homePoint, type NearbyResult } from "./analysis";
import { findPlace, type Place } from "./geocode";
import { dnrSitesWithin, type NearbySite } from "./dnr";

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
  origin: byId<HTMLInputElement>("origin"),
  visitSource: byId<HTMLSpanElement>("visit-source"),
  toggleRec: byId<HTMLInputElement>("toggle-rec"),
  toggleTrust: byId<HTMLInputElement>("toggle-trust"),
  zoomWa: byId<HTMLButtonElement>("zoom-wa"),
  dnrNearby: byId<HTMLElement>("dnr-nearby"),
  dnrHeading: byId<HTMLHeadingElement>("dnr-nearby-heading"),
  dnrList: byId<HTMLUListElement>("dnr-list"),
  map: byId<HTMLDivElement>("map"),
};

const state = {
  filter: "all" as VisitedFilter,
  search: "",
  nearby: null as NearbyResult | null,
  nearbyLabel: HOME.name,
  dnrSites: [] as NearbySite[],
};

// After a deploy, a page loaded from the old build can ask for code files that no
// longer exist. Reload once to pick up the new build instead of failing.
const RELOAD_FLAG = "reloaded-after-deploy";
window.addEventListener("vite:preloadError", (event) => {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return;
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

const WASHINGTON = new Extent({
  xmin: -124.8,
  ymin: 45.5,
  xmax: -116.9,
  ymax: 49.0,
  spatialReference: { wkid: 4326 },
});

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

  const dnr = state.dnrSites.length;
  const dnrNote = dnr ? ` Also ${dnr} Washington DNR recreation ${dnr === 1 ? "site" : "sites"}, listed after the parks.` : "";
  const where = state.nearby
    ? `${shown.length} unvisited ${shown.length === 1 ? "park" : "parks"} within ${els.radius.value} miles of ${state.nearbyLabel}, nearest first.${dnrNote}`
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

function removeSearchGraphics(): void {
  const g = parkMap.view.graphics;
  g.removeMany(g.filter((x) => x.attributes?.role === "buffer" || x.attributes?.role === "origin").toArray());
}

/** Blank means home; anything else is geocoded (with a park-name fallback). */
async function resolveOrigin(text: string): Promise<Place | null> {
  if (!text.trim()) return { point: homePoint, label: HOME.name };
  return findPlace(text, parks);
}

async function runNearby(miles: number, originText: string): Promise<void> {
  announce("Searching…");
  const origin = await resolveOrigin(originText);
  if (!origin) {
    announce(`Couldn't find “${originText.trim()}”. Try a city and state, such as Moab, UT.`);
    els.origin.focus();
    return;
  }

  const result = await findUnvisitedNearby(parkMap.layer, origin.point, miles);
  state.nearby = result;
  state.nearbyLabel = origin.label;

  const { view, layer } = parkMap;
  removeSearchGraphics();
  if (origin.point !== homePoint) {
    view.graphics.add(
      new Graphic({
        geometry: origin.point,
        attributes: { role: "origin" },
        symbol: {
          type: "simple-marker",
          style: "cross",
          size: 16,
          color: "#1d3b8b",
          outline: { color: "#1d3b8b", width: 3 },
        },
        popupTemplate: { title: `Search center: ${origin.label}` },
      }),
    );
  }
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

  // Second, server-side query: DNR recreation sites inside the same circle.
  try {
    state.dnrSites = await dnrSitesWithin(parkMap.recSites, result.buffer, origin.point);
  } catch (error) {
    console.warn("DNR recreation sites query failed.", error);
    state.dnrSites = [];
  }
  renderDnr();

  els.clearNearby.hidden = false;
  renderList();
  if (result.buffer.extent) {
    await view.goTo(result.buffer.extent.expand(1.1), { animate: !reduceMotion });
  }
}

function renderDnr(): void {
  const sites = state.dnrSites;
  els.dnrNearby.hidden = sites.length === 0;
  els.dnrHeading.textContent = `Washington DNR recreation sites in this area (${sites.length})`;
  els.dnrList.replaceChildren(
    ...sites.map((site) => {
      const li = document.createElement("li");
      let name: HTMLElement;
      if (/^https:\/\//.test(site.website)) {
        const a = document.createElement("a");
        a.href = site.website;
        a.target = "_blank";
        a.rel = "noopener";
        name = a;
      } else {
        name = document.createElement("span");
        name.className = "park-name";
      }
      name.textContent = site.name;
      const meta = document.createElement("span");
      meta.className = "park-meta";
      meta.textContent = `${site.type} · ${Math.round(site.miles)} miles away`;
      li.append(name, meta);
      return li;
    }),
  );
}

function clearNearby(): void {
  state.nearby = null;
  state.dnrSites = [];
  renderDnr();
  parkMap.layer.featureEffect = null;
  removeSearchGraphics();
  els.clearNearby.hidden = true;
  renderList();
  els.origin.focus();
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
    runNearby(miles, els.origin.value).catch(showError);
  });
  els.clearNearby.addEventListener("click", clearNearby);

  els.toggleRec.addEventListener("change", () => {
    parkMap.recSites.visible = els.toggleRec.checked;
  });
  els.toggleTrust.addEventListener("change", () => {
    parkMap.trustLands.visible = els.toggleTrust.checked;
  });
  els.zoomWa.addEventListener("click", () => {
    parkMap.view
      .goTo(WASHINGTON, { animate: !reduceMotion })
      .catch(showError);
  });
  // Enabled only once the map is ready, so an early submit can't reload the page.
  els.nearbyForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = false;

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
  els.origin.placeholder = `Home (${HOME.name})`;
  els.radius.value = String(DEFAULT_RADIUS_MILES);

  const { visits, source } = await loadVisits();
  els.visitSource.textContent =
    source === "hosted-layer"
      ? "Visit list: ArcGIS hosted feature layer."
      : "Visit list: visited.json in the repo.";
  const data = await loadParks(visits);
  parks = data.parks;
  updateProgress();
  // The list doesn't depend on the map, so show it right away.
  renderList();

  parkMap = await createMap(els.map, data);
  layerView = await parkMap.view.whenLayerView(parkMap.layer);
  drawHome();

  wireUi();
  // Loaded cleanly, so a future deploy may trigger one reload again.
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // Storage unavailable (e.g. private mode); nothing to clear.
  }
}

start().catch((error) => {
  els.progress.textContent = "The map could not load.";
  showError(error);
});
