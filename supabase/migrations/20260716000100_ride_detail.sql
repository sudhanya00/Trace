-- Ride detail support: owner-scoped track GeoJSON + §12b recording reports.

-- The app renders its own ride from the canonical server geometry once local
-- points are gone (post-sync). SECURITY INVOKER on purpose: RLS applies, so
-- this only ever returns rows the caller could read anyway (owner-only —
-- public consumption goes through the clipped accessors, never this).
create or replace function own_track_geojson(p_ride_id uuid)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select ST_AsGeoJSON(t.geom)::jsonb
  from ride_tracks t
  where t.ride_id = p_ride_id;
$$;

grant execute on function own_track_geojson(uuid) to authenticated;

-- §12b: one-tap "report bad recording" — the actual feedback loop that fixes
-- GPS. Raw point log + device + battery state, straight from the rider.
create table recording_reports (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  ride_id uuid references rides(id) on delete set null,
  device jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table recording_reports enable row level security;

grant insert, select on recording_reports to authenticated;

create policy reports_own on recording_reports for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
