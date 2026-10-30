-- Junior Ranger parks in PostGIS.
-- Runs automatically the first time the Docker container starts.

CREATE EXTENSION IF NOT EXISTS postgis;

-- One row per NPS site with a Junior Ranger program.
-- `geography` stores longitude/latitude on the WGS84 ellipsoid, so distances
-- come back in meters measured on the curved Earth, not on a flat map.
CREATE TABLE IF NOT EXISTS parks (
  park_code   text PRIMARY KEY,
  name        text NOT NULL,
  designation text,
  states      text[] NOT NULL,          -- e.g. {OR,WA}
  url         text,
  location    geography(Point, 4326) NOT NULL
);

-- Spatial index: lets ST_DWithin and nearest-neighbor (<->) queries skip
-- parks that are obviously too far away instead of checking every row.
CREATE INDEX IF NOT EXISTS parks_location_gix ON parks USING gist (location);

CREATE TABLE IF NOT EXISTS visits (
  park_code  text PRIMARY KEY REFERENCES parks (park_code) ON DELETE CASCADE,
  visited_on date,
  note       text
);

-- Convenience view: every park with its visit status.
CREATE OR REPLACE VIEW park_status AS
SELECT p.*,
       v.park_code IS NOT NULL AS visited,
       v.visited_on
FROM parks p
LEFT JOIN visits v USING (park_code);
