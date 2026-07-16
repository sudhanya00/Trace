-- Phase 02, trace map v1: vector tiles straight off the live tables.
-- Serverless by decision (2026-07-16) — no tile pipeline until scale demands
-- one; this swaps out for pregenerated PMTiles behind the same MapLibre layer.

-- Tile queries hit the geometry cast, not the geography — give them an index.
create index if not exists ride_tracks_geom_3857
  on ride_tracks using gist (ST_Transform(geom::geometry, 3857));

-- PostgREST serves raw bytes only for custom media-type domains — this is
-- what lets MapLibre fetch tiles straight off the REST endpoint.
create domain "application/vnd.mapbox-vector-tile" as bytea;

-- The personal trace map: every segment the CALLER has ever ridden, as MVT.
-- SECURITY INVOKER: RLS keeps it owner-only by construction — there is no
-- way to request someone else's trace through this function.
--
-- Segments are emitted individually (never merged): density comes from the
-- client stacking translucent lines, so ride-the-same-road-ten-times glows.
create or replace function trace_tiles(z int, x int, y int)
returns "application/vnd.mapbox-vector-tile"
language sql stable security invoker
set search_path = public as $$
  with bounds as (
    select ST_TileEnvelope(z, x, y) as env
  ),
  mvtgeom as (
    select ST_AsMVTGeom(
      ST_Transform(t.geom::geometry, 3857),
      b.env,
      4096,
      256,
      true
    ) as geom
    from ride_tracks t, bounds b
    where t.profile_id = auth.uid()
      and ST_Transform(t.geom::geometry, 3857) && b.env
  )
  select coalesce(ST_AsMVT(mvtgeom.*, 'trace', 4096, 'geom'), ''::bytea)
  from mvtgeom
  where geom is not null;
$$;

revoke all on function trace_tiles(int, int, int) from public;
grant execute on function trace_tiles(int, int, int) to authenticated;
