# §12 device test checklist

What the automated suite (`npm test`) can't reach — these need hands, a bike, and real sky.
Do not ship to testers with any of these unchecked (§12: "Do not ship on simulator testing alone").

## Kill-recovery (§5 — mandatory behaviour)
- [ ] Start a recording, force-stop TRACE from app settings, relaunch
      → the record screen must show "Recording was interrupted" with Resume / Finish here
      → resuming continues the same ride; the silence appears as a stop or a gap by the §5 rules, never a straight line
- [ ] Same, but reboot the phone instead of force-stop

## Dead-zone sync (§4)
- [ ] Record a ride that passes through a real no-signal stretch (no airplane mode — false proxy)
      → after signal returns, the ride syncs with no point loss
      → gaps recorded as gaps: `gap_count` on the server row matches what the record screen showed

## Battery (§2 targets, unverified since Task 1 was skipped)
- [ ] 3h+ real ride, screen off, phone in a bag: battery %/hour noted (expected band 15–20%/h)
- [ ] **On an OEM-skinned device (Xiaomi/Vivo/Oppo/OnePlus)** — still outstanding; borrow one
      → without whitelisting: does the OS kill the recorder? Does the killed-ride re-prompt appear?
      → after the §6 walkthrough: does recording survive the same ride?

## Foreground service (§6)
- [ ] Notification appears when recording starts, shows live distance · elapsed · elevation, updates while riding
- [ ] Tapping it opens the app
- [ ] Auto-pause: stop moving 2 min → AUTO-PAUSED indicator; move → resumes alone
- [ ] 15-min stop → one "Still riding?" notification, ride does NOT auto-end

## Permission flow (§7)
- [ ] Fresh install: garage exists before any location dialog
- [ ] First Record tap: explainer sheet → WHEN_IN_USE → ALWAYS, in that order
- [ ] Deny ALWAYS: recording still works foreground-only with the amber warning; no nagging on later launches

## Core loop, two phones
- [ ] Rider A records → syncs → shares route with photo
- [ ] Rider B (second account, A set to public) opens the route, sees the clipped track,
      taps Navigate → GPX opens in Google Maps and the route is followable
