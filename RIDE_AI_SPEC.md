# RIDE AI — Build Specification

**For:** coding agent
**Replaces:** the curated-rides section of Explore (killed, user + cofounder decision 2026-07-26)
**Depends on:** `TRACE_BUILD_SPEC.md` §1 (stack), §8 (design system), §10 (GPX handoff)

---

## What this is

A rider lands in a city they don't know and asks where to ride. Ride AI answers,
using the two things a general-purpose chatbot cannot: **who has actually ridden
there**, and **who this rider actually is**.

It replaces curated routes. Curated content is a treadmill — it needs staff, it
goes stale exactly where staleness is dangerous, and a "top 10 rides in Himachal"
list is something Google already indexes. Killing it also removes the entire
reason `profiles.is_admin` exists (its only use is the three curated-route
policies in `20260724000100`), which retires the privilege-escalation surface
closed on 26 July rather than continuing to guard it.

### What it is not

Not personalisation. "Based on your history, you'll like this" competes with the
rider's own knowledge of their own roads, and loses. **Discovery is the product**:
*you are somewhere you don't know, here is what is here.* Personalisation is the
ranking layer on top, not the pitch.

The distinction decides what data matters. A discovery planner needs other
riders' data; a personalisation planner needs the rider's own. Build the first.

---

## The three product rules still apply

From the front matter of the main spec, unchanged and binding here:

1. **Distance over speed. Never speed.** The planner never ranks or describes a
   road by how fast it can be ridden.
2. **Never fabricate distance the rider didn't cover** — extended: **the planner
   never invents geometry.** Every suggestion resolves to a real recorded track,
   a real user route, or waypoints the rider confirmed. A model may name a road;
   it may never draw one.
3. **We don't build turn-by-turn.** The planner ends at a planned ride and a GPX
   handoff, exactly as today.

---

## 1. Architecture — three layers

```
 ┌── layer 1: candidates ────────────────────────────────────┐
 │  claude-opus-5, with tools. Proposes named roads near a   │
 │  place. World knowledge + tool lookups against our DB.    │
 └───────────────────────────┬───────────────────────────────┘
                             │  candidate list (names + place refs)
 ┌───────────────────────────▼───────────────────────────────┐
 │  layer 2: the ranker — DETERMINISTIC TypeScript/SQL.      │
 │  Hard filters (season, altitude, bike capability) and     │
 │  soft scoring against the rider fingerprint. No model     │
 │  judgement on anything safety-relevant.                   │
 └───────────────────────────┬───────────────────────────────┘
                             │  ranked, filtered, annotated
 ┌───────────────────────────▼───────────────────────────────┐
 │  layer 3: presentation — provenance badges, attribute     │
 │  warnings, and the one-tap handoff into a planned ride.   │
 └───────────────────────────────────────────────────────────┘
```

**The model proposes; deterministic code disposes.** Anything that can hurt a
rider — seasonal closure, altitude versus demonstrated experience, bike
capability — is decided in code against columns, never by model judgement. The
model is a naming and phrasing engine with tools. That boundary is the whole
safety design.

---

## 2. What the ranker knows that ChatGPT doesn't

### 2a. The rider fingerprint — derived, never declared

`min_experience` is a self-declared dropdown set once at onboarding, and
self-declared experience is miscalibrated in the obvious direction. Everyone is
"intermediate". Do not rank on it.

Derive instead, server-side, from data that cannot be posed:

| Signal | Source |
|---|---|
| Longest single day | `max(rides.distance_km)` |
| Total distance ridden | `sum(rides.distance_km)` |
| Highest altitude ridden | `max(routes.max_altitude_m)` over routes the rider has ridden |
| Unpaved share | `routes.terrain_tags` across ridden routes |
| Hardest completed difficulty | `max(routes.difficulty)` over ridden routes |
| Bike capability | `bikes.type` **and** `bikes.current_odometer_km` |
| Season activity | month histogram of `rides.started_at` |
| Home region | `profiles.home_region` |

A rider with 40,000 km on a commuter is a different proposition from one with
900 km on an adv. Odometer is the signal; category alone is not.

**A new rider has none of this.** That is correct and expected — the new-city
case is also the empty-history case. Fall back to bike capability and stated
region, and rank on community density instead of fit. Do not block on a
fingerprint that cannot exist yet.

### 2b. Community data

Everything `20260724000100` already put on `routes` is ranker input and none of
it needed a new model: `region`, `difficulty`, `terrain_tags`, `best_season`,
`road_status`, `road_status_updated`, `hazards`, `network_coverage`,
`elevation_gain_m`, `max_altitude_m`, `est_duration_minutes`,
`bike_recommendation`, `rating_avg`, `rating_count`. Plus `condition_reports`
with their `rode_it` provenance flag.

### 2c. Weather at the plan horizon, not today

