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
-- Route provenance and waypoints.
--
-- Geometry arrives from two kinds of place now, and they carry very different
-- obligations:
--
--   'recorded' — the rider's own trace. Theirs, stored forever, no strings.
--   'google'   — computed by Google's Routes API. Their terms restrict storing
--                the returned line, so we DON'T. We store the waypoints the
--                rider chose (their own coordinates, plus place IDs, which
--                Google explicitly exempts) and recompute the line on demand.
--
-- That's what `waypoints` is for: an ordered array of
--   { lat, lng, place_id?, label? }
-- which fully defines the route without retaining a metre of Google content.
-- geom stays null for those rows; a recorded route fills geom and leaves
-- waypoints null.
-- ---------------------------------------------------------------------------
alter table routes
  add column geom_provider text
    check (geom_provider is null or geom_provider in ('recorded', 'google', 'manual', 'curated')),
  add column waypoints jsonb,
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

-- A route is only useful if it can be drawn: either it has its own geometry,
-- or it has the waypoints to recompute one. An adhoc "just named it" route has
-- neither, and that's legitimate — it's a name and a meeting point.
alter table routes add constraint route_drawable check (
  source = 'adhoc' or geom is not null or waypoints is not null
);
