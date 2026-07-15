# Task 1 — background GPS prototype

Throwaway calibration app (§2 of [TRACE_BUILD_SPEC.md](../TRACE_BUILD_SPEC.md)). It records a background GPS track to local SQLite and exports the raw log. Its only output is numbers: gap profile, battery drain/hour, accuracy, and whether the OS killed the process. **Not production code.**

## What it does

- `expo-location` background updates + `expo-task-manager`, foreground service with persistent notification on Android
- Every fix written to SQLite immediately (ts, lat, lng, accuracy, altitude, speed, battery) — never memory-only
- Fixes are logged **raw** — no accuracy filtering, so cold-start noise and drift are visible in the data
- `js_context_start` events mark JS context births: a second one inside a session = the OS killed the process
- Recovery notice if a session is found with no running recorder
- Export any finished session as JSON via the share sheet

## Build (EAS, one-time setup)

```powershell
cd prototype
npx eas-cli login          # expo.dev account
npx eas-cli init           # links the project, writes projectId into app.json
npx eas-cli build -p android --profile prototype
```

The build finishes with an APK link — open it on the phone, install (allow "install unknown apps" if prompted).

## Ride protocol (from the spec — do not soften it)

1. Real ride, **minimum 3 hours**, phone in a bag, **screen off**
2. Start from a full or known battery %, note it
3. Ride through actual dead zones — **do not use airplane mode as a proxy**
4. When asked for location access, choose **Allow all the time**
5. After the ride: Finish recording → Export → send the JSON

## What the numbers mean

- **Gaps >60s** counts intervals over 60 s between consecutive fixes. Caveat: recording uses `distanceInterval: 25m`, so standing still (chai stop, photo stop) also produces no fixes — cross-check gap timestamps against where you actually stopped.
- **Battery used** is first-fix battery minus last-fix battery. Divide by ride hours for the %/hour figure (target band: 15–20%/hour).
- Two or more `js_context_start` events in one session's export = the process was killed and restarted. Zero fixes for a long stretch **plus** a context restart = killed and *not* restarted promptly — that's the OEM-killer signature.

## Open item

This first test device is stock-ish Android. OEM battery-killer behaviour (Xiaomi/Vivo/Oppo/OnePlus) stays **unverified** until the same ride happens on one of those handsets — borrow one from the riding network before the tester phase.