"Is it raining now" is the wrong question — people plan rides for Saturday. Pull
the forecast for the date the rider has actually chosen, which hooks straight
into `WhenPicker` and `src/lib/when.ts`, which already know that date.

---

## 3. Provenance — badge the presence, never the absence

The instinct to caption every unverified row *"nobody on TRACE has ridden this"*
is wrong, and wrong in a way this codebase has already been bitten by. A caveat
on 100% of rows carries zero information; people stop reading it, and then it
isn't there on the row where it matters. It is the same failure as a permanently
red security check.

**Invert it. Mark what is verified; say nothing otherwise.**

- **A verified row** carries a badge: *"6 riders · last report clear, 12 days ago"*.
- **An unverified row** carries nothing. It is a suggestion, which is the
  default, and the default needs no apology.

At launch there are almost no badges and the list simply looks like a list. As
regional density grows, badges appear and become the thing riders look for. The
badge is a reward for contribution, not a scolding for its absence — and it is
the same discipline as the `--signal` rule in §8: mark the exception, never the
default.

### Safety labels are a separate thing, and they are not universal

Provenance answers *has anyone ridden this*. Safety answers *is this road going
to hurt you*, and it fires on **specific attributes**, on the handful of rows
where it is true:

| Condition | Label |
|---|---|
| `max_altitude_m > 3500` | *High pass — thin air, and cold after dark* |
| `best_season` excludes the planned month | *Usually shut before June* |
| `road_status <> 'open'` | *Reported {status} on {road_status_updated}* |
| `network_coverage = 'none'` | *No signal for most of this* |

Where a candidate comes from world knowledge and carries no attributes, ask the
model for **exactly the two that matter** — is this a high pass, does it close
seasonally — rather than emitting a general disclaimer. Those are narrow factual
questions, they are checkable against reality later, and a warning that appears
on four rows out of forty is a warning that gets read.

Amber, never blue. §8's rule holds: a caution is never the illumination colour.

---

## 4. The flywheel — the planner is how the data gets made

The planner is not only a consumer of the moat. Early on it is the cheapest way
to build it:

```
  asks where to ride
        │
        ▼
  suggestion (unverified)
        │  one tap
        ▼
  planned ride  ──▶  recorded ride  ──▶  route + condition report
                                              │
                                              ▼
                                     verified for everyone after
```

So the handoff is a first-class action, not an afterthought. From any suggestion:

- **Plan this ride** → `createPlannedRoute` / `createAdhocRoute` and straight
  into the existing invite flow, with `WhenPicker` for the when.
- **After the ride** → the existing share-as-route prompt, which now closes the
  loop for every rider who asks about that road afterwards.

That reframes the empty state honestly. Early on the planner is a decent
recommender that happens to know your bike; its job at that stage is to generate
first rides. The differentiation compounds later, and it compounds *because of*
what it caused.

---

## 5. Where it runs, and what leaves the building

### Server-side, no exceptions

A new edge function, `supabase/functions/ride-ai/`, following the `geo` pattern
for the same four reasons named in that file's header — an API key in an APK is
an API key anyone can extract, the paywall can only be enforced server-side, the
calls cost money, and providers change.

### Privacy — what the model is allowed to see

This is the section to get right. The planner touches ride history and location,
which is precisely the data the audit of 26 July spent a day protecting.

**Never sent to the model:**

- Raw GPS tracks or `ride_tracks.geom`, in any form
- Any coordinate inside one of the rider's `privacy_zones`
- `handle`, email, `auth.uid()`, or any identifier
- Another rider's anything — community signals go as **counts and aggregates**
  ("6 riders have ridden this"), never as people

**Sent:**

- The derived fingerprint from §2a — scalars and buckets, no coordinates
- Region and place names at city/district granularity
- Route metadata that is already public through `routes_public`

The fingerprint is assembled by a `SECURITY DEFINER` function that returns
aggregates only. Per the sweep of 26 July, it pins `search_path`, revokes from
`public` **and names `anon` explicitly** (`revoke ... from public` does not
remove anon on hosted — see `20260726000600`), and gates on `auth.uid()`.
Nothing that ends up in a prompt should be reachable by a caller who isn't the
rider it describes.

---

## 6. Model configuration

Verified against the current API reference, not from memory.

| Setting | Value | Why |
|---|---|---|
| Model | `claude-opus-5` | Current Opus. 1M context, $5/$25 per MTok. |
| Thinking | `{type: "adaptive"}` | **Leave it on.** See the warning below. |
| Effort | `output_config: {effort: "medium"}` | Start here and sweep. `low`/`medium` are unusually strong on this model, and this is an interactive chat where latency is felt. |
| Streaming | Yes | It's a chat. Use `.stream()` and `.finalMessage()`. |
| `max_tokens` | 8000 | Ample for a turn; streaming means no timeout concern. |
| Sampling | **None** | `temperature`, `top_p`, `top_k` are removed on Opus 5 and return a 400. Steer with the prompt. |

