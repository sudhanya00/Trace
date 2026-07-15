# TRACE — Build Specification

**For:** coding agent
**Scope:** Phase 01 (Record + Share + Garage). Do not build Phase 02 features.
**Target:** no rewrites needed at 100k users. Not "build for 10M on day one."
**Contains:** product context · stack · schema · recording engine · design system · screens · build order

---

## What TRACE is

A community and exploration platform for motorcycle riders, built around the roads you've actually ridden — not the times you've posted.

Three pillars:

- **Garage** — every bike you've owned or ridden. Odometer syncs from logged rides. Maintenance tied to odometer, not the calendar. This is the retention hook that fires even in weeks nobody rides.
- **Trace Map** — a personal map of everywhere you've ridden, on-road or off. Lines, not percentages. Density becomes heat. *(Phase 02, but the schema serves it now.)*
- **Community** — route-linked discussion, regional crews, condition reports, groups, public ride invites. *(Phase 02.)* **Community is the moat.**

### Three product rules that drive engineering decisions

These aren't preferences. Violating any one of them breaks the product's reason to exist.

1. **Distance over speed. Never speed.** No pace, no leaderboards, no PRs, no segment times — anywhere, ever. Strava bans motorcycles outright because speed leaderboards on two wheels are a liability problem. Our milestones are kilometres covered and roads explored. If a feature implies racing, it's wrong.
2. **Never fabricate distance the rider didn't cover.** Gaps are marked as gaps, never interpolated across. Strava straight-lines across dropouts; it's their loudest complaint. On a Himalayan switchback that fake line is fake kilometres on an odometer and a fake road on someone else's route. See §5.
3. **We don't build turn-by-turn navigation.** We export GPX and hand off to Google Maps. This is the strategic wedge — REVER built nav, it's their weakest surface, and it drags down the parts of their product that work. Don't rebuild it by accident.

### Who this is for

Launch architecture is global from v1. Seeding effort concentrates on J&K / Himachal riders first — dense regional content beats thin global spread. Practically, that means **the first cohort rides Himalayan terrain on Xiaomi/Vivo/Oppo handsets, frequently with no signal for hours.** Design for that user, not for a Pixel in a city.

---

## 0. Read this first

The hardest thing in this product is **background GPS recording**: phone in a tank bag, screen off, 8 hours, no signal, Himalayan cold, on a Xiaomi/Vivo/Oppo handset. Everything else is well-understood engineering.

**We are not gating v1 on it.** Even with imperfect recording there is a real product — garage, route library, groups, forums, public invites. Community is the moat. Recording gets tuned with early testers alongside everything else.

But it is still **the first thing to build and measure** (§2), because the numbers it produces set the sampling rate, the battery expectations, and the OEM handling for everything after. Build it, ride it, report the numbers, keep going either way.

**The one hard rule:** never fabricate distance the rider didn't cover. Gaps are marked as gaps, never interpolated across. See §5. Our entire product is "distance covered" and "roads you've actually ridden" — a track that quietly invents kilometres is a trust problem in a way it isn't for a running app.

---

## 1. Stack (decided — do not relitigate)

| Concern | Choice |
|---|---|
| Mobile | React Native + Expo (dev client, **not** Expo Go — native modules required) |
| Language | TypeScript, strict mode |
| Backend | Supabase (Postgres 15+ with **PostGIS enabled**) |
| Auth | Supabase Auth — Apple, Google, email |
| Authorization | Postgres Row-Level Security. **Never** in client code. |
| Local store | SQLite (`expo-sqlite`) — offline buffer, source of truth until sync |
| Location | `expo-location` + `expo-task-manager`; native module only if Task 1 proves it necessary |
| Error tracking | Sentry — mobile + backend, from first commit |
| Analytics | PostHog |

**Not in Phase 01:** tile service, MapLibre trace map, groups, chat, forums, planned rides, follows. Phase 02.

---

## 2. Task 1 — background GPS prototype (BUILD FIRST, MEASURE, REPORT)

A throwaway Expo app. It does exactly one thing: record a background GPS track to local SQLite. No auth, no UI beyond start/stop, no backend.

This is **not a blocker** — it's a calibration exercise. Its output is a set of real numbers that configure §5 and §6. Report them, then continue regardless of result.

### Requirements
- `expo-location` with `startLocationUpdatesAsync` + `expo-task-manager`
- Android: **foreground service with persistent notification** (mandatory — see §6)
- iOS: `allowsBackgroundLocationUpdates = true`, `UIBackgroundModes: ["location"]`
- Write every fix to SQLite immediately. Never buffer in memory only.
- Log: timestamp, lat, lng, accuracy, altitude, speed, battery level

### Test protocol — must be a REAL ride, not a simulator
- Minimum 3 hours, phone in a bag, **screen off**
- **Test on a Xiaomi/Vivo/Oppo/OnePlus device.** This is where it breaks first. A Pixel passing means nothing.
- Also test one iPhone
- Signal loss: ride through actual dead zones. **Do not rely on airplane mode as a proxy** — some devices (Motorola notably) disable GPS entirely in airplane mode, so you'd be testing the wrong failure.

### Measure and report these numbers
- [ ] Gap profile — count and duration of dropouts over the ride
- [ ] Battery drain %/hour, screen off. **Realistic target: 15–20%/hour.** Strava's own docs say modern phones manage ~5 hours of recording; anything implying 8h unassisted is fantasy. Assume riders carry a power bank on long days.
- [ ] Typical accuracy (metres) and how bad the drift/bounce gets on switchbacks
- [ ] Did the OS kill the process? At what point? Recoverable?

### If results are poor
Diagnose in this order — do not jump to the end:
1. Sampling rate too aggressive → tune `timeInterval` / `distanceInterval`
2. Android OEM battery killer → §6 whitelist flow, retest
3. Foreground service misconfigured → check notification is actually persistent
4. Only after 1–3, and only if it's genuinely blocking: native module (Swift/Kotlin) for the location layer, keep Expo for everything else

