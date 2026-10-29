#!/usr/bin/env python3
"""Fetch NPS parks that offer a Junior Ranger program and save them as GeoJSON.

Usage:
    python3 scripts/fetch_parks.py            # reads NPS_API_KEY from env or .env
    python3 scripts/fetch_parks.py --out path/to/parks.geojson

Uses only the Python standard library. Get a free key at
https://www.nps.gov/subjects/developer/get-started.htm
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API_BASE = "https://developer.nps.gov/api/v1"
ACTIVITY_NAME = "Junior Ranger Program"
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "public" / "data" / "parks.geojson"


def load_api_key() -> str:
    """Read NPS_API_KEY from the environment, then from a local .env file."""
    key = os.environ.get("NPS_API_KEY")
    env_file = ROOT / ".env"
    if not key and env_file.exists():
        for line in env_file.read_text().splitlines():
            name, sep, value = line.partition("=")
            if sep and name.strip() == "NPS_API_KEY":
                key = value.strip().strip('"').strip("'")
    if not key:
        print(
            "NPS_API_KEY not set; using DEMO_KEY (heavily rate-limited).",
            file=sys.stderr,
        )
        key = "DEMO_KEY"
    return key


def ssl_context() -> ssl.SSLContext:
    """Verified TLS context. python.org builds on macOS ship without root
    certificates, so fall back to certifi or the macOS system bundle."""
    try:
        import certifi  # type: ignore[import-not-found]

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    default_cafile = ssl.get_default_verify_paths().cafile
    if default_cafile and Path(default_cafile).exists():
        return ssl.create_default_context()
    if Path("/etc/ssl/cert.pem").exists():
        return ssl.create_default_context(cafile="/etc/ssl/cert.pem")
    return ssl.create_default_context()


SSL_CONTEXT = ssl_context()


def get(path: str, api_key: str, **params: str | int) -> dict:
    query = urllib.parse.urlencode(params)
    req = urllib.request.Request(
        f"{API_BASE}{path}?{query}",
        headers={"X-Api-Key": api_key, "User-Agent": "junior-ranger-gis"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120, context=SSL_CONTEXT) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as err:
        if err.code == 429:
            sys.exit("NPS API rate limit hit. Set NPS_API_KEY (DEMO_KEY allows very few calls).")
        raise


def junior_ranger_parks(api_key: str) -> list[dict]:
    activities = get("/activities", api_key, limit=500)["data"]
    activity = next(a for a in activities if a["name"] == ACTIVITY_NAME)
    result = get("/activities/parks", api_key, id=activity["id"], limit=1000)
    return result["data"][0]["parks"]


def all_park_details(api_key: str) -> dict[str, dict]:
    """Return every NPS park record (with coordinates), keyed by park code.

    One large request keeps us well under the API's hourly rate limit.
    """
    data = get("/parks", api_key, limit=1000)["data"]
    return {park["parkCode"]: park for park in data}


def to_feature(summary: dict, detail: dict | None) -> dict | None:
    if not detail:
        return None
    try:
        lat = float(detail["latitude"])
        lon = float(detail["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    images = detail.get("images") or []
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
        "properties": {
            "parkCode": summary["parkCode"],
            "name": summary["fullName"],
            "designation": summary.get("designation") or detail.get("designation", ""),
            "states": summary.get("states", ""),
            "url": summary.get("url") or detail.get("url", ""),
            "description": detail.get("description", ""),
            "imageUrl": images[0]["url"] if images else "",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    api_key = load_api_key()
    parks = junior_ranger_parks(api_key)
    details = all_park_details(api_key)

    features, skipped = [], []
    for summary in sorted(parks, key=lambda p: p["fullName"]):
        feature = to_feature(summary, details.get(summary["parkCode"]))
        if feature:
            features.append(feature)
        else:
            skipped.append(summary["parkCode"])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    geojson = {"type": "FeatureCollection", "features": features}
    args.out.write_text(json.dumps(geojson, indent=1) + "\n")

    print(f"Wrote {len(features)} parks to {args.out}")
    if skipped:
        print(f"Skipped {len(skipped)} without coordinates: {', '.join(skipped)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