### Do not disable thinking

Opus 5 has thinking on by default, and turning it off has a failure mode that
lands directly on this feature: with `thinking: {type: "disabled"}` the model
occasionally writes a **tool call into its visible text** instead of emitting a
`tool_use` block. The turn completes normally, the call never runs, and there is
no error — a harness sees a successful turn that silently did nothing, and in a
chat loop that text stays in history and skews later turns. It can also leak
`<thinking>` tags into user-facing output.

This is a tool-driven agent. Leave thinking on and use `effort` to control cost.

### Other request-shape notes

- **Prompt caching.** The system prompt and tool definitions are stable across
  every turn — put `cache_control: {type: "ephemeral"}` on the last system block.
  Opus 5's minimum cacheable prefix is **512 tokens** (half Opus 4.8's), so this
  pays off at a smaller prompt than you'd expect. Keep volatile content (the
  fingerprint, today's date) *after* the breakpoint or it invalidates everything.
- **Refusals.** Opus 5 can return `stop_reason: "refusal"` with HTTP 200. Check
  `stop_reason` before reading `content` — indexing `content[0]` unconditionally
  breaks. Opt into `fallbacks: "default"` with beta header
  `server-side-fallback-2026-07-01`.
- **No assistant prefill.** Returns 400 on Opus 5. Use `output_config.format`
  for structured output.

---

## 7. Tools the agent gets

Deno + `npm:@anthropic-ai/sdk`. Use the tool runner
(`client.beta.messages.toolRunner`) rather than hand-writing the loop — its
per-turn hooks cover the approval gating below without a manual loop.

| Tool | Reads | Notes |
|---|---|---|
| `search_trace_routes` | `routes_public` + condition reports | Region and filter args. Returns metadata and **counts**, never geometry. |
| `rider_profile` | the definer aggregate from §5 | No arguments — there is no id to pass but the caller's own. |
| `forecast` | weather provider | Keyed to the planned date, not today. |
| `plan_ride` | — | **Write.** Gate it: never fires without explicit rider confirmation in the UI. |

Write tools do not execute on model say-so. Gate `plan_ride` inside its run
function — return a "rider hasn't confirmed" result and surface the proposal in
the UI instead. Tool descriptions should be **prescriptive about when to call**,
not just what they do; Opus-family models reach for tools conservatively and
trigger conditions in the description measurably improve call rate.

---

## 8. Cost and abuse

Chat is more expensive per interaction than the `geo` search it sits beside, and
a signed-in account is cheap to get. The throttle added to `geo` on 26 July is
the pattern — per-rider, sliding window, applied **on the path that costs money**
rather than on cache hits.

- Per-rider turn limit, generous enough to refuse abuse and not use
- Prompt caching (above) is the single biggest cost lever on a multi-turn chat
- Cap conversation length; start a fresh thread rather than growing forever
- The in-memory counter is per-instance. When it matters, move it to Postgres —
  same note as `geo` carries today

---

## 9. Failing honestly

The voice is already written in §8 of the main spec: never apologise, never be
vague, state what happened and its consequence.

| Situation | Behaviour |
|---|---|
| No TRACE routes in the region | Answer anyway from general knowledge, with no badges. Do not apologise for the absence. |
| Model unavailable / refuses | Fall back to a plain `routes_public` query filtered by region. The catalogue still works without AI. |
| Weather unavailable | Drop the weather line. Never guess a forecast. |
| Rider has no history | Rank on community density and bike capability. Don't ask them to fill in a profile first. |

**A suggestion is never presented as verified.** That is the one thing that would
burn the trust the gap footnote exists to protect.

---

## 10. Out of scope

- Turn-by-turn navigation (rule 3, permanently)
- Anything implying pace, speed, or a leaderboard (rule 1)
- Model-generated geometry of any kind (rule 2)
- Storing a Google-computed line — unchanged, their terms still forbid it
- Personalised suggestions *at home*, where the rider knows the roads already

---

## 11. Build order

1. `rider_profile` definer function + the fingerprint aggregate — testable alone,
   and the piece the ranker can't work without
2. The deterministic ranker over `routes_public`, with **no model at all**. It
   should produce a decent regional list on its own; if it can't, the model layer
   is decorating a hole rather than filling one
3. Provenance badges and attribute warnings on that list
4. The `ride-ai` edge function: model, tools, throttle, caching
5. Chat UI on Explore, in the design system
6. The `plan_ride` handoff into the existing invite flow
7. Weather

Steps 1–3 ship a useful feature with no AI in it. That is deliberate: if the
ranked list is good, the chat is an interface improvement on something that
already works. If it isn't, no model will rescue it.
