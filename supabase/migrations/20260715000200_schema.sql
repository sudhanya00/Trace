-- TRACE Phase 01 schema (§3 of TRACE_BUILD_SPEC.md).
-- Phase 02 tables (follows, groups, threads…) are deliberately absent — do not stub them.

-- extends auth.users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique not null,
  display_name text,
  avatar_url text,
  visibility text not null default 'private'
    check (visibility in ('public','private')),
  home_region text,
  created_at timestamptz not null default now()
);

create table bikes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  make text not null,
  model text not null,
  year int,
  mods text,
  photo_url text,
  current_odometer_km numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table rides (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  bike_id uuid references bikes(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  distance_km numeric not null default 0,  -- sum of segment lengths, gaps NOT counted
  gap_count int not null default 0,
  gap_duration_s int not null default 0,
  title text,
  note text,
  created_at timestamptz not null default now()
);

-- heavy geometry split out so rides can be queried without it.
-- MULTILINESTRING, not LINESTRING: each dropout ends a segment.
-- We never interpolate across gaps (§5).
create table ride_tracks (
  ride_id uuid primary key references rides(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  geom geography(MULTILINESTRING, 4326) not null
);

create table routes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  source_ride_id uuid references rides(id) on delete set null,
  name text not null,
  description text,
  terrain_tags text[],
  distance_km numeric not null default 0,
  geom geography(LINESTRING, 4326) not null,
  photo_url text,
  created_at timestamptz not null default now()
);

create table privacy_zones (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  label text,
  area geography(POLYGON, 4326) not null,
  created_at timestamptz not null default now()
);

-- Indexes — non-negotiable (§3)
create index on ride_tracks using gist (geom);
create index on routes using gist (geom);
create index on privacy_zones using gist (area);
create index on rides (profile_id, started_at desc);
create index on bikes (profile_id) where is_active;
