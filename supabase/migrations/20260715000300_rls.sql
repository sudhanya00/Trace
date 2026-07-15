-- Row-Level Security (§3). Authorization lives here, never in client code.
--
-- Phase 01 has no follows table, so visibility is: own rows, or owner is public.
--
-- DEVIATION FROM THE LITERAL SPEC TEXT (flagged, see summary):
-- ride_tracks and routes do NOT get the own-or-public read policy. Raw geometry
-- is readable by its owner only; everyone else goes through the privacy-clipped
-- accessors in 20260715000400_functions.sql. If raw geom rows were directly
-- selectable for public profiles, any client could read inside privacy zones and
-- clipping would be optional — the exact home-address leak §12 warns about.

-- Table-level grants: RLS gates rows, but the roles still need table privileges.
-- Least privilege: anon can read only what has a public surface (metadata
-- tables); raw geometry and privacy zones aren't grantable to anon at all —
-- their public surface is the clipped accessors in the functions migration.
grant usage on schema public to anon, authenticated;
grant select on profiles, bikes, rides to anon, authenticated;
grant insert, update, delete on profiles, bikes, rides to authenticated;
grant select, insert, update, delete on ride_tracks, routes, privacy_zones to authenticated;

alter table profiles enable row level security;
alter table bikes enable row level security;
alter table rides enable row level security;
alter table ride_tracks enable row level security;
alter table routes enable row level security;
alter table privacy_zones enable row level security;

-- profiles: readable when own or public; writable by owner.
create policy profiles_read on profiles for select using (
  id = auth.uid() or visibility = 'public'
);
create policy profiles_write on profiles for all using (id = auth.uid())
  with check (id = auth.uid());

-- bikes: own, or owner is public.
create policy bikes_read on bikes for select using (
  profile_id = auth.uid()
  or exists (
    select 1 from profiles p
    where p.id = bikes.profile_id and p.visibility = 'public'
  )
);
create policy bikes_write on bikes for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- rides: metadata only (no geometry lives here) — own, or owner is public.
create policy rides_read on rides for select using (
  profile_id = auth.uid()
  or exists (
    select 1 from profiles p
    where p.id = rides.profile_id and p.visibility = 'public'
  )
);
create policy rides_write on rides for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ride_tracks: raw geometry is owner-only. Public reads are clipped via
-- public_track_geom().
create policy ride_tracks_own on ride_tracks for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- routes: raw geometry is owner-only. Public reads go through routes_public /
-- public_route_geom(), both privacy-clipped.
create policy routes_own on routes for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- privacy zones are ALWAYS private, no public read.
create policy pz_own on privacy_zones for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Phase 02 forward shape (§3: "policy swap, not a redesign"). DO NOT ENABLE.
-- When a `follows` table exists (follower_id, followee_id, state), the read
-- policies above widen like this:
--
-- create policy rides_read on rides for select using (
--   profile_id = auth.uid()
--   or exists (
--     select 1 from profiles p
--     where p.id = rides.profile_id and p.visibility = 'public'
--   )
--   or exists (
--     select 1 from follows f
--     where f.followee_id = rides.profile_id
--       and f.follower_id = auth.uid()
--       and f.state = 'accepted'
--   )
-- );
--
-- Same third arm applies to profiles_read and bikes_read, and to the
-- visibility checks inside public_track_geom / public_route_geom /
-- routes_public. privacy_zones stays owner-only forever.
-- ---------------------------------------------------------------------------