**Report the numbers, then continue to §3 either way.**

---

## 3. Database schema

PostGIS required: `create extension if not exists postgis;`

### Phase 01 tables only

```sql
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
-- We never interpolate across gaps. See §5.
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
```

### Indexes — non-negotiable

```sql
create index on ride_tracks using gist (geom);
create index on routes using gist (geom);
create index on privacy_zones using gist (area);
create index on rides (profile_id, started_at desc);
create index on bikes (profile_id) where is_active;
```

### RLS — enable on every table

```sql
alter table profiles enable row level security;
alter table bikes enable row level security;
alter table rides enable row level security;
alter table ride_tracks enable row level security;
alter table routes enable row level security;
alter table privacy_zones enable row level security;
```

Phase 01 has no `follows` table, so visibility is: **own rows, or owner is public.**

```sql
-- pattern — apply equivalently to bikes, rides, ride_tracks, routes
create policy rides_read on rides for select using (
  profile_id = auth.uid()
  or exists (
    select 1 from profiles p
    where p.id = rides.profile_id and p.visibility = 'public'
  )
);

create policy rides_write on rides for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- privacy zones are ALWAYS private, no public read
create policy pz_own on privacy_zones for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());
```

**Write the `follows`-aware policy shape now** (commented out) so Phase 02 is a policy swap, not a redesign.

### Privacy zone clipping

Applied at **read time**. Never delete the rider's own data.

```sql
create or replace function public_track_geom(p_ride_id uuid)
returns geometry language sql stable as $$
  select ST_Difference(
    t.geom::geometry,
    coalesce((
      select ST_Union(area::geometry)
      from privacy_zones z where z.profile_id = t.profile_id
    ), 'POLYGON EMPTY'::geometry)
  )
  from ride_tracks t where t.ride_id = p_ride_id;
$$;
```

Same clipping must apply to `routes.geom` on any public read.

---

## 4. Local SQLite schema (offline buffer)

The device is the source of truth until sync succeeds.

```sql
CREATE TABLE local_rides (
  id TEXT PRIMARY KEY,          -- uuid generated on device
  bike_id TEXT,
  started_at INTEGER NOT NULL,  -- epoch ms
  ended_at INTEGER,
  sync_state TEXT NOT NULL DEFAULT 'recording'
    CHECK (sync_state IN ('recording','pending','syncing','synced','failed')),
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE local_points (
  ride_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  segment_seq INTEGER NOT NULL DEFAULT 0,  -- increments on each detected gap
  ts INTEGER NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,
  altitude REAL,
  speed REAL,
  PRIMARY KEY (ride_id, seq)
);
CREATE INDEX idx_points_ride ON local_points(ride_id);
```

### Sync rules
- Rides are **append-only, single-author**. This is why sync is tractable — do not build a general sync framework.
- Sync on: connectivity regained, app foreground, ride stop
- Retry with exponential backoff. Never block the UI on sync.
- Delete local points only after server confirms write.
- Compute `distance_km` **server-side** from the geometry (`ST_Length` over the MULTILINESTRING — sums segments, excludes gaps by construction), not on device. Client numbers drift.
- Points group into segments by `segment_seq` on upload. Never merge segments into one line.

---

## 5. Ride recording engine

### State machine
`idle → recording → paused (auto) → recording → stopping → synced`

### Rules
- Auto-pause: no movement > 90s. Auto-resume on movement.
- Auto-stop: paused > 15 min → prompt, stop if unanswered
- **Recovery is mandatory**: if the OS kills the process mid-ride, on next launch detect `sync_state = 'recording'` with a stale `ended_at` and offer to resume or finalize. Never silently lose a track.
- Sampling: start at `distanceInterval: 25m`, `timeInterval: 5s`, `accuracy: BestForNavigation`. Tune against the Task 1 battery numbers.
- Drop fixes with `accuracy > 50m` before writing (GPS noise at cold start).

### Gaps — the one hard rule

**Never interpolate across a dropout.** Strava draws a straight line between the last fix before signal loss and the first fix after; that line is fabricated distance the rider never covered, and it's one of the loudest complaints in their support threads. On a mountain switchback the error is large, and it corrupts three things we actually sell: the odometer, the trace map, and any route another rider follows.

- Store the track as **multiple segments**, not one continuous line. A dropout ends a segment and starts a new one.
  - Schema: `ride_tracks.geom` becomes `geography(MULTILINESTRING, 4326)`. Update §3.
- A gap is any interval > 60s or > 500m between consecutive fixes. Tune with real data from Task 1.
- `distance_km` sums **segment lengths only**. Gap distance is never counted.
- Render gaps as a visibly dashed/broken line on the map. The rider should see exactly where data is missing.
- Surface it honestly after the ride: "Recording was interrupted for ~4 min near Chitkul. That section isn't counted." Strava's recovery message has the right instinct — admit it — but they still draw the line.
- Store `gap_count` and `gap_duration_s` on `rides` so we can measure how bad this actually is across the tester cohort.

### GPS bounce
Noisy fixes zig-zag and **inflate** distance — the opposite failure from gaps. Accuracy filtering (`> 50m` dropped) is a start, not a fix. Don't build smoothing in v1; log raw points, measure real drift from Task 1 and tester rides, then decide. Server-side correction is a Phase 02 conversation.

---

## 6. Foreground service + notification (Android)

**Not optional.** The persistent notification is the mechanism that keeps Android from killing the service. Without it, Doze wins.

### Make it a feature, not an apology
It's on screen for 8 hours and it's the only app surface visible during a ride. Show live stats:
- Distance so far
- Elapsed time
- Current elevation

Tap → opens the in-progress ride screen.

### iOS is NOT symmetric
No notification. iOS shows a blue status-bar pill via `allowsBackgroundLocationUpdates`. **Do not build UI assuming parity.**

### OEM battery-killer whitelist flow — Phase 01 requirement, not polish
Stock Android honours the foreground service contract. Xiaomi (MIUI), Vivo (FuntouchOS), Oppo (ColorOS), and OnePlus **do not**. The first cohort is Indian riders on exactly these handsets.

