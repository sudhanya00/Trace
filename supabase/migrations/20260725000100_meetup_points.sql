-- Meetup points and route provenance (user, 2026-07-25).
--
-- "Nishat gate" is a string nobody can navigate to. A meetup becomes a real
-- point: searched (Google Places) or dropped on the map. The text survives as
-- the label a rider actually reads — "Nishat gate, kickstands up at six" says
-- more than a coordinate ever will.
--
-- Storage note: place_id is the ONE piece of Google Places content their terms
-- exempt from caching restrictions, so it's the only Google-derived value we
-- keep. Coordinates stored here come from the rider confirming a point on the
-- map, which is their own input, not Google content.

alter table ride_invites
  add column meetup_lat double precision,
  add column meetup_lng double precision,
  add column meetup_place_id text;

-- Both or neither: half a coordinate is worse than none, because the map
-- would silently render the Gulf of Guinea.
alter table ride_invites add constraint meetup_point_complete
  check ((meetup_lat is null) = (meetup_lng is null));

-- ---------------------------------------------------------------------------
-- Route provenance. Geometry now arrives from several places and they carry
-- different obligations: an OSM-derived line (ORS) requires attribution under
-- ODbL, a recorded trace is the rider's own, curated is ours. Knowing which is
-- which is what lets the app attribute correctly instead of guessing.
-- ---------------------------------------------------------------------------
alter table routes
  add column geom_provider text
    check (geom_provider is null or geom_provider in ('recorded', 'ors', 'manual', 'curated')),
  -- Several routes can share endpoints — Jammu→Patnitop via the highway and
  -- via the old road are different lines between the same two places. Storing
  -- the endpoints as labels lets the picker say which is which without
  -- reverse-geocoding every row on render.
  add column start_label text,
  add column end_label text,
  add column start_place_id text,
  add column end_place_id text;

-- Existing routes all came from recorded rides.
update routes set geom_provider = 'recorded' where geom is not null;
