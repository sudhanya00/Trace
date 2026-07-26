-- Correcting 20260726000400, same day. It closed the oracle for signed-in
-- callers and left it open for anonymous ones in a different alphabet.
--
-- Two mistakes, and they hid each other.
--
-- 1. THREE-VALUED LOGIC. The guard was:
--
--      select p_profile_id = auth.uid() and <did they ride here>
--
--    For anon, auth.uid() is null, so the left side is null — not false. And
--    in SQL:
--
--      null and true   ->  null
--      null and false  ->  false
--
--    So an anonymous caller got NULL when the rider had ridden there and FALSE
--    when they hadn't. That is the same oracle. Only the tokens changed.
--
-- 2. THE REVOKE MISSED. It said `revoke all ... from public`. Locally that was
--    enough, because the local stack reaches anon's execute right through
--    PUBLIC — which is why the post-fix check showed "permission denied" and
--    looked finished. Hosted grants EXECUTE to anon DIRECTLY, so PUBLIC was
--    never the path and revoking it changed nothing there. Verified after the
--    push: anon calling the function on hosted returned HTTP 200, not 403.
--
-- Each mistake made the other invisible. The revoke made the logic
-- unreachable locally, so the null branch never showed up in a test; and the
-- logic returning something plausible made the failed revoke look harmless.
-- A fix verified only on the box where the other half of it works is not
-- verified.
--
-- coalesce, so unknown collapses to false and `false and anything` is false —
-- one answer for every question, which is the definition of no oracle. This
-- holds even if the grant is wrong again on some future platform change, which
-- is the point of fixing it in the logic rather than only in the ACL.
create or replace function rider_rode_route(p_profile_id uuid, p_route_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  with r as (
    select geom, ST_Length(geom) as len
    from routes
    where id = p_route_id and route_visible(p_route_id)
  )
  select coalesce(p_profile_id = auth.uid(), false)
     and coalesce((
       select sum(ST_Length(ST_Intersection(t.geom, ST_Buffer(r.geom, 150))))
       from ride_tracks t, r
       where t.profile_id = p_profile_id
         and ST_DWithin(t.geom, r.geom, 150)
     ), 0) > 0.3 * coalesce((select len from r), 0);
$$;

-- Name the roles. `from public` is not a superset of them here: on hosted the
-- grant to anon is direct, so only naming it removes it.
revoke all on function rider_rode_route(uuid, uuid) from public, anon;
grant execute on function rider_rode_route(uuid, uuid) to authenticated;

-- The same blind spot, swept everywhere else it could apply: any definer
-- function this role owns that anon can still execute, where anon was never
-- explicitly granted by us. Reported rather than revoked — several of these
-- are deliberately public (public_route_geom, route_readable, profile_stats),
-- and quietly dropping anon from those would break the signed-out catalogue.
do $$
declare fn record; n int := 0;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname = 'public' and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and pg_get_userbyid(p.proowner) = current_user
  loop
    n := n + 1;
    raise notice 'anon may execute: %', fn.sig;
  end loop;
  raise notice '% definer function(s) reachable by anon — each is intended, see the audit notes', n;
end $$;
