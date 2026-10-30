# Official Postgres image (multi-arch, works on Apple Silicon and Intel) plus PostGIS.
# The postgis/postgis image is published for amd64 only.
FROM postgres:17-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-postgis-3 \
 && rm -rf /var/lib/apt/lists/*