- Detect manufacturer at onboarding
- If in the aggressive list → show a walkthrough to whitelist TRACE in the OEM's battery settings (Blinkit/Zomato delivery apps do this; copy the pattern)
- Deep-link to the OEM settings screen where possible; screenshot walkthrough where not
- Re-prompt if a ride is detected as killed mid-recording
- Do not block onboarding on it — warn, don't gate

---

## 7. Permission flow

The highest-stakes UX in the product. `ALWAYS` background location is a scary dialog; a denied permission is a dead product.

**Sequence — do not deviate:**
1. Add first bike **before** asking for location. Garage is non-empty before first ride; the app is never a blank slate.
2. Plain-language screen explaining *why* background access is needed, before the OS dialog
3. Request `WHEN_IN_USE` first
4. Request `ALWAYS` only at the point the rider taps Record the first time — in context, not at onboarding
5. If denied: app still works in foreground-only mode with an honest warning that tracks will break when the screen locks. Do not nag on every launch.

Copy the framing discipline from Yulu's flow: ask at the right moment, explain why, degrade gracefully.

---

## 8. Design system

The reference prototype (`trace_prototype.html`) is the source of truth for look and feel. Open it before writing any UI. Everything below is extracted from it — match it.

### Direction

**An instrument cluster, not a fitness feed.** The subject's world is night rides, headlight beams, backlit gauges, cold air, checking your phone at a chai stop with gloves on. Dark, high-contrast, glanceable, mechanical.

Reference quality bar: Yulu, Blinkit, CRED, GPay, Duolingo. What they share is not decoration — it's owning a single material completely and applying it with restraint.

**Do not** reach for warm cream backgrounds, high-contrast serifs, or terracotta accents. That palette reads as generated. **Do not** use orange as the accent — it's Strava's signature and being read as a Strava clone is the one association this product can't afford.

### Color tokens

```css
--void:    #0B0D0E;              /* base background */
--slate:   #14181A;              /* card / panel */
--slate-2: #1C2224;              /* raised control */
--white:   #E8EAEA;              /* primary text, data */
--signal:  #2E7DFF;              /* LIVE/ACTIVE ONLY — see rule below */
--amber:   #F5A623;              /* warnings only */
--moss:    #3F5570;              /* dormant / secondary state */
--steel:   #8A9196;             /* labels, captions, units */
--hair:    rgba(232,234,234,.10); /* dividers */
```

**The signal rule — this is the whole system.** `--signal` blue means *live or active*, and nothing else. Recording indicator, active bike tag, current position, in-progress track, primary action. It is never decoration. The moment blue appears on something that isn't live, the system stops meaning anything.

Blue is instrument-cluster illumination — deep and slightly indigo, not neon cyan. Cyan-on-black is its own generated-design cliché.

**Warnings are amber, never blue.** On a real cluster, a caution is never the illumination color. "Due in 558 km" and the service meter's warning tick are amber.

**GPS status stays green** (`#7BC47F`). Green/amber/red is universal signal language and does not bend to brand color — same reason a real dashboard uses green for "good" regardless of cluster illumination.

### Typography

```
Display:  Barlow Condensed — 500/600/700
Body:     Archivo — 400/500/600/700
Mono:     JetBrains Mono — 400/500/700
```

- **Barlow Condensed** for headings, numbers, and the odometer. Condensed grotesque with tabular numerals — odometer stampings and route markers, not a bookish serif.
- **JetBrains Mono** for labels, units, and metadata. Always uppercase, letter-spaced `.14em`–`.24em`, in `--steel`, 8–10px. This is the utility voice.
- **Archivo** for body prose only. There's very little of it.
- **All numeric data uses `font-variant-numeric: tabular-nums`.** Non-negotiable — digits must not jitter as values tick.

### The signature: mechanical odometer

The one memorable element. Everything else stays quiet so this can be loud.

- Digits roll vertically like a physical odometer — a 10-digit strip translated on the Y axis
- `transition: transform .58s cubic-bezier(.16,1,.3,1)` — heavy, mechanical, settles rather than eases
- On load: roll up from zero, staggered left→right, ~85ms per digit
- While recording: the last digit rolls as distance accrues; carries roll the digit to its left
- The decimal point is `--signal` blue. It's the only blue in the readout.

Implementation reference is in the prototype's `<script>`. Port the mechanic, not the HTML.

### Motion

Restrained. Three places only:

1. **Odometer roll** — the signature (above)
2. **Recording pulse** — `1.6s ease-in-out infinite`, opacity 1→.28 with slight scale. The only ambient animation in the app.
3. **Button travel** — physical depression, `top: 5px` with the shadow collapsing under it, `.07s linear`. Feels mechanical, not springy.

Everything else is static. Extra animation is what makes an app read as generated.

**Respect `prefers-reduced-motion: reduce`** — kill all animation and transition.

### Ergonomics — the deliberate risk

**The record button is oversized past what a design system would call correct.** 76px tall, full-width, with real physical travel. This is not a mistake to be corrected.

A rider taps it wearing winter gloves, at a chai stop, at 3,000m, with cold hands. Ergonomics drive the composition here, not a grid. The same logic applies to any in-ride control: **minimum 64px touch targets on the record screen**, generous spacing, no small taps.

Off the record screen, normal touch targets are fine.

### Layout patterns

- **Screen padding:** 26px horizontal, consistently
- **Cards:** `--slate` fill, `1px solid --hair` border, 14px radius
- **Active card:** 2px `--signal` left edge (`::before`), not a glow or a full border
- **Data strips:** hairline top/bottom rules, cells divided by `1px solid --hair` verticals. Rules, not boxes.
- **Meters (service intervals):** discrete ticks, not a progress bar. Reads like a fuel gauge because that's the rider's vernacular. Filled = `--moss`, warning = `--amber`, empty = `--slate-2`.

### The gap footnote

The product's thesis, made visual. Under the data strip on the record screen:

