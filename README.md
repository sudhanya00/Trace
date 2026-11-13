# TRACE

**A community and exploration app for motorcycle riders, built around the
roads you've actually ridden, not the times you've posted.**

Record a ride with the phone in a tank bag, keep a garage whose odometers
follow your rides, find roads other riders have really covered, and ride
with a crew.

![Expo](https://img.shields.io/badge/Expo-57-000020?logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-0.86-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20PostGIS-3FCF8E?logo=supabase&logoColor=white)

## The three rules

Every engineering decision in this repo follows from three product rules.

1. **Distance over speed. Never speed.** No pace, no leaderboards, no segment
   times, anywhere.
2. **Never fabricate distance the rider didn't cover.** A GPS dropout is
   recorded as a gap. It is never joined with a straight line.
3. **No turn-by-turn navigation.** Routes export as GPX and hand off to
   Google Maps.

## What's in the app

- **Record.** Background GPS recording that survives the screen being off,
  hours without signal and the app being killed. Interrupted rides are
  offered back as *Resume* or *Finish here*.
- **Garage.** Every bike you own or have ridden, with an odometer that
  advances from logged rides.
- **Routes.** Save, plan, share and follow routes; export GPX.
- **Explore and Ride AI.** Find roads near you ranked by who has actually
  ridden them, or ask in plain language where to ride.
- **Riders and crews.** Follows, posts, route threads, crews, public ride
  invites with meetup points, and live location sharing within a crew.
- **Privacy zones.** Draw a zone around home or work and every shared track
  is clipped on the server before anyone else can see it.

## Engineering notes

- **Offline first.** Rides are written to on-device SQLite and that copy is
  the source of truth until sync succeeds, because the first riders are in
  the Himalayas with no signal for hours.
- **Gap rules are pure and tested.** `mobile/src/lib/gapRules.ts` classifies
  every GPS fix. It was rewritten after a real ride lost about 20 km to false
  gaps: the fix was to tell apart a reading that was *thrown away* (noisy
  GPS, rider still moving) from one that was *never received* (true signal
  loss).
- **Authorization lives in the database.** Postgres Row-Level Security
  decides who can read what; the client is never trusted. Distance,
  privacy-zone clipping and odometer sync are computed server-side with
  PostGIS.
- **CI rebuilds the database from nothing.** Every push starts a fresh
  Supabase stack, applies all 36 migrations and runs the suite (about 150
  tests, most of them against the real schema). It exists because a security audit
  found a read policy that had been widened without its table grant being
  narrowed; that class of mistake now fails the build.
- **Ride AI runs as the rider.** The edge function forwards the rider's own
  JWT, so the model's tools are bounded by the same RLS as the app. It never
  holds a service key, every road in an answer is re-fetched before it is
  shown, and requests are throttled per rider.
- **Built for difficult phones.** Xiaomi, Vivo and Oppo handsets kill
  background apps aggressively, so the app detects the manufacturer and walks
  the rider through the exact battery settings to change.

## Stack

| Concern | Choice |
|---|---|
| Mobile | React Native + Expo (dev client), Expo Router, TypeScript strict |
| Maps | MapLibre |
| Backend | Supabase: Postgres + PostGIS, Auth, Edge Functions |
| Local store | SQLite (`expo-sqlite`) as the offline buffer |
| Location | `expo-location` + `expo-task-manager` foreground service |
| AI | Gemini, called from a Supabase Edge Function |
| Monitoring | Sentry, PostHog |
| CI | GitHub Actions: database built from migrations, then the full suite |

## Repository layout

| Path | What |
|---|---|
| `mobile/` | The app. `app/` holds screens (Expo Router), `src/lib/` the recording engine, sync, GPX and geo code, `tests/` the suite and a device checklist for what automation can't reach. |
| `supabase/` | 36 migrations (schema, RLS, PostGIS functions) and the `geo` and `ride-ai` edge functions. |
| `prototype/` | A throwaway background-GPS calibration app, ridden for real to measure gap profile, battery drain and OS kill behaviour before the main build. Not production code. |
| [TRACE_BUILD_SPEC.md](TRACE_BUILD_SPEC.md) | The build specification: product context, schema, recording engine, design system. |
| [RIDE_AI_SPEC.md](RIDE_AI_SPEC.md) | The specification for Ride AI. |

## Run locally

Needs Node 22, Docker (for the local Supabase stack) and an Android device or
emulator. The app uses native modules, so it runs in an Expo dev client, not
Expo Go.

```bash
cd mobile && npm install
```

From the repository root, start the local Supabase stack and build the
database from the migrations:

```bash
npx supabase start && npx supabase db reset
```

```bash
cd mobile && npm test
```

```bash
cd mobile && npx expo run:android
```

## Status

Pre-release. Phase 01 (Record, Share, Garage) is built along with the first
community features; the app is not on the stores yet.
