-- Definer sweep, finding 3 (user, 2026-07-26). Two answers to one question.
--
-- Route standardization (20260724000100) replaced the visibility model. A route
-- stopped being "visible if its owner is" and became a thing with its own
-- source, its own visibility, a published_at and a deleted_at. route_readable()
-- was written for that, and public_route_geom() was moved onto it.
--
-- route_visible() was not. It still says what it said on 16 July:
--
--   select exists (select 1 from routes r where r.id = p_route_id
--                  and can_view(r.profile_id));
--
-- — the owner's profile, and nothing about the route. So the two helpers
-- disagree, and four RLS policies plus two accessors are on the wrong one.
--
-- Demonstrated on a clean stack: asha is a public profile; she marks one route
-- visibility = 'private' and comments on it.
--
--   route_readable  -> false   (correct)
--   route_visible   -> true    (stale)
--   anon geometry   -> null    (withheld, because that moved to route_readable)
--   anon route_thread -> "the gate by my house is locked after 8pm"
--
-- The line on the map is hidden and the conversation about it is not. Comments
-- are where riders write the things a map cannot show — which gate is locked,
-- whose turning to take — so this is the half you would least want open.
--
-- Rather than fix the call sites, fix the helper: route_visible() becomes
-- route_readable(). One question, one answer, and the four policies below
-- follow without being rewritten:
--
--   comments_read · comments_write · conditions_read · conditions_write
--
-- This is strictly a tightening for user routes, and it also FIXES something.
-- A curated route has profile_id null, so can_view(null) is false and its
-- comments have been invisible to everyone since curated routes existed. Under
-- route_readable a published curated route is readable, so its thread appears.
create or replace function route_visible(p_route_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select route_readable(p_route_id);
$$;

-- The same predicate was also inlined in these two, so the helper alone would
-- not have reached them.
create or replace function route_thread(p_route_id uuid)
returns table (
  id uuid, profile_id uuid, handle text, display_name text,
  body text, rode_it boolean, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id, c.profile_id, p.handle, p.display_name, c.body, c.rode_it, c.created_at
  from route_comments c
  join profiles p on p.id = c.profile_id
  where c.route_id = p_route_id
    and route_readable(p_route_id)
  order by c.created_at asc;
$$;

create or replace function route_conditions(p_route_id uuid)
returns table (
  id uuid, profile_id uuid, handle text, status text,
  note text, rode_it boolean, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select cr.id, cr.profile_id, p.handle, cr.status, cr.note, cr.rode_it, cr.created_at
  from condition_reports cr
  join profiles p on p.id = cr.profile_id
  where cr.route_id = p_route_id
    and route_readable(p_route_id)
  order by cr.created_at desc
  limit 20;
$$;

-- CREATE OR REPLACE keeps the ACL, but 20260717000100 is the reminder that a
-- DROP does not — and route_thread/route_conditions changed return shape once
-- already. State the grants regardless; they are cheap and they are the thing
-- that silently goes missing.
revoke all on function route_visible(uuid) from public;
revoke all on function route_thread(uuid) from public;
revoke all on function route_conditions(uuid) from public;
grant execute on function route_visible(uuid) to anon, authenticated;
grant execute on function route_thread(uuid) to anon, authenticated;
grant execute on function route_conditions(uuid) to anon, authenticated;
