-- A ride cannot be planned into the past (user, 2026-07-26).
--
-- The client now builds its time picker out of the slots that are still
-- ahead, so there is no past time to land on. This is the backstop under it:
-- a rule the schema holds regardless of what any client believes the time is.
--
-- Insert only, deliberately. Moving an existing ride's start time backwards is
-- a different act — a creator correcting a record after the fact, or a test
-- ageing a row to check that a finished ride still opens — and nothing in the
-- app offers it. Guarding it here would break those without closing anything
-- a rider can actually do.
--
-- Half an hour of grace, because the failure this catches is a ride planned
-- fifteen hours ago, not one planned ninety seconds ago: a phone with a
-- slightly wrong clock, or a rider who filled the form in slowly, should not
-- be told no.
create or replace function reject_past_invite()
returns trigger language plpgsql as $$
begin
  if new.starts_at < now() - interval '30 minutes' then
    raise exception 'a ride cannot be planned in the past'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_invite_not_in_the_past
before insert on ride_invites
for each row execute function reject_past_invite();