```
---- 4 min gap near Chitkul — not counted
```

A short dashed rule in `--signal` at .7 opacity, then plain `--steel` text. **A footnote, not an alarm** — it's information, not a failure. The matching track segment on the map renders dashed at reduced opacity.

This is rule 2 from the front matter, rendered. Don't let a designer or a PM turn it into a warning banner.

### Copy voice

- **Sentence case.** Not Title Case, not ALL CAPS — except mono labels, which are always uppercase.
- **Active voice, plain verbs.** "Finish ride", not "End Activity". "Due in 558 km", not "Maintenance Alert".
- **An action keeps its name through the whole flow.** The button that says "Finish ride" produces a screen that says "Ride finished".
- **Never apologize, never be vague.** "4 min gap near Chitkul — not counted" states what happened and its consequence. No "Oops!", no "Something went wrong".
- **Empty states are invitations, not mood.** "Add your first bike" — not "No bikes yet".
- **Name things the rider recognizes.** Odometer, chain slack, unpaved. Not `sync_state`, not `segment_seq`.

### Quality floor — no exceptions

- Responsive to small phones (360px wide minimum)
- Visible keyboard focus states
- `prefers-reduced-motion` respected
- Tabular numerals on every number
- No layout shift when values update

---

## 9. Screens (Phase 01)

| Screen | Contents |
|---|---|
| Auth | Apple / Google / email |
| Onboarding | Add first bike → permission explainer → OEM whitelist (conditional) |
| Garage | Bike list; per-bike: total km, ride count, odometer |
| Bike detail | Edit, photo, mods, ride history for this bike |
| Record | Big start/stop. In-ride: distance, elapsed, elevation, GPS status |
| Ride list | Reverse-chron, distance + date + bike |
| Ride detail | Static map preview, stats, edit title/note, "Share as route" |
| Route share | One photo, one line, auto-filled stats. **Low friction — this is the core loop.** |
| Route detail | Map, stats, author, **Navigate** button → GPX export → Google Maps |
| Profile | Handle, avatar, public/private toggle, privacy zones |
| Settings | Permissions status, OEM whitelist re-run, sign out |

### Screen notes

Design system is §8. The prototype covers **Record** and **Garage** in full — match them.

- **Record** — the odometer is the screen. Live map bed behind it, scrimmed so the track reads but the numbers dominate. Gap footnote under the data strip. Oversized controls (§8 ergonomics). No speed field, ever.
- **Garage** — bike cards with odometer, ride count, unpaved %. Active bike carries the blue left edge. Service meter as ticks, warning in amber. Lifetime totals in the header.
- **Route share** — the lowest-friction screen in the app. One photo, one line, stats pre-filled. Every field beyond that costs contributions. This is the core loop.
- **Onboarding** — add a bike *before* asking for location (§7). The garage is non-empty before the first ride, so the app is never a blank slate.
- **Ride detail** — gaps render dashed on the map preview and are stated in plain text. Never hide them.

---

## 10. GPX export / navigation handoff

We do **not** build turn-by-turn. That's the entire strategic wedge — REVER's nav is their weakest surface and it drags down everything else.

- Generate GPX 1.1 from `routes.geom` (privacy-clipped)
- Android: share intent → Google Maps / any GPX consumer
- iOS: share sheet → Files / Google Maps
- Also expose a "waypoints in Google Maps" deep link for simple routes

---

## 11. Build order

1. **Task 1** — background GPS prototype. Report the numbers, then continue regardless.
2. Supabase project, PostGIS, schema, RLS policies, seed script
3. Expo dev client shell, TypeScript strict, Sentry, auth
4. **Design tokens + primitives** — port §8 into the theme: colors, type scale, fonts, the odometer component, button travel, mono label style. Build this before any screen, or you'll retrofit it into every one.
5. Profiles + garage (bikes CRUD)
6. Local SQLite + recording engine + foreground service + notification
7. OEM whitelist flow + permission flow
8. Sync pipeline + server-side distance computation
9. Ride list + ride detail
10. Route sharing + GPX export
11. Privacy zones + public/private toggle end-to-end
12. Test pass (§12)

---

## 12. Testing requirements

- **Privacy-zone clipping needs real automated test coverage.** A bug here leaks someone's home address. Not manual checking.
- RLS policy tests: assert a private profile's rides are invisible to an anonymous client and to another authenticated user
- Sync: dead-zone ride → reconnect → verify no point loss, verify gaps recorded as gaps not interpolated
- Kill-recovery: force-stop mid-ride → relaunch → verify track recoverable and the gap is marked
- Gap handling: synthetic track with a known dropout → assert `distance_km` excludes the gap
- Battery: measured on a real 3h+ ride, on an OEM-skinned Android
- Do **not** ship on simulator testing alone

---

## 12b. Early tester expectations — build this in

GPS gets tuned with real testers rather than in a lab. That's the strategy, and it's fine — but testers are riding real routes and expect their tracks kept. Losing someone's Spiti ride without warning is how you lose a tester permanently.

- Ship a **"Recording is in beta"** notice on the record screen during the tester phase. Plain language: tracks may have gaps, keep your odometer as backup.
- Every ride with `gap_count > 0` shows the honest summary (§5) — never hide it.
- One-tap "report bad recording" on ride detail → ships the raw point log + device model + OS version + battery state to us. This is the actual feedback loop that fixes GPS; make it frictionless.
- Track `gap_count`, `gap_duration_s`, device manufacturer, and OS version in PostHog from day one. Tuning without that data is guesswork.
- Manual ride entry (distance + date + bike, no track) as a fallback. If recording fails, the rider can still keep their odometer honest — and the garage stays useful regardless of GPS quality.

Testers forgive known bugs. They don't forgive lost data they weren't warned about.

---

## 13. Explicitly out of scope (Phase 02)

Tile service, MapLibre trace map with density rendering, follows/follow-requests, groups, group chat, planned rides, public ride invites, route condition reports, forums.

Don't stub them. Don't build "just the schema for now." The `follows`-aware RLS shape in §3 is the only forward accommodation.

