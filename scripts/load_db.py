#!/usr/bin/env python3
"""Write SQL that loads parks.geojson and visited.json into the PostGIS tables.

Prints SQL to stdout, so it needs no database driver:
    python3 scripts/load_db.py | docker compose exec -T db psql -U ranger -d junior_ranger
(`npm run db:load` does exactly this.) Safe to re-run: it replaces all rows.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARKS = ROOT / "public" / "data" / "parks.geojson"
VISITS = ROOT / "public" / "data" / "visited.json"


def lit(value: object) -> str:
    """SQL literal: NULL, or a single-quoted string with quotes doubled."""
    if value is None or value == "":
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def text_array(items: list[str]) -> str:
    return "ARRAY[" + ", ".join(lit(i) for i in items) + "]::text[]"


def main() -> int:
    parks = json.loads(PARKS.read_text())["features"]
    visits = json.loads(VISITS.read_text()).get("visits", [])
    codes = {f["properties"]["parkCode"] for f in parks}

    out = ["BEGIN;", "TRUNCATE visits, parks;"]

    out.append("INSERT INTO parks (park_code, name, designation, states, url, location) VALUES")
    rows = []
    for f in parks:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"]
        states = [s.strip() for s in p.get("states", "").split(",") if s.strip()]
        rows.append(
            f"  ({lit(p['parkCode'])}, {lit(p['name'])}, {lit(p.get('designation'))}, "
            f"{text_array(states)}, {lit(p.get('url'))}, "
            f"ST_SetSRID(ST_MakePoint({float(lon)}, {float(lat)}), 4326)::geography)"
        )
    out.append(",\n".join(rows) + ";")

    known = [v for v in visits if v["parkCode"].lower() in codes]
    for v in visits:
        if v["parkCode"].lower() not in codes:
            print(f"-- skipped unknown park code {v['parkCode']!r}", file=sys.stderr)
    if known:
        out.append("INSERT INTO visits (park_code, visited_on, note) VALUES")
        out.append(
            ",\n".join(
                f"  ({lit(v['parkCode'].lower())}, {lit(v.get('date'))}, {lit(v.get('note'))})"
                for v in known
            )
            + ";"
        )

    out += ["COMMIT;", "ANALYZE parks;"]
    print("\n".join(out))
    print(f"-- {len(parks)} parks, {len(known)} visits", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
