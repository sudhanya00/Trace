-- Definer sweep, finding 2 (user, 2026-07-26). The second layer, restored.
--
-- Every migration in this repo protects its definer functions the same way:
--
--   revoke all on function f(...) from public;
--   grant execute on function f(...) to authenticated;
--
-- On the local stack that works, because anon reaches EXECUTE through PUBLIC.
-- On hosted it does nothing, because Supabase grants EXECUTE to anon DIRECTLY
-- and PUBLIC was never the path. Measured against production, 2026-07-26 —
-- eleven functions written as authenticated-only, called with the anon key:
--
--   crew_chat 200 · crew_roster 200 · crew_live_riders 200 · invite_list 200
--   invite_detail 200 · follow_edges 200 · explore_feed 200 · my_upcoming_rides 200
--   suggested_riders 200 · crew_leaderboard 200 · own_track_geojson 200
--
-- Eleven of eleven. Not one of them has ever been authenticated-only in
-- production.
--
-- What saved us is that each one filters on auth.uid() internally, and for an
-- anonymous caller that yields nothing — reproduced locally against a real
-- private crew with real messages, a live position and a meetup: every call
-- came back empty. So this was never exploitable on its own.
--
-- It is worth fixing anyway, and not as tidiness. The design has two layers and
-- one of them has been decorative since the first migration, which means every
-- function has been standing on its predicate alone. rider_rode_route
-- (20260726000400) is what that costs: it was the one function without an
-- internal predicate, and it was the one that leaked. A second layer is what
-- makes the next such omission survivable.
--
-- crew_roster shows the other way the layer erodes: 20260716000700 revoked it,
-- then 20260717000100 dropped and recreated it for a new return shape. DROP
-- FUNCTION discards the ACL and the recreate takes the default. Nobody
-- re-revoked, and locally it has been anon-callable ever since.

-- ---------------------------------------------------------------------------
-- The signed-out surface, written down.
--
-- These are the definer functions anon is MEANT to reach: what a rider sees
-- before signing in, and what the privacy-clipped accessors serve. Everything
-- else gets anon taken off it. Keeping this as an explicit list rather than
-- deriving it is the point — it is the answer to "what can a stranger call?",
-- and that question deserves a written answer that a reviewer can check.
-- ---------------------------------------------------------------------------
do $$
declare
  public_surface text[] := array[
    -- privacy-clipped geometry accessors
    'public_track_geom(uuid)',
    'public_route_geom(uuid)',
    'public_route_geojson(uuid)',
    'route_waypoints(uuid)',
    -- visibility predicates, called by the above and by policies
    'route_visible(uuid)',
    'route_readable(uuid)',
    'post_visible(uuid)',
    -- the signed-out catalogue and profile surface
    'route_thread(uuid)',
    'route_conditions(uuid)',
    'post_thread(uuid)',
    'posts_of(uuid,timestamp with time zone)',
    'crews_of(uuid)',
    'profile_stats(uuid)',
    'ride_thumbs(uuid,integer)'
  ];
  fn record;
  closed int := 0;
begin
  for fn in
    select p.oid::regprocedure as sig,
           -- regprocedure renders as name(type,type): no parameter names, so a
           -- future rename of p_route_id cannot silently drop something off the
           -- allowlist. That is why the list above is written in this shape.
           p.oid::regprocedure::text as ident
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and pg_get_userbyid(p.proowner) = current_user
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    if not (fn.ident = any (public_surface)) then
      execute format('revoke all on function %s from public, anon', fn.sig);
      closed := closed + 1;
      raise notice 'anon revoked: %', fn.ident;
    end if;
  end loop;
  raise notice '% definer function(s) closed to anon; % left deliberately open',
    closed, array_length(public_surface, 1);
end $$;

-- ---------------------------------------------------------------------------
-- award_achievements() separately, because anon was not its only problem.
--
-- It takes any profile_id, has no predicate, and WRITES — so a signed-in rider
-- could recompute anyone's achievements on demand. Nothing in the app calls it:
-- its only caller is trg_award, which is SECURITY DEFINER and therefore runs it
-- as the owner regardless of who may execute it. So it needs no caller-facing
-- grant at all.
-- ---------------------------------------------------------------------------
revoke all on function award_achievements(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- crew_roster, re-granted — and the reason is worth keeping.
--
-- 20260716000700 revoked it from public and granted it to authenticated.
-- 20260717000100 then dropped and recreated it for a new return shape, which
-- discarded BOTH: the revoke and the grant. The recreate took the default
-- PUBLIC EXECUTE, and since PUBLIC covers authenticated, the app kept working
-- and nobody noticed the grant was gone. anon was along for the ride.
--
-- So the sweep above, taking PUBLIC off it, also took away the only path
-- `authenticated` still had — and the crew roster screen would have gone dark.
-- The suite did not catch it: 130 tests and not one of them reads a roster as
-- a member. That gap is closed alongside this.
--
-- The lesson for the next return-shape change: DROP FUNCTION takes the ACL with
-- it. Re-state the revoke AND the grant after every recreate.
grant execute on function crew_roster(uuid) to authenticated;