---

## 14. Open questions — flag, don't guess

- Base map vendor for static ride previews: Mapbox vs Protomaps (cost vs setup)
- Photo count per ride and resolution ceiling → storage cost per active user
- Whether `distance_km` should exclude auto-paused segments

---

## Definition of done — Phase 01

A rider can: sign up → add a bike → record a multi-hour ride with the screen off on a Xiaomi → sync when signal returns → see it in their garage with the odometer updated → share it as a route → have another rider open that route and navigate it in Google Maps.

That's the core loop.

**Recording quality is not the bar for shipping v1 — honesty about recording quality is.** If the track has gaps, the ride still saves, the gaps are visible, the distance excludes them, and the rider knows. A ride with three marked gaps is a shipped feature. A ride with a straight line fabricated across a 6km dropout is a bug, regardless of how good it looks.

---

## Appendix A — Reference prototype

The full source of `trace_prototype.html`. Open it in a browser before writing UI: the odometer rolls on load and ticks live, and the buttons have real travel.

This is a **visual reference, not a codebase**. Port the mechanics and tokens into React Native — don't transliterate the HTML.

<details>
<summary>trace_prototype.html — click to expand</summary>

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TRACE — Prototype</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{
    --void:#0B0D0E;
    --slate:#14181A;
    --slate-2:#1C2224;
    --white:#E8EAEA;
    --signal:#2E7DFF;
    --amber:#F5A623;
    --moss:#3F5570;
    --steel:#8A9196;
    --hair:rgba(232,234,234,.10);
    --disp:'Barlow Condensed',sans-serif;
    --body:'Archivo',sans-serif;
    --mono:'JetBrains Mono',monospace;
  }
  *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
  html,body{background:#000;font-family:var(--body);color:var(--white)}
  body{
    min-height:100vh;display:flex;align-items:center;justify-content:center;
    gap:38px;padding:40px 20px;flex-wrap:wrap;
    background:
      radial-gradient(900px 500px at 50% -10%, #16191b 0%, #000 70%);
  }

  /* ---- device frame ---- */
  .device{
    width:390px;height:844px;background:var(--void);border-radius:44px;
    position:relative;overflow:hidden;
    border:1px solid rgba(255,255,255,.08);
    box-shadow:0 40px 90px rgba(0,0,0,.9), 0 0 0 10px #0a0a0a, 0 0 0 11px #222;
    flex:0 0 auto;
  }
  .device::after{
    content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);
    width:112px;height:30px;background:#000;border-radius:0 0 18px 18px;z-index:60;
  }
  .cap{
    position:absolute;bottom:-34px;left:0;right:0;text-align:center;
    font-family:var(--mono);font-size:10px;letter-spacing:.16em;
    color:#5b6266;text-transform:uppercase;
  }
  .screen{position:absolute;inset:0;overflow:hidden;display:flex;flex-direction:column}

  /* ---- status bar ---- */
  .status{
    height:52px;flex:0 0 auto;display:flex;align-items:flex-end;justify-content:space-between;
    padding:0 26px 6px;font-family:var(--mono);font-size:11px;color:var(--white);
    letter-spacing:.02em;z-index:50;
  }
  .status .r{display:flex;gap:5px;align-items:center;opacity:.9}
  .bars{display:flex;gap:1.5px;align-items:flex-end;height:9px}
  .bars i{width:2.5px;background:var(--white);border-radius:.5px}
  .bars i:nth-child(1){height:3px}.bars i:nth-child(2){height:5px}
  .bars i:nth-child(3){height:7px}.bars i:nth-child(4){height:9px;opacity:.35}
  .batt{width:20px;height:10px;border:1.2px solid var(--white);border-radius:2.5px;position:relative;opacity:.9}
  .batt::after{content:'';position:absolute;right:-3px;top:2.6px;width:1.6px;height:4px;background:var(--white);border-radius:0 1px 1px 0}
  .batt i{position:absolute;inset:1.4px;width:62%;background:var(--white);border-radius:1px}

  /* =========================================================
     RECORD SCREEN
     ========================================================= */
  .rec{flex:1;display:flex;flex-direction:column;position:relative}

  /* live map bed */
  .bed{position:absolute;inset:0;overflow:hidden}
  .bed svg{position:absolute;inset:0;width:100%;height:100%}
  .bed::after{
    content:'';position:absolute;inset:0;
    background:linear-gradient(180deg,
      rgba(11,13,14,.55) 0%,
      rgba(11,13,14,.10) 26%,
      rgba(11,13,14,.10) 44%,
      rgba(11,13,14,.92) 74%,
      var(--void) 86%);
  }

  .rec-top{
    position:relative;z-index:10;padding:6px 26px 0;
    display:flex;justify-content:space-between;align-items:flex-start;
  }
  .live{
    display:flex;align-items:center;gap:7px;
    font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--signal);
  }
  .live b{width:6px;height:6px;border-radius:50%;background:var(--signal);animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.28;transform:scale(.8)}}
  .gpsbox{text-align:right}
  .gpslab{font-family:var(--mono);font-size:9px;letter-spacing:.14em;color:var(--steel);margin-bottom:4px}
  .gpsbars{display:flex;gap:2px;justify-content:flex-end;height:11px;align-items:flex-end}
  .gpsbars i{width:3px;background:var(--moss);border-radius:.5px}
  .gpsbars i:nth-child(1){height:4px}.gpsbars i:nth-child(2){height:6px}
  .gpsbars i:nth-child(3){height:8.5px}.gpsbars i:nth-child(4){height:11px}
  .gpsbars.good i{background:#7BC47F}

  /* the odometer — signature element */
  .odo{position:relative;z-index:10;padding:0 26px;margin-top:auto}
  .odo-lab{
    font-family:var(--mono);font-size:9.5px;letter-spacing:.24em;color:var(--steel);
    margin-bottom:6px;
  }
  .odo-row{display:flex;align-items:baseline;gap:8px}
  .digits{display:flex;align-items:baseline}
  .dig{
    position:relative;width:38px;height:66px;overflow:hidden;
  }
  .dig .strip{
    position:absolute;top:0;left:0;right:0;
    display:flex;flex-direction:column;align-items:center;
    transition:transform .58s cubic-bezier(.16,1,.3,1);
    will-change:transform;
  }
  .dig .strip span{
    height:66px;line-height:66px;
    font-family:var(--disp);font-weight:700;font-size:62px;
    color:var(--white);font-variant-numeric:tabular-nums;
  }
  .dot{
    font-family:var(--disp);font-weight:700;font-size:62px;line-height:66px;
    color:var(--signal);margin:0 1px;
  }
  .unit{
    font-family:var(--disp);font-weight:600;font-size:19px;letter-spacing:.1em;
    color:var(--steel);text-transform:uppercase;padding-bottom:9px;
  }

  /* secondary readout */
  .strip-data{
    position:relative;z-index:10;display:flex;
    border-top:1px solid var(--hair);border-bottom:1px solid var(--hair);
    margin:18px 26px 0;
  }
  .cellx{flex:1;padding:13px 0}
  .cellx + .cellx{border-left:1px solid var(--hair);padding-left:16px}
  .cl{font-family:var(--mono);font-size:8.5px;letter-spacing:.16em;color:var(--steel);margin-bottom:5px}
  .cv{font-family:var(--disp);font-weight:600;font-size:25px;color:var(--white);font-variant-numeric:tabular-nums;line-height:1}
  .cv small{font-size:12px;color:var(--steel);font-weight:500;margin-left:2px}

  /* gap notice — honest, but a footnote not an alarm */
  .gap{
    position:relative;z-index:10;margin:13px 26px 0;
    display:flex;gap:8px;align-items:center;
  }
  .gap .dash{
    flex:0 0 auto;width:18px;height:0;
    border-top:1.5px dashed var(--signal);opacity:.7;
  }
  .gap p{font-size:11px;line-height:1.4;color:var(--steel);letter-spacing:.005em}
  .gap p b{color:#B9C0C3;font-weight:500}

  /* record control — oversized on purpose: gloves */
  .ctrl{
    position:relative;z-index:10;
    padding:26px 26px 34px;display:flex;align-items:center;gap:16px;
  }
  .stop{
    flex:1;height:76px;border:none;border-radius:16px;cursor:pointer;
    background:var(--signal);color:#F2F7FF;
    font-family:var(--disp);font-weight:700;font-size:23px;letter-spacing:.13em;
    text-transform:uppercase;position:relative;top:0;
    box-shadow:0 5px 0 #1748A6, 0 14px 30px rgba(46,125,255,.32);
    transition:top .07s linear, box-shadow .07s linear;
  }
  .stop:active{top:5px;box-shadow:0 0 0 #1748A6, 0 6px 16px rgba(46,125,255,.24)}
  .pause{
    width:76px;height:76px;border-radius:16px;cursor:pointer;
    background:var(--slate-2);border:1px solid var(--hair);
    display:flex;align-items:center;justify-content:center;
    position:relative;top:0;box-shadow:0 5px 0 #0d1113;
    transition:top .07s linear, box-shadow .07s linear;
  }
  .pause:active{top:5px;box-shadow:0 0 0 #0d1113}
  .pause i{display:block;width:5px;height:22px;background:var(--white);border-radius:1px}
  .pause i + i{margin-left:5px}

  /* =========================================================
     GARAGE SCREEN
     ========================================================= */
  .gar{flex:1;display:flex;flex-direction:column;overflow:hidden}
  .gar-head{padding:10px 26px 0}
  .eyebrow{font-family:var(--mono);font-size:9.5px;letter-spacing:.24em;color:var(--steel)}
  .h1{
    font-family:var(--disp);font-weight:700;font-size:41px;letter-spacing:-.005em;
    line-height:1;margin-top:7px;text-transform:uppercase;
  }
  .totals{
    display:flex;gap:26px;margin-top:16px;padding-bottom:18px;
    border-bottom:1px solid var(--hair);
  }
  .tot .tl{font-family:var(--mono);font-size:8.5px;letter-spacing:.16em;color:var(--steel);margin-bottom:4px}
  .tot .tv{font-family:var(--disp);font-weight:700;font-size:23px;font-variant-numeric:tabular-nums;line-height:1}
  .tot .tv small{font-size:11px;color:var(--steel);font-weight:500}

  .scroll{flex:1;overflow-y:auto;padding:18px 26px 100px;scrollbar-width:none}
  .scroll::-webkit-scrollbar{display:none}

  .bike{
    background:var(--slate);border:1px solid var(--hair);border-radius:14px;
    padding:18px;margin-bottom:12px;position:relative;overflow:hidden;
    transition:border-color .2s, transform .2s;cursor:pointer;
  }
  .bike:hover{border-color:rgba(232,234,234,.2);transform:translateY(-1px)}
  .bike.on::before{
    content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--signal);
  }
  .bike-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}
  .bname{font-family:var(--disp);font-weight:700;font-size:23px;text-transform:uppercase;line-height:1.05}
  .bsub{font-family:var(--mono);font-size:9.5px;color:var(--steel);letter-spacing:.1em;margin-top:5px}
  .tag{
    font-family:var(--mono);font-size:8px;letter-spacing:.14em;padding:3.5px 7px;border-radius:3px;
    background:rgba(46,125,255,.14);color:var(--signal);border:1px solid rgba(46,125,255,.3);
  }
  .tag.rest{background:rgba(63,85,112,.2);color:#8FA3BC;border-color:rgba(63,85,112,.42)}

  .bstats{display:flex;gap:22px}
  .bs .bl{font-family:var(--mono);font-size:8px;letter-spacing:.14em;color:var(--steel);margin-bottom:3px}
  .bs .bv{font-family:var(--disp);font-weight:600;font-size:17px;font-variant-numeric:tabular-nums;line-height:1}
  .bs .bv small{font-size:9.5px;color:var(--steel)}

  /* service meter — mechanical, not a progress bar */
  .svc{margin-top:16px;padding-top:14px;border-top:1px solid var(--hair)}
  .svc-row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
  .svc-l{font-family:var(--mono);font-size:8.5px;letter-spacing:.14em;color:var(--steel)}
  .svc-v{font-family:var(--mono);font-size:10.5px;color:var(--white);font-weight:500}
  .svc-v.warn{color:var(--amber)}
  .ticks{display:flex;gap:2.5px;height:16px;align-items:flex-end}
  .ticks i{flex:1;background:var(--slate-2);border-radius:.5px;height:7px;transition:height .3s, background .3s}
  .ticks i.f{background:var(--moss);height:11px}
  .ticks i.w{background:var(--amber);height:16px}

  /* tab bar */
  .tabs{
    position:absolute;bottom:0;left:0;right:0;height:84px;
    background:linear-gradient(180deg, rgba(11,13,14,0) 0%, var(--void) 42%);
    display:flex;align-items:center;justify-content:space-around;
    padding:0 18px 22px;z-index:40;
  }
  .tab{
    display:flex;flex-direction:column;align-items:center;gap:5px;
    background:none;border:none;cursor:pointer;padding:6px 12px;
  }
  .tab span{font-family:var(--mono);font-size:8px;letter-spacing:.12em;color:#5b6266}
  .tab svg{stroke:#5b6266;fill:none;stroke-width:1.6}
  .tab.on span{color:var(--white)}
  .tab.on svg{stroke:var(--signal)}

  @media (prefers-reduced-motion:reduce){
    *{animation:none!important;transition:none!important}
  }
</style>
</head>
<body>

<!-- ============ RECORD ============ -->
<div class="device">
  <div class="screen">
    <div class="status">
      <span>14:38</span>
      <div class="r">
        <div class="bars"><i></i><i></i><i></i><i></i></div>
        <span style="font-size:9px;letter-spacing:.05em">4G</span>
        <div class="batt"><i></i></div>
      </div>
    </div>

    <div class="rec">
      <div class="bed">
        <svg viewBox="0 0 390 500" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="trk" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stop-color="#2E7DFF" stop-opacity=".3"/>
              <stop offset=".55" stop-color="#4A90FF" stop-opacity=".8"/>
              <stop offset="1" stop-color="#7FB4FF" stop-opacity="1"/>
            </linearGradient>
          </defs>
          <!-- terrain contours -->
          <g stroke="#222829" stroke-width="1" fill="none" opacity=".9">
            <path d="M-20 120 C 70 96, 150 150, 230 118 S 360 66, 420 96"/>
            <path d="M-20 158 C 80 132, 160 188, 240 154 S 366 104, 420 134"/>
            <path d="M-20 200 C 66 176, 158 228, 236 196 S 358 146, 420 176"/>
            <path d="M-20 250 C 88 224, 150 276, 244 244 S 352 196, 420 224"/>
            <path d="M-20 302 C 74 278, 162 326, 238 296 S 360 248, 420 276"/>
            <path d="M-20 352 C 84 330, 154 376, 246 348 S 350 300, 420 328"/>
            <path d="M-20 404 C 70 382, 160 426, 236 400 S 358 352, 420 380"/>
          </g>
          <!-- ridge -->
          <path d="M-20 258 L 58 196 L 118 236 L 186 150 L 250 214 L 318 162 L 410 224"
                stroke="#2C3335" stroke-width="1.2" fill="none" opacity=".8"/>
          <!-- ridden track -->
          <path d="M62 470 C 96 402, 74 356, 122 320 C 168 285, 150 240, 196 208
                   C 238 178, 226 138, 268 112"
                stroke="url(#trk)" stroke-width="3.4" fill="none"
                stroke-linecap="round" stroke-linejoin="round"/>
          <!-- gap segment: dashed, never interpolated -->
          <path d="M268 112 C 292 96, 300 82, 312 62"
                stroke="#2E7DFF" stroke-width="2.2" fill="none"
                stroke-dasharray="3 7" stroke-linecap="round" opacity=".55"/>
          <!-- current position -->
          <circle cx="62" cy="470" r="14" fill="#2E7DFF" opacity=".14"/>
          <circle cx="62" cy="470" r="5.5" fill="#2E7DFF" stroke="#0B0D0E" stroke-width="2"/>
        </svg>
      </div>

      <div class="rec-top">
        <div class="live"><b></b>RECORDING</div>
        <div class="gpsbox">
          <div class="gpslab">GPS</div>
          <div class="gpsbars good"><i></i><i></i><i></i><i></i></div>
        </div>
      </div>

      <div class="odo">
        <div class="odo-lab">DISTANCE — THIS RIDE</div>
        <div class="odo-row">
          <div class="digits" id="odo"></div>
          <span class="unit">km</span>
        </div>
      </div>

      <div class="strip-data">
        <div class="cellx">
          <div class="cl">ELAPSED</div>
          <div class="cv">3:12<small>:04</small></div>
        </div>
        <div class="cellx">
          <div class="cl">ELEVATION</div>
          <div class="cv">3,204<small>m</small></div>
        </div>
      </div>

      <div class="gap">
        <span class="dash"></span>
        <p><b>4 min gap near Chitkul</b> — not counted</p>
      </div>

      <div class="ctrl">
        <button class="stop">Finish ride</button>
        <button class="pause" aria-label="Pause"><i></i><i></i></button>
      </div>
    </div>
  </div>
  <div class="cap">Record — in ride</div>
</div>

<!-- ============ GARAGE ============ -->
<div class="device">
  <div class="screen">
    <div class="status">
      <span>14:38</span>
      <div class="r">
        <div class="bars"><i></i><i></i><i></i><i></i></div>
        <span style="font-size:9px;letter-spacing:.05em">4G</span>
        <div class="batt"><i></i></div>
      </div>
    </div>

    <div class="gar">
      <div class="gar-head">
        <div class="eyebrow">SUDHANYA — JAMMU</div>
        <h1 class="h1">Garage</h1>
        <div class="totals">
          <div class="tot">
            <div class="tl">LIFETIME</div>
            <div class="tv">48,206<small> km</small></div>
          </div>
          <div class="tot">
            <div class="tl">RIDES</div>
            <div class="tv">312</div>
          </div>
          <div class="tot">
            <div class="tl">BIKES</div>
            <div class="tv">3</div>
          </div>
        </div>
      </div>

      <div class="scroll">
        <div class="bike on">
          <div class="bike-top">
            <div>
              <div class="bname">Himalayan 450</div>
              <div class="bsub">2024 · GRANITE BLACK</div>
            </div>
            <div class="tag">ACTIVE</div>
          </div>
          <div class="bstats">
            <div class="bs"><div class="bl">ODOMETER</div><div class="bv">18,442<small> km</small></div></div>
            <div class="bs"><div class="bl">RIDES</div><div class="bv">96</div></div>
            <div class="bs"><div class="bl">UNPAVED</div><div class="bv">41<small>%</small></div></div>
          </div>
          <div class="svc">
            <div class="svc-row">
              <span class="svc-l">OIL CHANGE</span>
              <span class="svc-v warn">DUE IN 558 km</span>
            </div>
            <div class="ticks">
              <i class="f"></i><i class="f"></i><i class="f"></i><i class="f"></i><i class="f"></i>
              <i class="f"></i><i class="f"></i><i class="f"></i><i class="f"></i><i class="f"></i>
              <i class="f"></i><i class="f"></i><i class="f"></i><i class="w"></i><i></i>
            </div>
          </div>
        </div>

        <div class="bike">
          <div class="bike-top">
            <div>
              <div class="bname">Interceptor 650</div>
              <div class="bsub">2021 · MARK TWO</div>
            </div>
            <div class="tag rest">RESTING</div>
          </div>
          <div class="bstats">
            <div class="bs"><div class="bl">ODOMETER</div><div class="bv">24,118<small> km</small></div></div>
            <div class="bs"><div class="bl">RIDES</div><div class="bv">171</div></div>
            <div class="bs"><div class="bl">UNPAVED</div><div class="bv">8<small>%</small></div></div>
          </div>
          <div class="svc">
            <div class="svc-row">
              <span class="svc-l">CHAIN SLACK</span>
              <span class="svc-v">DUE IN 2,340 km</span>
            </div>
            <div class="ticks">
              <i class="f"></i><i class="f"></i><i class="f"></i><i class="f"></i><i class="f"></i>
              <i class="f"></i><i></i><i></i><i></i><i></i>
              <i></i><i></i><i></i><i></i><i></i>
            </div>
          </div>
        </div>

        <div class="bike">
          <div class="bike-top">
            <div>
              <div class="bname">Impulse 200</div>
              <div class="bsub">2013 · SOLD 2019</div>
            </div>
            <div class="tag rest">RETIRED</div>
          </div>
          <div class="bstats">
            <div class="bs"><div class="bl">ODOMETER</div><div class="bv">5,646<small> km</small></div></div>
            <div class="bs"><div class="bl">RIDES</div><div class="bv">45</div></div>
            <div class="bs"><div class="bl">UNPAVED</div><div class="bv">62<small>%</small></div></div>
          </div>
        </div>
      </div>

      <div class="tabs">
        <button class="tab on">
          <svg width="19" height="19" viewBox="0 0 20 20"><path d="M2 8l8-5.5L18 8v9a1 1 0 01-1 1H3a1 1 0 01-1-1V8z"/><path d="M7 18v-6h6v6"/></svg>
          <span>GARAGE</span>
        </button>
        <button class="tab">
          <svg width="19" height="19" viewBox="0 0 20 20"><path d="M2 15l5-11 6 8 5-5"/><circle cx="7" cy="4" r="1.4"/></svg>
          <span>TRACE</span>
        </button>
        <button class="tab">
          <svg width="19" height="19" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><circle cx="10" cy="10" r="3"/></svg>
          <span>RECORD</span>
        </button>
        <button class="tab">
          <svg width="19" height="19" viewBox="0 0 20 20"><circle cx="7" cy="7" r="3"/><path d="M2 17c0-3 2.2-5 5-5s5 2 5 5"/><path d="M13.5 5.5a3 3 0 010 5.6M15.5 17c0-2-.6-3.6-1.6-4.6"/></svg>
          <span>RIDERS</span>
        </button>
      </div>
    </div>
  </div>
  <div class="cap">Garage</div>
</div>

<script>
  // odometer: mechanical digit roll
  const VAL = '084.6';
  const odo = document.getElementById('odo');
  const strips = [];

  VAL.split('').forEach(ch => {
    if (ch === '.') {
      const d = document.createElement('span');
      d.className = 'dot'; d.textContent = '.';
      odo.appendChild(d);
      return;
    }
    const cell = document.createElement('div');
    cell.className = 'dig';
    const strip = document.createElement('div');
    strip.className = 'strip';
    for (let i = 0; i <= 9; i++) {
      const s = document.createElement('span');
      s.textContent = i;
      strip.appendChild(s);
    }
    cell.appendChild(strip);
    odo.appendChild(cell);
    strips.push({ strip, target: +ch });
  });

  const H = 66;
  const set = (o, v) => { o.strip.style.transform = `translateY(${-v * H}px)`; };
  strips.forEach(o => set(o, 0));

  // roll up on load, staggered left→right
  setTimeout(() => {
    strips.forEach((o, i) => setTimeout(() => set(o, o.target), i * 85));
  }, 350);

  // live tick: last digit rolls as distance accrues
  const last = strips[strips.length - 1];
  let cur = last.target;
  setInterval(() => {
    cur = (cur + 1) % 10;
    set(last, cur);
    if (cur === 0) {
      const tens = strips[strips.length - 2];
      tens.target = (tens.target + 1) % 10;
      set(tens, tens.target);
    }
  }, 2600);
</script>
</body>
</html>
```

</details>
