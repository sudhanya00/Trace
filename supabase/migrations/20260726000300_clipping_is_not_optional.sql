-- Security audit (user, 2026-07-26).
--
-- Supabase's advisor mailed about spatial_ref_sys. That one is real but dull;
-- the audit it prompted turned up two that aren't, and both are the same
-- mistake wearing different clothes: a TABLE PRIVILEGE wider than the rule it
-- was supposed to enforce.
--
-- RLS decides which ROWS you may read. It has nothing to say about which
-- COLUMNS. Every time a policy widens to let other riders see a row, every
-- column of that row goes with it — including the ones the product only ever
-- meant to serve through a function that cleans them first. That is what
-- happened here, twice.

-- ---------------------------------------------------------------------------
-- 1. Raw route geometry stops being selectable. (The serious one.)
--
-- 20260715000300 was explicit about this: routes got an owner-only policy on
-- purpose, and the comment said why — "if raw geom rows were directly
-- selectable for public profiles, any client could read inside privacy zones
-- and clipping would be optional — the exact home-address leak §12 warns
-- about."
--
-- 20260724000100 then dropped routes_own and wrote routes_read, which lets a
-- rider read other people's route rows. That was right for the catalogue and
-- wrong for the geometry, because the grant underneath it was still
-- `select` on the whole table. So since 24 July:
--
--     supabase.from('routes').select('geom, waypoints').eq('id', <any route>)
--
-- has returned the unclipped line. Privacy zones were subtracted only in
-- routes_public and public_route_geom() — a rider who asked the table directly
-- got the version that starts at the owner's front door.
--
-- The fix is column-level: metadata stays readable, geometry does not. The
-- clipped accessors become the only way to a line, which is what the design
-- said all along. Anything that needs a metre of geometry goes through a
-- function that has already thought about privacy zones.
do $$
declare cols text;
begin
  -- Everything EXCEPT the two columns that carry raw positions. Generated
  -- rather than typed out because this table has grown a column most weeks;
  -- the security-relevant statement is the deny list, so that is what's
  -- written down. A future column carrying coordinates MUST be added to it.
  select string_agg(quote_ident(attname), ', ' order by attnum)
    into cols
    from pg_attribute
   where attrelid = 'public.routes'::regclass
     and attnum > 0
     and not attisdropped
     and attname not in ('geom', 'waypoints');

  execute 'revoke select on routes from anon, authenticated';
  execute format('grant select (%s) on routes to authenticated', cols);
end $$;

-- The owner still owns their own line. routes_public and public_route_geom()
-- are unaffected: both are definer-owned and read the table as themselves, so
-- clipping still happens where it always did.

-- The rider's own waypoints, and everyone else's minus anything standing
-- inside one of the owner's privacy zones.
--
-- Waypoints needed an accessor rather than a plain revoke because a planned
-- route has no stored line at all — Google's terms forbid keeping one, so the
-- points ARE the route, and every viewer needs them to redraw it. Dropping the
-- ones inside a zone is the same bargain public_route_geom() strikes with
-- geom: you get the road, not the doorstep.
create or replace function route_waypoints(p_route_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when r.profile_id = auth.uid() then r.waypoints
    else coalesce((
      select jsonb_agg(w order by ord)
      from jsonb_array_elements(r.waypoints) with ordinality as t(w, ord)
      where not exists (
        select 1 from privacy_zones z
        where z.profile_id = r.profile_id
          and ST_Covers(
                z.area::geometry,
                ST_SetSRID(
                  ST_MakePoint((w ->> 'lng')::float8, (w ->> 'lat')::float8), 4326))
      )
    ), '[]'::jsonb)
  end
  from routes r
  where r.id = p_route_id
    -- typeof, not just `is not null`: jsonb_array_elements raises on anything
    -- that isn't an array, and a malformed row should read as "no waypoints"
    -- rather than take the whole call down.
    and jsonb_typeof(r.waypoints) = 'array'
    and route_readable(p_route_id);
$$;
revoke all on function route_waypoints(uuid) from public;
grant execute on function route_waypoints(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A rider stops being able to make themselves an admin.
--
-- 20260724000100 added profiles.is_admin, which gates who may create, edit and
-- delete CURATED routes — the editorial catalogue every rider sees, and the
-- one kind of route public_route_geom() returns unclipped.
--
-- The grant under profiles has said `insert, update` on the whole table since
-- 20260715000300, and profiles_write only ever checked `id = auth.uid()`.
-- Nothing checked WHICH columns. So the escalation was one call:
--
--     supabase.from('profiles').update({ is_admin: true }).eq('id', me)
--
-- Column grants again. is_admin becomes a thing only the service role and the
-- dashboard can set, which is what an admin flag should always have been.
revoke insert, update on profiles from authenticated;
grant insert (id, handle, display_name, avatar_url, visibility, home_region)
  on profiles to authenticated;
grant update (handle, display_name, avatar_url, visibility, home_region)
  on profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. spatial_ref_sys — the one the advisor mailed about, and the one this
--    file CANNOT fix. Read this before assuming it's handled.
--
-- PostGIS installs into public (20260715000100), so its table of coordinate
-- systems sits in an exposed schema with no RLS. Verified on a clean stack,
-- 2026-07-26:
--
--   owner : supabase_admin
--   acl   : anon=arwdDxtm/supabase_admin, authenticated=arwdDxtm/...
--
-- anon holds every privilege, granted by supabase_admin. Reading it is
-- harmless — EPSG definitions are public reference data. Writing it is not:
--
--   DELETE /rest/v1/spatial_ref_sys?srid=eq.4326   ->  204
--
-- and every geography operation in this app stops working. Anyone holding the
-- anon key can do it, and the anon key ships inside the APK. It is a remote
-- off switch for the product.
--
-- Every remediation was tried from here and every one fails, because
-- migrations run as `postgres`, which is neither the owner nor the grantor:
--
--   set role supabase_admin                       -> permission denied
--   alter table ... enable row level security      -> must be owner
--   alter table ... owner to postgres              -> must be owner
--   revoke ... from anon                           -> no error, NO EFFECT
--
-- That last one is the trap: REVOKE issued by a non-grantor succeeds silently
-- and changes nothing, so a migration that "handles" this would pass review,
-- pass its tests, and leave the door open. Which is why there is no statement
-- here — only this comment.
--
-- The fix has to be applied by something that owns the table: Supabase's own
-- advisor remediation in the dashboard, or support. Tracked as an open item in
-- the audit summary; do not close it on the strength of this migration.

-- ---------------------------------------------------------------------------
-- 4. Uploads get a ceiling and a shortlist.
--
-- Both buckets are public-read by design — a route photo is the shareable face
-- of a route. Neither had a size limit or a type restriction, which made them
-- an open file host on our domain: an authenticated rider could park arbitrary
-- bytes there, of any type, and serve them from a URL that looks like ours.
--
-- The app only ever uploads JPEG (both upload paths set contentType
-- explicitly); png and webp are allowed as headroom for a picker that starts
-- handing us something else.
update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id in ('avatars', 'route-photos');
