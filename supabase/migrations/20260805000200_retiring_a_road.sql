-- Deleting a route (user, 2026-08-05: "there's no option for user to delete
-- routes").
--
-- The obvious implementation is one line of client code — set deleted_at and
-- let RLS decide who may — and it does not work. Postgres applies the SELECT
-- policy to the NEW row on UPDATE, and routes_read is gated on
-- `deleted_at is null`, so the moment a rider marks their own route deleted the
-- row becomes invisible to them and the write is refused:
--
--   ERROR: new row violates row-level security policy for table "routes"
--
-- Proven rather than guessed: the same UPDATE succeeds verbatim once a
-- temporary SELECT policy lets the owner see deleted rows. You cannot update a
-- row into a state where you can no longer see it. Nothing in routes_update is
-- wrong; soft delete simply is not expressible as a plain UPDATE against this
-- read policy.
--
-- So it goes where delete_own_account() went (20260726000800): a definer
-- function that names the rule it enforces. That turns out to be the better
-- home anyway, because deleting a route is not only a permission question.
--
-- WHAT IT REFUSES, AND WHY THE REFUSAL IS HERE RATHER THAN IN THE APP
--
-- ride_invites.route_id is ON DELETE SET NULL and routes_read hides a deleted
-- row, so retiring a road that a planned ride points at leaves other riders
-- holding a ride that no longer goes anywhere. They have already said yes and
-- they are turning up. A check written in the client is a suggestion — this one
-- decides, in the same statement as the delete, where no second caller can
-- route around it.
--
-- SOFT, not hard, for the same reason: past rides, threads and condition
-- reports stay attached to the road they were about.
create or replace function delete_own_route(p_route_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  pending int;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- source = 'user': an adhoc route IS a ride rather than a road somebody
  -- saved, and it is removed by cancelling that ride, not from a route screen.
  select r.profile_id into owner
    from routes r
   where r.id = p_route_id
     and r.deleted_at is null
     and r.source = 'user';

  -- One answer for "no such route" and "not yours". A rider does not need to
  -- learn from an error message which routes exist.
  if owner is null or owner <> auth.uid() then
    raise exception 'That route is not yours to delete.'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into pending
    from ride_invites i
   where i.route_id = p_route_id
     and i.starts_at > now();

  if pending > 0 then
    raise exception 'A planned ride still goes this way. Cancel the ride first, then delete the route.'
      using errcode = 'foreign_key_violation';
  end if;

  update routes set deleted_at = now() where id = p_route_id;
end;
$$;

-- Named roles, not `from public`: on hosted, revoking PUBLIC leaves anon's
-- directly-granted EXECUTE in place (20260726000600). And a signed-out caller
-- has no route of their own to retire.
revoke all on function delete_own_route(uuid) from public, anon;
grant execute on function delete_own_route(uuid) to authenticated;
