# TRACE

A community and exploration platform for motorcycle riders — built around the roads you've actually ridden, not the times you've posted.

**Spec:** [TRACE_BUILD_SPEC.md](TRACE_BUILD_SPEC.md) — Phase 01 scope (Record + Share + Garage).

## Layout

| Path | What |
|---|---|
| `prototype/` | Task 1 — throwaway background-GPS calibration app (§2 of the spec). Records a track to local SQLite with a foreground service. Ridden for real to measure gap profile, battery drain, and OS kill behaviour. Not production code. |

## The three rules

1. Distance over speed. Never speed — no pace, no leaderboards, anywhere.
2. Never fabricate distance the rider didn't cover. Gaps are gaps.
3. No turn-by-turn navigation. GPX export → Google Maps.
