-- Leaving, and forgetting (user, 2026-07-26).
--
-- Neither of these is a vulnerability, which is why they sat at the bottom of
-- every list today. They are obligations: Play Store requires an in-app way to
-- delete an account, and India's DPDP Act does not let location data sit
-- forever because nothing was written to remove it.
--
-- ---------------------------------------------------------------------------
-- 1. A crew outlives its founder.
--
-- Every profile reference cascades except crews.created_by, which is SET NULL —
-- so deleting a founder leaves the crew standing. But crew_members DOES cascade,
-- so their membership row goes with them, and is_crew_admin() reads role from
-- crew_members. A founder who was the only admin therefore leaves behind a crew
-- nobody can administer: no one to approve requests, rename it, or close it.
-- It just sits there.
--
-- So before the row goes, hand the crew to whoever has been in it longest.
-- Longest-standing rather than most active, because it needs no judgement and
-- no data beyond joined_at — and any rule beats the crew being stranded.
-- ---------------------------------------------------------------------------
create or replace function hand_over_crews()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c record;
  heir uuid;
begin
  for c in
    select m.crew_id
    from crew_members m
    where m.profile_id = old.id and m.role = 'admin'
  loop
    -- Only when they were the last admin standing.
    if not exists (
      select 1 from crew_members x
      where x.crew_id = c.crew_id
        and x.profile_id <> old.id
        and x.role = 'admin'
        and x.state = 'active'
    ) then
      select x.profile_id into heir
      from crew_members x
      where x.crew_id = c.crew_id
        and x.profile_id <> old.id
        and x.state = 'active'
      order by x.joined_at asc
      limit 1;

      -- heir is null for a crew of one, and a crew with no members left needs
      -- no admin. crews.created_by goes null and the empty room can be swept
      -- later; nothing here has to decide that.
      if heir is not null then
        update crew_members
          set role = 'admin'
          where crew_id = c.crew_id and profile_id = heir;
      end if;
    end if;
  end loop;
  return old;
end;
$$;

-- Fires on the cascade from auth.users as well as on a direct delete.
drop trigger if exists trg_hand_over_crews on profiles;
create trigger trg_hand_over_crews
before delete on profiles
for each row execute function hand_over_crews();

-- ---------------------------------------------------------------------------
-- 2. Deleting your own account.
--
-- auth.users is the root: profiles hangs off it with on delete cascade, and
-- every other table hangs off profiles the same way, so removing the auth row
-- removes the rider's bikes, rides, tracks, routes, zones, posts, messages and
-- notifications in one statement.
--
-- SECURITY DEFINER because auth.users is not the rider's to touch, and the
-- narrowest possible body: no argument, so there is no id to pass but your own.
-- A function that took a uuid would be one typo away from being the very thing
-- this audit spent the day removing.
--
-- What this does NOT delete is storage: avatars and route photos live in
-- buckets, not tables, and removing the rows would orphan the files rather than
-- free them. The client clears its own folders through the storage API first —
-- it already holds delete policies scoped to its own folder — and calls this
-- last, because after this returns the session is gone and nothing can.
-- ---------------------------------------------------------------------------
create or replace function delete_own_account()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function delete_own_account() from public, anon;
grant execute on function delete_own_account() to authenticated;

-- This function stands on one privilege that is not ours to assume: whether the
-- role migrations run as may delete from auth.users. It holds locally. Local
-- held for `revoke ... from public` too, and on hosted that turned out to mean
-- nothing (20260726000600), so the assumption gets checked out loud at deploy
-- rather than discovered by the first rider who tries to leave.
--
-- If this prints `false`, the account-deletion path is broken on that database
-- and delete_own_account() will raise a permission error the client surfaces.
-- It fails visibly rather than silently, but it fails.
do $$
begin
  raise notice 'delete_own_account: % may delete from auth.users -> %',
    current_user, has_table_privilege(current_user, 'auth.users', 'DELETE');
end $$;

-- ---------------------------------------------------------------------------
-- 3. A last position stops being kept.
--
-- live_positions is keyed on profile_id, so it holds one row per rider and not
-- a history — it is smaller than it sounds. But that row is the rider's last
-- known position and nothing ever removed it, so a ride that ended in March
-- left a point on the map of where they were when it did.
--
-- crew_live_riders already refuses anything older than 15 minutes, so past that
-- the row is invisible and serves nothing. An hour gives a generous operational
-- buffer past the point of usefulness, and then it goes.
-- ---------------------------------------------------------------------------
create or replace function sweep_live_positions()
returns int language sql security definer set search_path = public as $$
  with gone as (
    delete from live_positions
    where updated_at < now() - interval '1 hour'
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke all on function sweep_live_positions() from public, anon, authenticated;
grant execute on function sweep_live_positions() to service_role;

-- Self-cleaning, so retention does not depend on a scheduler existing. Every
-- position written sweeps what has expired; during a ride that is constant, and
-- between rides there is nothing fresh to protect. A statement-level trigger on
-- INSERT/UPDATE only — it never fires on the DELETE it performs, so it cannot
-- recurse.
create or replace function sweep_live_positions_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from live_positions where updated_at < now() - interval '1 hour';
  return null;
end;
$$;

drop trigger if exists trg_live_positions_sweep on live_positions;
create trigger trg_live_positions_sweep
after insert or update on live_positions
for each statement execute function sweep_live_positions_tg();

-- ---------------------------------------------------------------------------
-- 4. And the reader gets the same 15 minutes the crew view already enforced.
--
-- crew_live_riders() has always refused a position older than 15 minutes.
-- live_position_of() never did, so an accepted follower could read where
-- somebody was days ago — the same data, two different rules, and the looser
-- one on the path a single rider is looked up by.
--
-- SECURITY INVOKER stays: RLS decides WHO may ask (live_own, and accepted
-- followers via live_followers_read). This decides how stale an answer may be.
-- ---------------------------------------------------------------------------
create or replace function live_position_of(p_profile_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'point', ST_AsGeoJSON(geom)::jsonb,
    'updated_at', updated_at,
    'ride_started_at', ride_started_at
  )
  from live_positions
  where profile_id = p_profile_id
    and updated_at > now() - interval '15 minutes';
$$;

revoke all on function live_position_of(uuid) from public, anon;
grant execute on function live_position_of(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The two trigger functions above, closed on the way in.
--
-- A definer function arrives holding EXECUTE for PUBLIC, and 20260726000600
-- established that on hosted `from public` does not reach anon — the roles have
-- to be named. Calling either of these directly raises ("trigger functions can
-- only be called as triggers"), so this closes a door that is already a wall.
-- It is here because the alternative is another sweep in six months finding
-- them, which is exactly how crew_roster and rider_rode_route happened.
-- ---------------------------------------------------------------------------
revoke all on function hand_over_crews() from public, anon, authenticated;
revoke all on function sweep_live_positions_tg() from public, anon, authenticated;
