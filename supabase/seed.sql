-- LOCAL DEV SEED — runs on `supabase db reset` against the local stack only.
-- Never run against the hosted project: it inserts fake auth.users rows.
--
-- Two riders:
--   asha  (public)  — has a bike, a ride whose track has one real gap,
--                     a privacy zone over the ride start, and a shared route.
--   veer  (private) — exists to prove private data stays invisible (§12 tests).
-- Passwords are 'password123' for both.

-- GoTrue scans several token columns as non-nullable strings — they must be
-- '' rather than NULL or password sign-in 500s with "error finding user".
insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'asha@test.local',
   crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', ''),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'veer@test.local',
   crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '');

-- Belt and braces for identities (some GoTrue versions require the row).
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001',
   '{"sub":"00000000-0000-4000-a000-000000000001","email":"asha@test.local"}', 'email', now(), now(), now()),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002',
   '{"sub":"00000000-0000-4000-a000-000000000002","email":"veer@test.local"}', 'email', now(), now(), now());

insert into profiles (id, handle, display_name, visibility, home_region) values
  ('00000000-0000-4000-a000-000000000001', 'asha', 'Asha', 'public', 'Himachal'),
  ('00000000-0000-4000-a000-000000000002', 'veer', 'Veer', 'private', 'J&K');

-- `type` matters: it is a hard filter in the discovery ranker (a road marked
-- adv_required is not shown to someone whose only bike is a roadster), so a
-- seed without it ranks against nulls and proves nothing.
insert into bikes (id, profile_id, make, model, year, type, current_odometer_km) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001',
   'Royal Enfield', 'Himalayan 450', 2024, 'adv', 18442),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002',
   'Royal Enfield', 'Interceptor 650', 2021, 'naked', 24118);

-- Asha's ride: Sangla → toward Chitkul, with a ~4 min dropout mid-way.
-- distance_km is left at 0 on purpose — the ride_tracks trigger computes it,
-- then the odometer trigger moves the Himalayan's odometer by the same amount.
insert into rides (id, profile_id, bike_id, started_at, ended_at, gap_count, gap_duration_s, title) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-b000-000000000001',
   '2026-07-01 06:10+05:30', '2026-07-01 09:40+05:30', 1, 240, 'Sangla to Chitkul'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-b000-000000000002',
   '2026-07-02 07:00+05:30', '2026-07-02 10:00+05:30', 0, 0, 'Private morning loop');

-- Two segments; the hole between them is the dropout. Never one merged line.
insert into ride_tracks (ride_id, profile_id, geom) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000001',
   'MULTILINESTRING((
      78.2650 31.4270, 78.2760 31.4210, 78.2900 31.4150, 78.3080 31.4060,
      78.3260 31.3980, 78.3420 31.3900
    ),(
      78.3700 31.3760, 78.3900 31.3680, 78.4100 31.3590, 78.4350 31.3520
    ))'::geography),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-a000-000000000002',
   'MULTILINESTRING((
      74.8300 34.0800, 74.8450 34.0900, 74.8600 34.1000, 74.8750 34.1100
    ))'::geography);

-- Asha's home zone sits over the ride start: the first stretch of her track
-- must vanish from every public read but stay intact in her own data.
insert into privacy_zones (profile_id, label, area) values
  ('00000000-0000-4000-a000-000000000001', 'Home — Sangla',
   'POLYGON((78.2600 31.4320, 78.2820 31.4320, 78.2820 31.4180, 78.2600 31.4180, 78.2600 31.4320))'::geography);

-- Asha shares the ride as a route (route geom is the un-gapped ridden line of
-- the second segment — a route is a recommendation, not a recording).
insert into routes (id, profile_id, source_ride_id, name, description, terrain_tags, distance_km,
                    region, difficulty, max_altitude_m, est_duration_minutes,
                    best_season, road_status, network_coverage, bike_recommendation, geom) values
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-c000-000000000001', 'Sangla–Chitkul road',
   'Tarmac most of the way, broken patches after the bridge.', array['tarmac','broken'],
   9.5,
   'Himachal', 'moderate', 3450, 55,
   '{"months":[4,5,6,7,8,9,10]}'::jsonb, 'open', 'patchy', 'any',
   'LINESTRING(78.3700 31.3760, 78.3900 31.3680, 78.4100 31.3590, 78.4350 31.3520)'::geography);

-- Four more roads, chosen to exercise every branch of the discovery ranker
-- rather than to look plausible. Between them: a pass shut for most of the
-- year, a road closed outright, one that demands a bike a roadster isn't, one
-- above the altitude anybody here has ridden, and one an absolute beginner on
-- a commuter can do on a Sunday.
--
-- All owned by asha and public, because that is what the ranker ranks: user
-- routes other riders shared. (Curated routes were killed on 2026-07-26.)
insert into routes (id, profile_id, name, description, terrain_tags, distance_km,
                    region, difficulty, max_altitude_m, est_duration_minutes,
                    best_season, road_status, network_coverage, bike_recommendation, geom) values
  ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-a000-000000000001',
   'Kunzum La', 'The pass into Spiti. Snow gates shut it more of the year than not.',
   array['unpaved','gravel'], 78,
   'Himachal', 'hard', 4590, 240,
   '{"months":[6,7,8,9]}'::jsonb, 'seasonal_closed', 'none', 'adv_recommended',
   'LINESTRING(77.6300 32.3900, 77.6500 32.4000, 77.6800 32.4100)'::geography),

  ('00000000-0000-4000-d000-000000000003', '00000000-0000-4000-a000-000000000001',
   'Jalori Pass', 'Short, steep, tarmac the whole way. Open most of the year.',
   array['tarmac'], 34,
   'Himachal', 'moderate', 3120, 95,
   '{"months":[3,4,5,6,7,8,9,10,11]}'::jsonb, 'open', 'patchy', 'commuter_ok',
   'LINESTRING(77.3600 31.5300, 77.3800 31.5400, 77.4000 31.5500)'::geography),

  ('00000000-0000-4000-d000-000000000004', '00000000-0000-4000-a000-000000000001',
   'Chandratal track', 'Loose rock and water crossings. Currently shut after a slide.',
   array['unpaved','rock'], 14,
   'Himachal', 'expert', 4300, 90,
   '{"months":[7,8,9]}'::jsonb, 'closed', 'none', 'adv_required',
   'LINESTRING(77.6100 32.4800, 77.6200 32.4850, 77.6300 32.4900)'::geography),

  ('00000000-0000-4000-d000-000000000005', '00000000-0000-4000-a000-000000000001',
   'Manali–Naggar riverside', 'Flat, sealed, signal the whole way. A first ride.',
   array['tarmac'], 21,
   'Himachal', 'easy', 2050, 45,
   '{"months":[1,2,3,4,5,6,7,8,9,10,11,12]}'::jsonb, 'open', 'good', 'commuter_ok',
   'LINESTRING(77.1800 32.2400, 77.1900 32.2200, 77.2000 32.1000)'::geography);

-- One condition report, so provenance has something true to show. Asha rode
-- Jalori; the report is recent and clear.
insert into condition_reports (route_id, profile_id, status, note) values
  ('00000000-0000-4000-d000-000000000003', '00000000-0000-4000-a000-000000000001',
   'clear', 'Dry all the way over. Gravel on the north side hairpins.');
