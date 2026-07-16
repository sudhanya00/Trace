-- Richer ride stats (user request, 2026-07-16). Client-computed like the gap
-- numbers — the geometry can't tell a chai stop from a red light, the engine
-- can. Speed rule amendment (same date): average MOVING speed may be shown
-- to the ride's owner only — derived at render from distance_km / moving_s,
-- deliberately never stored, never on shared surfaces, and max speed nowhere.

alter table rides add column moving_s int;
alter table rides add column stops_count int;
alter table rides add column elev_gain_m numeric;
