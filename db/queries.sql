-- Spatial queries over the Junior Ranger parks.
-- Run all:  npm run db:queries
-- Or one at a time in a psql shell (npm run db:psql) after the \set lines.

\set home_lon -122.1635
\set home_lat 47.7543
\set miles 300
\pset footer off

-- 1. Unvisited parks within N miles of home, nearest first.
--    Same question the web map answers in the browser; the results should match.
--    ST_DWithin on geography uses the GiST index and measures true (ellipsoidal) distance.
\echo '\n1. Unvisited parks within' :miles 'miles of home'
WITH home AS (
  SELECT ST_SetSRID(ST_MakePoint(:home_lon, :home_lat), 4326)::geography AS geog
)
SELECT p.name,
       array_to_string(p.states, ', ') AS states,
       round((ST_Distance(p.location, home.geog) / 1609.344)::numeric) AS miles
FROM park_status p, home
WHERE NOT p.visited
  AND ST_DWithin(p.location, home.geog, :miles * 1609.344)
ORDER BY miles;

-- 2. Progress by state. A park in several states counts toward each.
\echo '\n2. Progress by state (states with at least one visit)'
SELECT state,
       count(*) FILTER (WHERE visited) AS visited,
       count(*)                        AS total,
       round(100.0 * count(*) FILTER (WHERE visited) / count(*)) AS pct
FROM park_status, unnest(states) AS state
GROUP BY state
HAVING count(*) FILTER (WHERE visited) > 0
ORDER BY pct DESC, total DESC;

-- 3. For each visited park, the nearest park not yet visited.
--    LATERAL + the <-> operator is a k-nearest-neighbor search driven by the GiST index.
\echo '\n3. Nearest unvisited park to each visited park'
SELECT v.name AS visited_park,
       n.name AS nearest_unvisited,
       round((ST_Distance(v.location, n.location) / 1609.344)::numeric) AS miles
FROM park_status v
CROSS JOIN LATERAL (
  SELECT u.name, u.location
  FROM park_status u
  WHERE NOT u.visited
  ORDER BY u.location <-> v.location
  LIMIT 1
) n
WHERE v.visited
ORDER BY miles;

-- 4. Road-trip clusters: groups of 3+ unvisited parks in the lower 48 where each
--    park is within 50 miles of another park in the group (DBSCAN).
--    DBSCAN needs planar coordinates, so points are projected to
--    USA Contiguous Albers Equal Area (EPSG:5070), whose units are meters.
--    National trails are left out: each is stored as one point but spans many states.
--    Each cluster is named after its most central park.
\echo '\n4. Road-trip clusters of unvisited parks (lower 48)'
WITH projected AS (
  SELECT name, ST_Transform(location::geometry, 5070) AS geom
  FROM park_status
  WHERE NOT visited
    AND designation NOT ILIKE '%trail%'
    AND ST_Intersects(location::geometry, ST_MakeEnvelope(-125, 24, -66, 50, 4326))
),
clustered AS (
  SELECT *, ST_ClusterDBSCAN(geom, eps := 50 * 1609.344, minpoints := 3) OVER () AS cluster_id
  FROM projected
),
summary AS (
  SELECT cluster_id,
         count(*) AS parks,
         ST_Centroid(ST_Collect(geom)) AS center,
         round((ST_MaxDistance(ST_Collect(geom), ST_Collect(geom)) / 1609.344)::numeric) AS span_miles,
         string_agg(name, '; ' ORDER BY name) AS park_names
  FROM clustered
  WHERE cluster_id IS NOT NULL
  GROUP BY cluster_id
)
SELECT (SELECT c.name FROM clustered c
        WHERE c.cluster_id = s.cluster_id
        ORDER BY c.geom <-> s.center LIMIT 1) AS around,
       s.parks,
       s.span_miles,
       left(s.park_names, 90) AS includes
FROM summary s
ORDER BY s.parks DESC, s.span_miles
LIMIT 12;

-- 5. Proof that query 1 uses the spatial index (look for "Index Scan using parks_location_gix").
--    With only 388 rows Postgres may prefer a plain scan, so this turns that off for the demo.
\echo '\n5. Query plan for query 1'
SET enable_seqscan = off;
EXPLAIN (COSTS OFF)
SELECT park_code
FROM parks
WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(:home_lon, :home_lat), 4326)::geography, :miles * 1609.344);
RESET enable_seqscan;
