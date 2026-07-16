-- Route photo storage. One photo per route (user decision 2026-07-16),
-- client-resized to ≤1600px JPEG before upload, stored at {profile_id}/{route_id}.jpg.
--
-- Public-read bucket: route photos are the shareable face of routes. Uploads
-- are locked to the uploader's own folder; nobody writes into anyone else's.

-- JSON face of the clipped route geometry, for clients. Same authorization
-- as public_route_geom (owner or public profile), just serialized.
create or replace function public_route_geojson(p_route_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select ST_AsGeoJSON(public_route_geom(p_route_id))::jsonb;
$$;

revoke all on function public_route_geojson(uuid) from public;
grant execute on function public_route_geojson(uuid) to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('route-photos', 'route-photos', true)
on conflict (id) do nothing;

create policy "route photos readable"
  on storage.objects for select
  using (bucket_id = 'route-photos');

create policy "route photos upload own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'route-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "route photos replace own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'route-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "route photos delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'route-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
