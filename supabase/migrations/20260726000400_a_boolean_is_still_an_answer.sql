-- Definer sweep, finding 1 (user, 2026-07-26).
--
-- rider_rode_route() carries this reasoning in 20260716000500:
--
--   "SECURITY DEFINER: the commenter can't read the raw route geometry under
--    RLS (nobody but the owner can), but the comparison against it must still
--    happen. Only a boolean ever leaves."
--
-- The premise is right and the conclusion doesn't follow. A boolean is a small
-- answer, but the CALLER CHOOSES THE QUESTION — and here the question is a
-- geometry they supply. Ask it enough times with smaller and smaller shapes and
-- the booleans compose into a position.
--
-- Two things made it reachable. It reads ride_tracks as the owner, so RLS is
-- gone; and unlike route_visible, route_thread and route_conditions in the same
-- file, it never got its `revoke all ... from public`, so it kept the default
-- PUBLIC execute grant. Nobody decided anon could call it. It was an omission.
--
-- Verified on a clean stack, 2026-07-26 — asha probing veer, who is private and
-- whom she cannot even see in `profiles`:
--
--   probe drawn over veer's actual track    -> true
--   probe drawn 1500 km away (control)      -> false
--   same probe, UNAUTHENTICATED             -> true
--   probe inside a privacy zone             -> true
--
-- So it defeated three separate defences at once: ride_tracks being owner-only,
-- profile visibility, and privacy zones — the last of which is the one thing
-- §5 and §12 say must never leak. No account required. The control returning
-- false is what makes it an instrument rather than noise: it discriminates, so
-- it can be walked inward.
--
-- The fix is that the function may only ever answer about the person asking.
-- That is all it was ever used for: set_rode_it() is SECURITY INVOKER and fires
-- BEFORE INSERT on route_comments and condition_reports, whose write policies
-- already pin profile_id = auth.uid(). So the honest caller passes their own id
-- every time, and nothing legitimate notices this change.
--
-- route_visible() on top is defence in depth, and deliberately the same gate
-- commenting already requires — not the stricter route_readable() — so a route
-- you may comment on is a route this may answer about, and no flow shifts.
create or replace function rider_rode_route(p_profile_id uuid, p_route_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  with r as (
    select geom, ST_Length(geom) as len
    from routes
    where id = p_route_id and route_visible(p_route_id)
  )
  select p_profile_id = auth.uid()
     and coalesce((
       select sum(ST_Length(ST_Intersection(t.geom, ST_Buffer(r.geom, 150))))
       from ride_tracks t, r
       where t.profile_id = p_profile_id
         and ST_DWithin(t.geom, r.geom, 150)
     ), 0) > 0.3 * (select len from r);
$$;

-- The grant the original file forgot. anon is not on it: answering requires a
-- caller with an id, and anon has none.
revoke all on function rider_rode_route(uuid, uuid) from public;
grant execute on function rider_rode_route(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The same omission, checked across everything else.
--
-- Trigger functions were left holding the default PUBLIC grant too. Calling one
-- directly raises ("trigger functions can only be called as triggers"), so this
-- closes a door that was already a wall — but a definer function nobody may
-- call is easier to reason about than one that merely refuses for now.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype = 'trigger'::regtype
      and pg_get_userbyid(p.proowner) = current_user
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
  end loop;
end $$;
