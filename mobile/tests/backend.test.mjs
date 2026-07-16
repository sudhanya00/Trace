/**
 * §12 backend test pass. Runs against the LOCAL Supabase stack:
 *
 *   npx supabase start   (from repo root)
 *   npx supabase db reset
 *   npm test             (from mobile/)
 *
 * A bug in privacy-zone clipping leaks someone's home address — these are not
 * optional (§12: "not manual checking").
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:55321';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const ASHA_RIDE = '00000000-0000-4000-c000-000000000001';
const VEER_RIDE = '00000000-0000-4000-c000-000000000002';
const ASHA_ROUTE = '00000000-0000-4000-d000-000000000001';
const ASHA_BIKE = '00000000-0000-4000-b000-000000000001';
const VEER_BIKE = '00000000-0000-4000-b000-000000000002';

const anon = createClient(URL, ANON);
const asha = createClient(URL, ANON);
const veer = createClient(URL, ANON);
let ashaId, veerId;

function flatPoints(geojson) {
  if (!geojson) return 0;
  if (geojson.type === 'LineString') return geojson.coordinates.length;
  if (geojson.type === 'MultiLineString') return geojson.coordinates.flat().length;
  return 0;
}

before(async () => {
  const a = await asha.auth.signInWithPassword({ email: 'asha@test.local', password: 'password123' });
  const v = await veer.auth.signInWithPassword({ email: 'veer@test.local', password: 'password123' });
  if (a.error || v.error) {
    throw new Error(
      'Local stack not ready — run `npx supabase start && npx supabase db reset` from the repo root first.'
    );
  }
  ashaId = a.data.user.id;
  veerId = v.data.user.id;
});

after(async () => {
  // belt-and-braces cleanup of anything a failed test left behind
  await asha.from('privacy_zones').delete().like('label', 'test:%');
  await asha.from('rides').delete().like('title', 'test:%');
  await asha.from('routes').delete().like('name', 'test:%');
});

describe('privacy-zone clipping', () => {
  it('clips the public track but never the owner’s raw data (seed zone over ride start)', async () => {
    const { data: raw } = await asha.rpc('own_track_geojson', { p_ride_id: ASHA_RIDE });
    const { data: clipped } = await anon.rpc('public_track_geom', { p_ride_id: ASHA_RIDE });
    assert.equal(raw.type, 'MultiLineString');
    assert.equal(raw.coordinates.length, 2, 'owner keeps both segments untouched');
    assert.ok(clipped, 'public clip returns geometry for a public profile');
  });

  it('refuses the clip function entirely for a private profile’s ride', async () => {
    const { data } = await anon.rpc('public_track_geom', { p_ride_id: VEER_RIDE });
    assert.equal(data, null);
  });

  it('a new zone bites immediately; deleting it restores the public face', async () => {
    const before = flatPoints((await anon.rpc('public_route_geojson', { p_route_id: ASHA_ROUTE })).data);
    const { error } = await asha.from('privacy_zones').insert({
      profile_id: ashaId,
      label: 'test: midpoint zone',
      area: 'POLYGON((78.38 31.378, 78.40 31.378, 78.40 31.358, 78.38 31.358, 78.38 31.378))',
    });
    assert.equal(error, null);

    const during = (await anon.rpc('public_route_geojson', { p_route_id: ASHA_ROUTE })).data;
    assert.equal(during.type, 'MultiLineString', 'zone splits the public route');

    await asha.from('privacy_zones').delete().eq('label', 'test: midpoint zone');
    const after = flatPoints((await anon.rpc('public_route_geojson', { p_route_id: ASHA_ROUTE })).data);
    assert.equal(after, before, 'deletion restores exactly the previous public geometry');
  });

  it('a zone covering the whole route leaves nothing public', async () => {
    await asha.from('privacy_zones').insert({
      profile_id: ashaId,
      label: 'test: total zone',
      area: 'POLYGON((78.30 31.45, 78.50 31.45, 78.50 31.30, 78.30 31.30, 78.30 31.45))',
    });
    const { data } = await anon.rpc('public_route_geojson', { p_route_id: ASHA_ROUTE });
    assert.equal(flatPoints(data), 0, 'no coordinates survive');
    await asha.from('privacy_zones').delete().eq('label', 'test: total zone');
  });
});

describe('row-level security', () => {
  it('anon sees only public-profile rows', async () => {
    const rides = await anon.from('rides').select('id');
    assert.equal(rides.data.length, 1);
    const profiles = await anon.from('profiles').select('id');
    assert.equal(profiles.data.length, 1);
  });

  it('anon cannot even query raw geometry or privacy zones', async () => {
    const tracks = await anon.from('ride_tracks').select('ride_id');
    assert.ok(tracks.error, 'ride_tracks privilege denied');
    const zones = await anon.from('privacy_zones').select('id');
    assert.ok(zones.error, 'privacy_zones privilege denied');
  });

  it('an authenticated stranger sees public metadata but only their own geometry', async () => {
    const rides = await veer.from('rides').select('id');
    assert.equal(rides.data.length, 2, 'own + public');
    const tracks = await veer.from('ride_tracks').select('ride_id');
    assert.equal(tracks.data.length, 1, 'own track only');
    const zones = await veer.from('privacy_zones').select('id');
    assert.equal(zones.data.length, 0, 'asha’s zones invisible');
  });

  it('cross-user writes are rejected', async () => {
    const upd = await veer.from('rides').update({ title: 'hacked' }).eq('profile_id', ashaId).select();
    assert.equal(upd.data.length, 0, 'update affects zero rows');
    const ins = await veer.from('rides').insert({
      profile_id: ashaId,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    });
    assert.ok(ins.error, 'insert as someone else violates RLS');
  });

  it('private-profile routes never appear in routes_public', async () => {
    const { data: route, error } = await veer
      .from('routes')
      .insert({
        profile_id: veerId,
        name: 'test: private route',
        distance_km: 5,
        geom: 'LINESTRING(74.83 34.08, 74.86 34.10)',
      })
      .select('id')
      .single();
    assert.equal(error, null);
    const pub = await anon.from('routes_public').select('id').eq('id', route.id);
    assert.equal(pub.data.length, 0);
    await veer.from('routes').delete().eq('id', route.id);
  });
});

describe('follows (Phase 02 policy swap)', () => {
  after(async () => {
    await veer.from('follows').delete().eq('follower_id', veerId);
    await asha.from('follows').delete().eq('follower_id', ashaId);
  });

  it('following a public profile is accepted instantly, whatever the client sent', async () => {
    const { data, error } = await veer
      .from('follows')
      .insert({ follower_id: veerId, followee_id: ashaId, state: 'pending' })
      .select('state')
      .single();
    assert.equal(error, null);
    assert.equal(data.state, 'accepted', 'trigger overrides client state');
    await veer.from('follows').delete().eq('follower_id', veerId);
  });

  it('following a private profile creates a request the followee must accept', async () => {
    const { data } = await asha
      .from('follows')
      .insert({ follower_id: ashaId, followee_id: veerId, state: 'accepted' })
      .select('state')
      .single();
    assert.equal(data.state, 'pending', 'trigger forces pending for private profiles');

    // before acceptance: veer's rides stay invisible to asha
    const hidden = await asha.from('rides').select('id').eq('profile_id', veerId);
    assert.equal(hidden.data.length, 0);

    // followee accepts
    const upd = await veer
      .from('follows')
      .update({ state: 'accepted' })
      .eq('follower_id', ashaId)
      .eq('followee_id', veerId)
      .select('state')
      .single();
    assert.equal(upd.data.state, 'accepted');

    // now asha sees veer's rides, profile, and CLIPPED track — not raw
    const rides = await asha.from('rides').select('id').eq('profile_id', veerId);
    assert.equal(rides.data.length, 1, 'followed private rides visible');
    const clip = await asha.rpc('public_track_geom', { p_ride_id: VEER_RIDE });
    assert.ok(clip.data, 'clipped track accessible to accepted follower');
    const raw = await asha.from('ride_tracks').select('ride_id').eq('ride_id', VEER_RIDE);
    assert.equal(raw.data.length, 0, 'raw geometry stays owner-only even for followers');

    // unfollow revokes everything
    await asha.from('follows').delete().eq('follower_id', ashaId).eq('followee_id', veerId);
    const revoked = await asha.from('rides').select('id').eq('profile_id', veerId);
    assert.equal(revoked.data.length, 0, 'unfollow revokes visibility');
  });

  it('nobody can follow as someone else or peek at third-party edges', async () => {
    const forged = await veer.from('follows').insert({ follower_id: ashaId, followee_id: veerId });
    assert.ok(forged.error, 'forged follower_id rejected');
    const { data: anonEdges, error: anonErr } = await anon.from('follows').select('*');
    assert.ok(anonErr || anonEdges.length === 0, 'anon sees no edges');
  });
});

describe('route threads and condition reports', () => {
  after(async () => {
    await asha.from('route_comments').delete().like('body', 'test:%');
    await veer.from('route_comments').delete().like('body', 'test:%');
    await asha.from('condition_reports').delete().eq('route_id', ASHA_ROUTE);
  });

  it('the author of the source ride gets the rode-it badge; a distant rider does not', async () => {
    const mine = await asha
      .from('route_comments')
      .insert({ route_id: ASHA_ROUTE, profile_id: ashaId, body: 'test: my own road', rode_it: false })
      .select('rode_it')
      .single();
    assert.equal(mine.error, null, `insert failed: ${JSON.stringify(mine.error)}`);
    assert.equal(mine.data.rode_it, true, 'asha rode the route her ride created');

    const theirs = await veer
      .from('route_comments')
      .insert({ route_id: ASHA_ROUTE, profile_id: veerId, body: 'test: never been', rode_it: true })
      .select('rode_it')
      .single();
    assert.equal(theirs.data.rode_it, false, 'trigger overrides veer’s claimed badge — his tracks are in J&K');
  });

  it('threads inherit route visibility and carry handles', async () => {
    const { data } = await anon.rpc('route_thread', { p_route_id: ASHA_ROUTE });
    assert.ok(data.length >= 2, 'anon reads the public route’s thread');
    assert.ok(data.every((c) => typeof c.handle === 'string'));
  });

  it('condition reports post and surface newest-first', async () => {
    const { error } = await asha
      .from('condition_reports')
      .insert({ route_id: ASHA_ROUTE, profile_id: ashaId, status: 'caution', note: 'test: loose gravel after the bridge' });
    assert.equal(error, null);
    const { data } = await anon.rpc('route_conditions', { p_route_id: ASHA_ROUTE });
    assert.equal(data[0].status, 'caution');
    assert.equal(data[0].rode_it, true);
  });

  it('you delete your own comments, never someone else’s', async () => {
    const del = await veer.from('route_comments').delete().eq('profile_id', ashaId).select();
    assert.equal(del.data.length, 0);
  });
});

describe('notifications', () => {
  after(async () => {
    await asha.from('follows').delete().eq('follower_id', ashaId);
    await veer.from('follows').delete().eq('follower_id', veerId);
    await veer.from('notifications').delete().neq('id', crypto.randomUUID());
    await asha.from('notifications').delete().neq('id', crypto.randomUUID());
  });

  it('a follow request lands in the followee’s inbox; the accept lands in the follower’s', async () => {
    await asha.from('follows').insert({ follower_id: ashaId, followee_id: veerId });
    const veerInbox = await veer.from('notifications').select('title, data').order('created_at', { ascending: false });
    assert.ok(veerInbox.data.some((n) => n.title.includes('asked to follow')), 'request notification');

    await veer.from('follows').update({ state: 'accepted' }).eq('follower_id', ashaId);
    const ashaInbox = await asha.from('notifications').select('title').order('created_at', { ascending: false });
    assert.ok(ashaInbox.data.some((n) => n.title.includes('accepted your follow')), 'accept notification');
  });

  it('a comment on your route notifies you — commenting on your own does not', async () => {
    await asha.from('notifications').delete().neq('id', crypto.randomUUID());
    await veer
      .from('route_comments')
      .insert({ route_id: ASHA_ROUTE, profile_id: veerId, body: 'test: notification ping' });
    const inbox = await asha.from('notifications').select('title, body');
    assert.ok(inbox.data.some((n) => n.body?.includes('notification ping')), 'owner notified');

    await asha.from('notifications').delete().neq('id', crypto.randomUUID());
    await asha
      .from('route_comments')
      .insert({ route_id: ASHA_ROUTE, profile_id: ashaId, body: 'test: own comment' });
    const inbox2 = await asha.from('notifications').select('id');
    assert.equal(inbox2.data.length, 0, 'no self-notification');
    await veer.from('route_comments').delete().like('body', 'test:%');
    await asha.from('route_comments').delete().like('body', 'test:%');
  });

  it('inbox and tokens are private to their owner', async () => {
    const cross = await veer.from('notifications').select('id').eq('profile_id', ashaId);
    assert.equal(cross.data.length, 0);
    const tok = await veer.from('push_tokens').insert({ token: 'test-token-veer', profile_id: ashaId });
    assert.ok(tok.error, 'cannot register a token for someone else');
    await veer.from('push_tokens').delete().eq('token', 'test-token-veer');
  });
});

describe('crews and chat', () => {
  let crewId;

  after(async () => {
    if (crewId) await asha.from('crews').delete().eq('id', crewId);
  });

  it('creating a crew makes you its admin, atomically', async () => {
    const { data, error } = await asha
      .from('crews')
      .insert({ name: 'test: Sangla crew', region: 'Himachal', created_by: ashaId })
      .select('id')
      .single();
    assert.equal(error, null);
    crewId = data.id;
    const { data: me } = await asha
      .from('crew_members')
      .select('role')
      .eq('crew_id', crewId)
      .eq('profile_id', ashaId)
      .single();
    assert.equal(me.role, 'admin');
  });

  it('chat is sealed to members; joining opens it; leaving closes it', async () => {
    await asha.from('crew_messages').insert({ crew_id: crewId, profile_id: ashaId, body: 'test: kickoff' });

    const outsider = await veer.rpc('crew_chat', { p_crew_id: crewId });
    assert.equal(outsider.data.length, 0, 'non-member reads nothing');
    const sendOut = await veer
      .from('crew_messages')
      .insert({ crew_id: crewId, profile_id: veerId, body: 'test: sneak' });
    assert.ok(sendOut.error, 'non-member cannot send');

    await veer.from('crew_members').insert({ crew_id: crewId, profile_id: veerId });
    const inside = await veer.rpc('crew_chat', { p_crew_id: crewId });
    assert.ok(inside.data.some((m) => m.body === 'test: kickoff'), 'member reads the room');
    const send = await veer
      .from('crew_messages')
      .insert({ crew_id: crewId, profile_id: veerId, body: 'test: hello from veer' });
    assert.equal(send.error, null, 'member sends');

    await veer.from('crew_members').delete().eq('crew_id', crewId).eq('profile_id', veerId);
    const gone = await veer.rpc('crew_chat', { p_crew_id: crewId });
    assert.equal(gone.data.length, 0, 'leaving closes the room');
  });

  it('nobody joins as admin, joins as someone else, or removes others without the badge', async () => {
    const forged = await veer
      .from('crew_members')
      .insert({ crew_id: crewId, profile_id: veerId, role: 'admin' });
    assert.ok(forged.error, 'self-appointed admin rejected');
    const asOther = await veer.from('crew_members').insert({ crew_id: crewId, profile_id: ashaId });
    assert.ok(asOther.error, 'joining as someone else rejected');

    await veer.from('crew_members').insert({ crew_id: crewId, profile_id: veerId });
    const kick = await veer
      .from('crew_members')
      .delete()
      .eq('crew_id', crewId)
      .eq('profile_id', ashaId)
      .select();
    assert.equal(kick.data.length, 0, 'plain member cannot remove the admin');
    // the admin CAN remove a member
    const adminKick = await asha
      .from('crew_members')
      .delete()
      .eq('crew_id', crewId)
      .eq('profile_id', veerId)
      .select();
    assert.equal(adminKick.data.length, 1, 'admin removes a member');
  });
});

describe('ride invites', () => {
  let crewId, crewInvite, publicInvite;

  after(async () => {
    if (publicInvite) await asha.from('ride_invites').delete().eq('id', publicInvite);
    if (crewId) await asha.from('crews').delete().eq('id', crewId);
  });

  it('public invites reach the board; crew invites stay inside the crew', async () => {
    const tomorrow = new Date(Date.now() + 86400e3).toISOString();
    const pub = await asha
      .from('ride_invites')
      .insert({ created_by: ashaId, title: 'test: dawn board ride', meetup: 'Nishat gate', region: 'Kashmir', starts_at: tomorrow })
      .select('id')
      .single();
    publicInvite = pub.data.id;

    const { data: crew } = await asha
      .from('crews')
      .insert({ name: 'test: invite crew', created_by: ashaId })
      .select('id')
      .single();
    crewId = crew.id;
    const ci = await asha
      .from('ride_invites')
      .insert({ created_by: ashaId, crew_id: crewId, title: 'test: crew sunday', starts_at: tomorrow })
      .select('id')
      .single();
    crewInvite = ci.data.id;

    const board = await veer.rpc('invite_list', { p_crew_id: null });
    assert.ok(board.data.some((i) => i.id === publicInvite), 'public invite on the board for others');
    assert.ok(!board.data.some((i) => i.id === crewInvite), 'crew invite absent from the board');

    const sneak = await veer.rpc('invite_list', { p_crew_id: crewId });
    assert.equal(sneak.data.length, 0, 'non-member sees no crew invites');

    // and the crew invite pinged... nobody (asha is the only member, poster excluded)
    await veer.from('crew_members').insert({ crew_id: crewId, profile_id: veerId });
    const inside = await veer.rpc('invite_list', { p_crew_id: crewId });
    assert.ok(inside.data.some((i) => i.id === crewInvite), 'member sees the crew invite');
  });

  it('RSVP is one tap, counted, revocable — and only as yourself', async () => {
    await veer.from('invite_rsvps').insert({ invite_id: publicInvite, profile_id: veerId });
    let board = await veer.rpc('invite_list', { p_crew_id: null });
    let row = board.data.find((i) => i.id === publicInvite);
    assert.equal(Number(row.rsvp_count), 1);
    assert.equal(row.i_am_in, true);

    const forged = await veer.from('invite_rsvps').insert({ invite_id: publicInvite, profile_id: ashaId });
    assert.ok(forged.error, 'RSVP as someone else rejected');

    await veer.from('invite_rsvps').delete().eq('invite_id', publicInvite).eq('profile_id', veerId);
    board = await veer.rpc('invite_list', { p_crew_id: null });
    row = board.data.find((i) => i.id === publicInvite);
    assert.equal(Number(row.rsvp_count), 0);
    assert.equal(row.i_am_in, false);
  });
});

describe('server-side distance and odometer', () => {
  it('distance sums segments only — the gap span is never counted', async () => {
    // Two ~1.1km meridian segments with a ~1.1km hole between them.
    const rideId = crypto.randomUUID();
    await asha.from('rides').insert({
      id: rideId,
      profile_id: ashaId,
      bike_id: null,
      started_at: new Date(Date.now() - 3600e3).toISOString(),
      ended_at: new Date().toISOString(),
      gap_count: 1,
      gap_duration_s: 300,
      title: 'test: synthetic gap ride',
    });
    await asha.from('ride_tracks').upsert(
      {
        ride_id: rideId,
        profile_id: ashaId,
        geom: 'MULTILINESTRING((77.0 31.00, 77.0 31.01), (77.0 31.02, 77.0 31.03))',
      },
      { onConflict: 'ride_id' }
    );
    const { data: ride } = await asha.from('rides').select('distance_km').eq('id', rideId).single();
    const km = Number(ride.distance_km);
    // each 0.01° of latitude ≈ 1.109 km here; two segments ≈ 2.22, with gap ≈ 3.33
    assert.ok(km > 2.0 && km < 2.4, `distance ${km} must be ~2.2 (segments), not ~3.3 (with gap)`);
    await asha.from('rides').delete().eq('id', rideId);
  });

  it('odometer follows ride lifecycle: insert, idempotent re-sync, delete', async () => {
    const odoAt = async () =>
      Number((await asha.from('bikes').select('current_odometer_km').eq('id', ASHA_BIKE).single()).data.current_odometer_km);

    const base = await odoAt();
    const rideId = crypto.randomUUID();
    await asha.from('rides').insert({
      id: rideId,
      profile_id: ashaId,
      bike_id: ASHA_BIKE,
      started_at: new Date(Date.now() - 3600e3).toISOString(),
      ended_at: new Date().toISOString(),
      title: 'test: odo ride',
    });
    const track = {
      ride_id: rideId,
      profile_id: ashaId,
      geom: 'MULTILINESTRING((77.0 31.00, 77.0 31.01))',
    };
    await asha.from('ride_tracks').upsert(track, { onConflict: 'ride_id' });
    const { data: r } = await asha.from('rides').select('distance_km').eq('id', rideId).single();
    const withRide = await odoAt();
    assert.ok(Math.abs(withRide - base - Number(r.distance_km)) < 0.001, 'odometer moved by the ride distance');

    // retrying the sync (§4 idempotency) must not double-count
    await asha.from('ride_tracks').upsert(track, { onConflict: 'ride_id' });
    assert.equal(await odoAt(), withRide, 'idempotent re-upsert leaves odometer unchanged');

    await asha.from('rides').delete().eq('id', rideId);
    assert.equal(await odoAt(), base, 'deletion rolls the odometer back');
  });

  it('a ride cannot move someone else’s bike odometer', async () => {
    const rideId = crypto.randomUUID();
    const { error } = await asha.from('rides').insert({
      id: rideId,
      profile_id: ashaId,
      bike_id: VEER_BIKE, // not asha’s bike
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      distance_km: 100,
      title: 'test: cross-bike',
    });
    // Either the insert is rejected outright or the trigger's RLS-checked
    // update fails — both acceptable, silence is not.
    if (!error) {
      const { data } = await veer.from('bikes').select('current_odometer_km').eq('id', VEER_BIKE).single();
      assert.equal(Number(data.current_odometer_km), 24118 + 5.32, 'veer’s odometer untouched');
      await asha.from('rides').delete().eq('id', rideId);
    } else {
      assert.ok(error);
    }
  });
});
