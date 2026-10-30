#!/usr/bin/env python3
"""Export visited parks as GeoJSON points, ready to publish as an ArcGIS hosted feature layer.

    python3 scripts/export_visits.py      # writes exports/visits.geojson

Each feature is a visited park at the park's location, with fields:
park_code, park_name, visited_on (YYYY-MM-DD or empty), note.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARKS = ROOT / "public" / "data" / "parks.geojson"
VISITS = ROOT / "public" / "data" / "visited.json"
OUT = ROOT / "exports" / "visits.geojson"


def main() -> None:
    parks = {
        f["properties"]["parkCode"]: f for f in json.loads(PARKS.read_text())["features"]
    }
    visits = json.loads(VISITS.read_text()).get("visits", [])

    features = []
    for visit in visits:
        park = parks.get(visit["parkCode"].lower())
        if not park:
            print(f"skipped unknown park code {visit['parkCode']!r}")
            continue
        features.append(
            {
                "type": "Feature",
                "geometry": park["geometry"],
                "properties": {
                    "park_code": visit["parkCode"].lower(),
                    "park_name": park["properties"]["name"],
                    "visited_on": visit.get("date", ""),
                    "note": visit.get("note", ""),
                },
            }
        )

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, indent=1) + "\n")
    print(f"Wrote {len(features)} visits to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
