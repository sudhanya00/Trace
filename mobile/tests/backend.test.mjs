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

// Local stack's well-known service-role key. Used only to drive maintenance
// functions that are deliberately revoked from riders (the adhoc sweep).
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const anon = createClient(URL, ANON);
const asha = createClient(URL, ANON);
const veer = createClient(URL, ANON);
const admin = createClient(URL, SERVICE);
let ashaId, veerId;

function flatPoints(geojson) {
  if (!geojson) return 0;
  if (geojson.type === 'LineString') return geojson.coordinates.length;
  if (geojson.type === 'MultiLineString') return geojson.coordinates.flat().length;
  return 0;
}

/**
 * Every planned ride now points at a real Route (route standardization,
 * 2026-07-24). A ride named but never mapped becomes an `adhoc` route with no
 * geometry — this is what the Plan-a-ride form does on submit, so the tests
 * create invites the same way the app does.
 */
async function adhocRoute(client, ownerId, name, extra = {}) {
  const { data, error } = await client
    .from('routes')
    .insert({
      profile_id: ownerId,
      source: 'adhoc',
      visibility: extra.crew_id ? 'crew' : 'public',
      name,
      ...extra,
    })
    .select('id')
    .single();
  if (error) throw new Error(`adhoc route insert failed: ${error.message}`);
  return data.id;
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

describe('phone OTP sign-in (local test OTP)', () => {
  it('number → code → session', async () => {
    const client = createClient(URL, ANON);
    const phone = '+919876543210';
    const { error: sendErr } = await client.auth.signInWithOtp({ phone });
    assert.equal(sendErr, null, `send failed: ${sendErr?.message}`);
    const { data, error } = await client.auth.verifyOtp({ phone, token: '424242', type: 'sms' });
    assert.equal(error, null, `verify failed: ${error?.message}`);
    assert.ok(data.session?.access_token, 'session minted');
    const { data: wrong } = await client.auth.verifyOtp({ phone, token: '000000', type: 'sms' });
    assert.equal(wrong.session, null, 'wrong code mints nothing');
  });
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
      .insert({
        created_by: ashaId,
        route_id: await adhocRoute(asha, ashaId, 'test: dawn board ride'),
        title: 'test: dawn board ride',
        meetup: 'Nishat gate',
        region: 'Kashmir',
        starts_at: tomorrow,
      })
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
      .insert({
        created_by: ashaId,
        crew_id: crewId,
        route_id: await adhocRoute(asha, ashaId, 'test: crew sunday', { crew_id: crewId }),
        title: 'test: crew sunday',
        starts_at: tomorrow,
      })
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

  it('a ride cannot be planned into the past', async () => {
    const past = await asha.from('ride_invites').insert({
      created_by: ashaId,
      route_id: await adhocRoute(asha, ashaId, 'test: yesterday'),
      title: 'test: yesterday',
      starts_at: new Date(Date.now() - 15 * 3600e3).toISOString(),
    });
    assert.ok(past.error, 'a ride fifteen hours ago is rejected');

    // But a phone with a slightly wrong clock still gets its ride posted.
    const skewed = await asha
      .from('ride_invites')
      .insert({
        created_by: ashaId,
        route_id: await adhocRoute(asha, ashaId, 'test: clock skew'),
        title: 'test: clock skew',
        starts_at: new Date(Date.now() - 4 * 60e3).toISOString(),
      })
      .select('id')
      .single();
    assert.ok(!skewed.error, 'four minutes of skew is not a bug to punish');
    await asha.from('ride_invites').delete().eq('id', skewed.data.id);
  });

  it('a ride opens on its own page, and a crew ride only for the crew', async () => {
    const { data } = await asha
      .from('ride_invites')
      .update({ description: 'test: fuel up first, back by four' })
      .eq('id', publicInvite)
      .select('id');
    assert.equal(data.length, 1, 'creator can write the plan');

    const open = await veer.rpc('invite_detail', { p_invite_id: publicInvite });
    assert.equal(open.data.length, 1, 'public ride opens for any signed-in rider');
    assert.equal(open.data[0].description, 'test: fuel up first, back by four');
    assert.equal(open.data[0].i_created_it, false);
    assert.ok(open.data[0].route_name, 'the route rides along');

    const mine = await asha.rpc('invite_detail', { p_invite_id: publicInvite });
    assert.equal(mine.data[0].i_created_it, true, 'creator gets the cancel control');

    // A crew's ride is the crew's business — veer joined the crew above, so
    // test the rule with someone who did not.
    const outsider = await anon.rpc('invite_detail', { p_invite_id: crewInvite });
    assert.ok(
      outsider.error || outsider.data.length === 0,
      'signed-out riders open nothing'
    );

    // Past rides still open: you follow a link to check who turned up.
    await asha
      .from('ride_invites')
      .update({ starts_at: new Date(Date.now() - 3 * 86400e3).toISOString() })
      .eq('id', publicInvite);
    const past = await veer.rpc('invite_detail', { p_invite_id: publicInvite });
    assert.equal(past.data.length, 1, 'a finished ride still has a page');
    const stillListed = await veer.rpc('invite_list', { p_crew_id: null });
    assert.ok(
      !stillListed.data.some((i) => i.id === publicInvite),
      'but it has left the board'
    );
  });
});

describe('live location and achievements', () => {
  after(async () => {
    await asha.from('live_positions').delete().eq('profile_id', ashaId);
    await veer.from('follows').delete().eq('follower_id', veerId);
  });

  it('live position is CREW-gated — following someone is not being expected on a ride', async () => {
    // Rewritten 2026-07-25: this used to assert follower visibility, which was
    // the behaviour we deliberately dropped. A rider now names the crews who
    // can see them, and being followed grants nothing.
    await asha.from('live_positions').upsert({
      profile_id: ashaId,
      geom: 'POINT(78.3 31.4)',
      ride_started_at: new Date().toISOString(),
      shared_crew_ids: [],
      updated_at: new Date().toISOString(),
    });

    const blind = await veer.rpc('live_position_of', { p_profile_id: ashaId });
    assert.equal(blind.data, null, 'a stranger sees nothing even though asha is public');

    await veer.from('follows').insert({ follower_id: veerId, followee_id: ashaId });
    const stillBlind = await veer.rpc('live_position_of', { p_profile_id: ashaId });
    assert.equal(stillBlind.data, null, 'and a follower still sees nothing — crews only');

    const forged = await veer.from('live_positions').upsert({ profile_id: ashaId, geom: 'POINT(0 0)' });
    assert.ok(forged.error, 'nobody writes someone else’s position');

    await asha.from('live_positions').delete().eq('profile_id', ashaId);
    await veer.from('follows').delete().eq('follower_id', veerId).eq('followee_id', ashaId);
  });

  it('achievements are awarded by the server and refused from clients', async () => {
    const { data: mine } = await asha.from('achievements').select('key').eq('profile_id', ashaId);
    const keys = mine.map((a) => a.key);
    assert.ok(keys.includes('rides_1'), 'first ride awarded (seed data)');
    assert.ok(keys.includes('km_10000'), 'lifetime tier from the Himalayan odometer');
    assert.ok(keys.includes('routes_1'), 'route shared');

    const grab = await asha.from('achievements').insert({ profile_id: ashaId, key: 'km_50000' });
    assert.ok(grab.error, 'self-award rejected');
  });
});

describe('private crews', () => {
  let crewId;
  after(async () => {
    if (crewId) await asha.from('crews').delete().eq('id', crewId);
  });

  it('joining a private crew parks you at the gate; approval opens the room', async () => {
    const { data: crew } = await asha
      .from('crews')
      .insert({ name: 'test: locked crew', created_by: ashaId, is_private: true })
      .select('id')
      .single();
    crewId = crew.id;

    const { data: joined } = await veer
      .from('crew_members')
      .insert({ crew_id: crewId, profile_id: veerId, state: 'active' })
      .select('state')
      .single();
    assert.equal(joined.state, 'pending', 'trigger overrides the client’s claimed active state');

    const sealed = await veer.rpc('crew_chat', { p_crew_id: crewId });
    assert.equal(sealed.data.length, 0, 'pending member cannot read the room');
    const sneak = await veer
      .from('crew_messages')
      .insert({ crew_id: crewId, profile_id: veerId, body: 'test: knock knock' });
    assert.ok(sneak.error, 'pending member cannot send');

    const selfApprove = await veer
      .from('crew_members')
      .update({ state: 'active' })
      .eq('crew_id', crewId)
      .eq('profile_id', veerId)
      .select();
    assert.equal(selfApprove.data.length, 0, 'you cannot approve yourself');

    const approved = await asha
      .from('crew_members')
      .update({ state: 'active' })
      .eq('crew_id', crewId)
      .eq('profile_id', veerId)
      .select();
    assert.equal(approved.error, null, 'the admin can actually approve');
    assert.equal(approved.data.length, 1, 'approval changed exactly one row');

    const open = await veer
      .from('crew_messages')
      .insert({ crew_id: crewId, profile_id: veerId, body: 'test: in at last' });
    assert.equal(open.error, null, 'approved member sends');

    // The grant is column-scoped: state only, never role.
    const promote = await asha
      .from('crew_members')
      .update({ role: 'admin' })
      .eq('crew_id', crewId)
      .eq('profile_id', veerId);
    assert.ok(promote.error, 'an admin cannot mint another admin through the update path');
  });
});

describe('posts and explore', () => {
  let postId;
  after(async () => {
    await asha.from('posts').delete().like('body', 'test:%');
    await veer.from('posts').delete().like('body', 'test:%');
  });

  it('posts surface on the feed with handles; private authors stay scoped', async () => {
    const { data: p, error } = await asha
      .from('posts')
      .insert({ profile_id: ashaId, body: 'test: Sach Pass snow wall still up?' })
      .select('id')
      .single();
    assert.equal(error, null);
    postId = p.id;

    const feed = await veer.rpc('explore_feed', {});
    const mine = feed.data.find((x) => x.id === postId);
    assert.ok(mine, 'public author’s post visible to others');
    assert.equal(mine.kind, 'post', 'feed rows are discriminated by kind');
    assert.equal(mine.handle, 'asha');

    // veer is private and unfollowed: his post exists for him, not for asha
    const { data: vp } = await veer
      .from('posts')
      .insert({ profile_id: veerId, body: 'test: private thoughts' })
      .select('id')
      .single();
    const ashaFeed = await asha.rpc('explore_feed', {});
    assert.ok(!ashaFeed.data.some((x) => x.id === vp.id), 'private author scoped out');
  });

  it('tags are gone from the schema entirely', async () => {
    const tagged = await asha
      .from('posts')
      .insert({ profile_id: ashaId, body: 'test: tagged', tag: 'road' });
    assert.ok(tagged.error, 'the tag column no longer exists');
  });

  it('replies work and impersonated posts are refused', async () => {
    await veer
      .from('post_comments')
      .insert({ post_id: postId, profile_id: veerId, body: 'test: wall cleared tuesday' });
    const thread = await asha.rpc('post_thread', { p_post_id: postId });
    assert.ok(thread.data.some((c) => c.body.includes('cleared tuesday')));

    const forged = await veer.from('posts').insert({ profile_id: ashaId, body: 'test: not me' });
    assert.ok(forged.error, 'posting as someone else rejected');
  });

  it('posts_of returns a rider’s own posts, visibility-gated', async () => {
    const own = await asha.rpc('posts_of', { p_profile_id: ashaId });
    assert.ok(own.data.some((x) => x.id === postId), 'own posts come back');
    const peeking = await asha.rpc('posts_of', { p_profile_id: veerId });
    assert.equal(peeking.data.length, 0, 'a private rider’s posts stay private');
  });
});

describe('the unified feed and planned-ride detail', () => {
  let inviteId;
  after(async () => {
    await asha.from('ride_invites').delete().like('title', 'test:%');
  });

  it('public ride invites ride the explore feed alongside posts', async () => {
    const { data: inv, error } = await asha
      .from('ride_invites')
      .insert({
        created_by: ashaId,
        crew_id: null,
        // Difficulty lives on the Route now, not the invite.
        route_id: await adhocRoute(asha, ashaId, 'test: dawn run', { difficulty: 'hard' }),
        title: 'test: dawn run',
        starts_at: new Date(Date.now() + 86400e3).toISOString(),
        bike_category: 'adv',
        gear_required: true,
        min_experience: 'intermediate',
      })
      .select('id')
      .single();
    assert.equal(error, null);
    inviteId = inv.id;

    const feed = await veer.rpc('explore_feed', {});
    const row = feed.data.find((x) => x.id === inviteId);
    assert.ok(row, 'the invite reached the feed');
    assert.equal(row.kind, 'ride');
    assert.equal(row.difficulty, 'hard');
    assert.equal(row.gear_required, true);
    assert.equal(row.min_experience, 'intermediate');
  });

  it('crew invites stay in their crew and never reach the public feed', async () => {
    const { data: crew } = await asha
      .from('crews')
      .insert({ name: 'test: feed scoping crew', created_by: ashaId })
      .select('id')
      .single();
    const { data: inv } = await asha
      .from('ride_invites')
      .insert({
        created_by: ashaId,
        crew_id: crew.id,
        route_id: await adhocRoute(asha, ashaId, 'test: crew only run', { crew_id: crew.id }),
        title: 'test: crew only run',
        starts_at: new Date(Date.now() + 86400e3).toISOString(),
      })
      .select('id')
      .single();

    const feed = await veer.rpc('explore_feed', {});
    assert.ok(!feed.data.some((x) => x.id === inv.id), 'crew invite is not public discovery');
    await asha.from('crews').delete().eq('id', crew.id);
  });

  it('a joiner’s answers round-trip through invite_list', async () => {
    const joined = await veer.from('invite_rsvps').upsert(
      {
        invite_id: inviteId,
        profile_id: veerId,
        bike_category: 'adv',
        has_gear: false,
        experience: 'beginner',
      },
      { onConflict: 'invite_id,profile_id' }
    );
    assert.equal(joined.error, null, 'RSVP with answers accepted');

    const board = await veer.rpc('invite_list', { p_crew_id: null });
    const row = board.data.find((x) => x.id === inviteId);
    assert.ok(row, 'invite on the board');
    assert.equal(row.i_am_in, true);
    assert.equal(row.my_has_gear, false, 'an honest no is recorded, not rejected');
    assert.equal(row.my_experience, 'beginner');

    // Changing your mind edits in place rather than leaving and rejoining.
    await veer
      .from('invite_rsvps')
      .update({ has_gear: true })
      .eq('invite_id', inviteId)
      .eq('profile_id', veerId);
    const after = await veer.rpc('invite_list', { p_crew_id: null });
    assert.equal(after.data.find((x) => x.id === inviteId).my_has_gear, true);

    // ...but only your own.
    const forged = await asha
      .from('invite_rsvps')
      .update({ has_gear: false })
      .eq('invite_id', inviteId)
      .eq('profile_id', veerId)
      .select();
    assert.equal(forged.data.length, 0, 'nobody edits another rider’s answers');
  });
});

describe('crew leaderboards', () => {
  let crewId;
  after(async () => {
    if (crewId) await asha.from('crews').delete().eq('id', crewId);
  });

  it('a crew appears only once it opts in, and totals are aggregates', async () => {
    const { data: crew } = await asha
      .from('crews')
      .insert({ name: 'test: board crew', created_by: ashaId })
      .select('id')
      .single();
    crewId = crew.id;

    const off = await asha.rpc('crew_leaderboard');
    assert.ok(!off.data.some((c) => c.id === crewId), 'opt-in is off by default');

    await asha.from('crews').update({ on_leaderboard: true }).eq('id', crewId);
    const on = await asha.rpc('crew_leaderboard');
    const row = on.data.find((c) => c.id === crewId);
    assert.ok(row, 'opted-in crew is on the board');
    assert.equal(Number(row.member_count), 1, 'creator counts as an active member');
    assert.ok(row.lifetime_km !== null && row.today_km !== null, 'both distance totals present');
    assert.equal(row.i_am_in, true);
  });

  it('only an admin can flip the switch', async () => {
    const forged = await veer
      .from('crews')
      .update({ on_leaderboard: false })
      .eq('id', crewId)
      .select();
    assert.equal(forged.data.length, 0, 'a non-admin cannot take a crew off the board');
  });
});

describe('crew contributions', () => {
  let crewId;
  let rideId;

  before(async () => {
    const { data: crew } = await asha
      .from('crews')
      .insert({ name: 'test: contrib crew', created_by: ashaId, on_leaderboard: true })
      .select('id')
      .single();
    crewId = crew.id;
  });

  after(async () => {
    await asha.from('rides').delete().like('title', 'test:%');
    if (crewId) await asha.from('crews').delete().eq('id', crewId);
  });

  it('a ride counts for nobody until it is attributed', async () => {
    rideId = crypto.randomUUID();
    await asha.from('rides').insert({
      id: rideId,
      profile_id: ashaId,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      title: 'test: contribution ride',
    });
    await asha.from('ride_tracks').upsert(
      {
        ride_id: rideId,
        profile_id: ashaId,
        geom: 'MULTILINESTRING((77.0 31.00, 77.0 31.02))',
      },
      { onConflict: 'ride_id' }
    );

    const board = await asha.rpc('crew_leaderboard');
    const row = board.data.find((c) => c.id === crewId);
    assert.equal(Number(row.lifetime_km), 0, 'an unattributed ride counts nowhere');

    const chat = await asha.rpc('crew_chat', { p_crew_id: crewId });
    assert.equal(chat.data.length, 0, 'and says nothing in the room');
  });

  it('attributing posts to the timeline and moves the total', async () => {
    await asha.from('rides').update({ crew_id: crewId }).eq('id', rideId);

    const board = await asha.rpc('crew_leaderboard');
    const row = board.data.find((c) => c.id === crewId);
    assert.ok(Number(row.lifetime_km) > 2, 'the crew total moved');
    assert.ok(Number(row.today_km) > 2, 'and it counts toward today');

    const chat = await asha.rpc('crew_chat', { p_crew_id: crewId });
    const entry = chat.data.find((m) => m.ride_id === rideId);
    assert.ok(entry, 'the contribution reached the timeline');
    assert.equal(entry.kind, 'contribution');
    assert.equal(entry.handle, 'asha');
    assert.ok(Number(entry.distance_km) > 2, 'the entry carries the distance');
  });

  it('re-attributing moves the entry rather than duplicating it', async () => {
    const { data: other } = await asha
      .from('crews')
      .insert({ name: 'test: second crew', created_by: ashaId, on_leaderboard: true })
      .select('id')
      .single();

    await asha.from('rides').update({ crew_id: other.id }).eq('id', rideId);

    const oldRoom = await asha.rpc('crew_chat', { p_crew_id: crewId });
    assert.ok(!oldRoom.data.some((m) => m.ride_id === rideId), 'the old line is gone');
    const newRoom = await asha.rpc('crew_chat', { p_crew_id: other.id });
    assert.equal(
      newRoom.data.filter((m) => m.ride_id === rideId).length,
      1,
      'exactly one line in the new room'
    );

    const board = await asha.rpc('crew_leaderboard');
    assert.equal(Number(board.data.find((c) => c.id === crewId).lifetime_km), 0, 'old total drops');
    assert.ok(Number(board.data.find((c) => c.id === other.id).lifetime_km) > 2, 'new total rises');

    // ...and taking it back leaves nothing behind.
    await asha.from('rides').update({ crew_id: null }).eq('id', rideId);
    const cleared = await asha.rpc('crew_chat', { p_crew_id: other.id });
    assert.ok(!cleared.data.some((m) => m.ride_id === rideId), 'un-attributing removes the line');

    await asha.from('crews').delete().eq('id', other.id);
  });

  it('you cannot contribute to a crew you are not in', async () => {
    const { data: theirs } = await asha
      .from('crews')
      .insert({ name: 'test: not veers crew', created_by: ashaId })
      .select('id')
      .single();

    const veerRide = crypto.randomUUID();
    await veer.from('rides').insert({
      id: veerRide,
      profile_id: veerId,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      title: 'test: veer ride',
    });
    const forged = await veer.from('rides').update({ crew_id: theirs.id }).eq('id', veerRide).select();
    assert.ok(
      forged.error || forged.data.length === 0,
      'a non-member cannot push distance into a crew'
    );

    await veer.from('rides').delete().eq('id', veerRide);
    await asha.from('crews').delete().eq('id', theirs.id);
  });

  it('the client cannot forge a contribution line', async () => {
    const forged = await asha.from('crew_messages').insert({
      crew_id: crewId,
      profile_id: ashaId,
      body: 'contributed 9999.0 km',
      kind: 'contribution',
    });
    assert.ok(forged.error, 'only the trigger writes contributions');
  });
});

describe('likes, reposts and rides on the feed', () => {
  let postId;
  let rideId;

  after(async () => {
    await asha.from('posts').delete().like('body', 'test:%');
    await asha.from('rides').delete().like('title', 'test:%');
  });

  it('a like is one row, and liking twice stays one', async () => {
    const { data: p } = await asha
      .from('posts')
      .insert({ profile_id: ashaId, body: 'test: likeable' })
      .select('id')
      .single();
    postId = p.id;

    await veer.from('post_likes').insert({ post_id: postId, profile_id: veerId });
    const again = await veer.from('post_likes').insert({ post_id: postId, profile_id: veerId });
    assert.equal(again.error?.code, '23505', 'the primary key makes it idempotent');

    const feed = await veer.rpc('explore_feed', {});
    const row = feed.data.find((x) => x.id === postId);
    assert.equal(Number(row.like_count), 1);
    assert.equal(row.i_liked, true, 'the caller sees their own like');

    const ashaView = await asha.rpc('explore_feed', {});
    assert.equal(ashaView.data.find((x) => x.id === postId).i_liked, false, 'not everyone else’s');
  });

  it('you cannot like as somebody else, or unlike their like', async () => {
    const forged = await asha
      .from('post_likes')
      .insert({ post_id: postId, profile_id: veerId });
    assert.ok(forged.error, 'liking on another rider’s behalf is refused');

    const stolen = await asha
      .from('post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('profile_id', veerId)
      .select();
    assert.equal(stolen.data.length, 0, 'and their like is not yours to remove');
  });

  it('a repost carries the original, and an empty body is legal for one', async () => {
    const { error } = await veer
      .from('posts')
      .insert({ profile_id: veerId, body: '', repost_of: postId });
    assert.equal(error, null, 'a bare repost needs no words');

    const mine = await veer.rpc('posts_of', { p_profile_id: veerId });
    const rp = mine.data.find((x) => x.repost_of === postId);
    assert.ok(rp, 'the repost is on the reposter’s profile');
    assert.equal(rp.repost_handle, 'asha', 'and names who it came from');
    assert.ok(rp.repost_body.includes('likeable'));
  });

  it('an empty body is still refused for a plain post', async () => {
    const { error } = await asha.from('posts').insert({ profile_id: ashaId, body: '' });
    assert.ok(error, 'a post with nothing in it and nothing attached is not a post');
  });

  it('a ride can be shared as a post — but only your own ride', async () => {
    rideId = crypto.randomUUID();
    await asha.from('rides').insert({
      id: rideId,
      profile_id: ashaId,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      title: 'test: shareable ride',
    });
    await asha.from('ride_tracks').upsert(
      { ride_id: rideId, profile_id: ashaId, geom: 'MULTILINESTRING((77.0 31.00, 77.0 31.02))' },
      { onConflict: 'ride_id' }
    );

    const ok = await asha.from('posts').insert({ profile_id: ashaId, body: '', ride_id: rideId });
    assert.equal(ok.error, null, 'your own ride goes on the feed');

    const theft = await veer.from('posts').insert({ profile_id: veerId, body: '', ride_id: rideId });
    assert.ok(theft.error, 'somebody else’s ride does not');

    const feed = await veer.rpc('explore_feed', {});
    const row = feed.data.find((x) => x.ride_id === rideId);
    assert.ok(row, 'the ride post reached the feed');
    assert.ok(Number(row.ride_distance_km) > 2, 'carrying its distance');
    assert.ok(row.ride_geom, 'and its shape, for the thumbnail');
  });
});

describe('crew member contributions', () => {
  it('lists active members ordered by what they gave', async () => {
    const { data: crew } = await asha
      .from('crews')
      .insert({ name: 'test: contrib order crew', created_by: ashaId })
      .select('id')
      .single();

    const rows = await asha.rpc('crew_member_contributions', { p_crew_id: crew.id });
    assert.equal(rows.error, null);
    assert.equal(rows.data.length, 1, 'the creator is in it');
    assert.equal(rows.data[0].handle, 'asha');
    assert.equal(Number(rows.data[0].total_km), 0, 'having contributed nothing yet');

    const outsider = await veer.rpc('crew_member_contributions', { p_crew_id: crew.id });
    assert.equal(outsider.data.length, 0, 'non-members see no roster');

    await asha.from('crews').delete().eq('id', crew.id);
  });
});

describe('route standardization', () => {
  after(async () => {
    await asha.from('routes').delete().like('name', 'test:%');
    await veer.from('routes').delete().like('name', 'test:%');
  });

  it('a planned ride can never exist without a route', async () => {
    const orphan = await asha.from('ride_invites').insert({
      created_by: ashaId,
      title: 'test: orphan ride',
      starts_at: new Date(Date.now() + 86400e3).toISOString(),
    });
    assert.ok(orphan.error, 'route_id is mandatory — no free-text-only rides');
  });

  it('difficulty comes from the route, not the invite', async () => {
    const routeId = await adhocRoute(asha, ashaId, 'test: difficulty source', {
      difficulty: 'expert',
    });
    const { data: inv } = await asha
      .from('ride_invites')
      .insert({
        created_by: ashaId,
        route_id: routeId,
        title: 'test: difficulty source',
        starts_at: new Date(Date.now() + 86400e3).toISOString(),
      })
      .select('id')
      .single();

    const board = await asha.rpc('invite_list', { p_crew_id: null });
    const row = board.data.find((i) => i.id === inv.id);
    assert.equal(row.difficulty, 'expert', 'the board reads difficulty off the joined route');

    // And the column is gone from the invite for good.
    const stale = await asha.from('ride_invites').update({ difficulty: 'easy' }).eq('id', inv.id);
    assert.ok(stale.error, 'difficulty no longer exists on ride_invites');
  });

  it('an adhoc route needs no geometry, a user route keeps its own', async () => {
    const adhocId = await adhocRoute(asha, ashaId, 'test: no geometry');
    const { data: adhoc } = await asha
      .from('routes')
      .select('source')
      .eq('id', adhocId)
      .maybeSingle();
    assert.equal(adhoc.source, 'adhoc');
    // Geometry is read through the accessor, never off the table (the audit of
    // 2026-07-26 revoked the column) — and a named-but-unmapped ride has none.
    const { data: line } = await asha.rpc('public_route_geojson', { p_route_id: adhocId });
    assert.equal(line, null, 'a named-but-unmapped ride is still a Route row');
  });

  it('a private rider’s route stays hidden from strangers but visible to them', async () => {
    // veer is private and unfollowed by asha.
    const { data: mine, error } = await veer
      .from('routes')
      .insert({
        profile_id: veerId,
        source: 'user',
        visibility: 'public',
        name: 'test: veer private-profile route',
        geom: 'LINESTRING(77.0 31.0, 77.0 31.02)',
        distance_km: 2.2,
      })
      .select('id')
      .single();
    assert.equal(error, null);

    const own = await veer.from('routes').select('id').eq('id', mine.id).maybeSingle();
    assert.ok(own.data, 'the owner always sees their own route');

    // Route-level 'public' does NOT override profile-level privacy.
    const stranger = await asha.from('routes').select('id').eq('id', mine.id).maybeSingle();
    assert.equal(stranger.data, null, 'profile privacy still gates a public route');
    const viaView = await asha.from('routes_public').select('id').eq('id', mine.id).maybeSingle();
    assert.equal(viaView.data, null, 'and the public view agrees');
  });

  it('only an admin can create a curated route', async () => {
    const forged = await asha.from('routes').insert({
      profile_id: null,
      source: 'curated',
      visibility: 'public',
      name: 'test: forged curation',
      geom: 'LINESTRING(77.0 31.0, 77.0 31.02)',
    });
    assert.ok(forged.error, 'curation is gated on the admin flag');
  });

  it('the client’s two Plan-a-ride paths both produce a real route', async () => {
    // Path A — "just name it": the adhoc route is created from the typed name,
    // exactly as createInvite() does when no route was picked.
    const adhocId = await adhocRoute(asha, ashaId, 'test: typed only', {
      difficulty: 'moderate',
      region: 'Himachal',
    });
    const { data: a } = await asha
      .from('ride_invites')
      .insert({
        created_by: ashaId,
        route_id: adhocId,
        title: 'test: typed only',
        region: 'Himachal',
        starts_at: new Date(Date.now() + 86400e3).toISOString(),
      })
      .select('id')
      .single();

    // Path B — a picked route with real geometry (what "share a ride as a
    // route" produces, then reused for planning).
    const { data: picked, error: pickErr } = await asha
      .from('routes')
      .insert({
        profile_id: ashaId,
        source: 'user',
        visibility: 'public',
        name: 'test: picked route',
        region: 'Kashmir',
        difficulty: 'hard',
        distance_km: 2.2,
        geom: 'LINESTRING(77.0 31.00, 77.0 31.02)',
      })
      .select('id')
      .single();
    assert.equal(pickErr, null);
    const { data: b } = await asha
      .from('ride_invites')
      .insert({
        created_by: ashaId,
        route_id: picked.id,
        title: 'test: picked route ride',
        starts_at: new Date(Date.now() + 86400e3).toISOString(),
      })
      .select('id')
      .single();

    const board = await asha.rpc('invite_list', { p_crew_id: null });
    const rowA = board.data.find((i) => i.id === a.id);
    const rowB = board.data.find((i) => i.id === b.id);

    assert.equal(rowA.difficulty, 'moderate', 'adhoc route carries difficulty');
    assert.equal(rowA.route_geom, null, 'a named-only ride has no shape to draw');

    assert.equal(rowB.difficulty, 'hard', 'picked route supplies difficulty');
    assert.ok(rowB.route_geom, 'a mapped route gives the board card its shape');
    assert.ok(Number(rowB.route_distance_km) > 2, 'and its distance');
  });

  it('a planned route stores waypoints, not a Google line', async () => {
    // What createPlannedRoute() writes: the rider's chosen points, no geometry.
    // Google's terms restrict storing their computed lines, so geom stays null
    // and the line is recomputed from these on demand.
    const { data: planned, error } = await asha
      .from('routes')
      .insert({
        profile_id: ashaId,
        source: 'user',
        visibility: 'public',
        geom_provider: 'google',
        name: 'test: Jammu to Patnitop the old way',
        region: 'Jammu & Kashmir',
        difficulty: 'moderate',
        distance_km: 108.7,
        waypoints: [
          { lat: 32.7266, lng: 74.857, place_id: 'ChIJ_test_jammu', label: 'Jammu' },
          { lat: 32.92, lng: 75.14, place_id: null, label: 'the old road' },
          { lat: 33.0836, lng: 75.331, place_id: 'ChIJ_test_patnitop', label: 'Patnitop' },
        ],
        start_label: 'Jammu',
        end_label: 'Patnitop',
      })
      .select('id, geom_provider, distance_km, start_label, end_label')
      .single();
    assert.equal(error, null);
    const { data: line } = await asha.rpc('public_route_geojson', { p_route_id: planned.id });
    assert.equal(line, null, 'no Google geometry is retained');
    const { data: wp } = await asha.rpc('route_waypoints', { p_route_id: planned.id });
    assert.equal(wp.length, 3, 'the waypoints define the route');
    assert.equal(wp[1].label, 'the old road', 'via point survives');
    assert.equal(planned.geom_provider, 'google');
    assert.equal(planned.start_label, 'Jammu');
    assert.ok(Number(planned.distance_km) > 100, 'distance is a fact about the road, kept');
  });

  it('a route must be drawable: geometry, waypoints, or adhoc', async () => {
    // A user route with neither is unusable — nothing could ever draw it.
    const undrawable = await asha.from('routes').insert({
      profile_id: ashaId,
      source: 'user',
      visibility: 'public',
      name: 'test: undrawable route',
    });
    assert.ok(undrawable.error, 'a user route with no geom and no waypoints is refused');

    // An adhoc one is the legitimate exception: a name and a meeting point.
    const adhocOk = await asha.from('routes').insert({
      profile_id: ashaId,
      source: 'adhoc',
      visibility: 'public',
      name: 'test: adhoc needs neither',
    });
    assert.equal(adhocOk.error, null, 'adhoc routes need neither');
  });

  it('a meetup can carry a real point, and never half of one', async () => {
    const routeId = await adhocRoute(asha, ashaId, 'test: meetup point ride');
    const { error } = await asha.from('ride_invites').insert({
      created_by: ashaId,
      route_id: routeId,
      title: 'test: meetup point ride',
      meetup: 'City Chowk, six sharp',
      meetup_lat: 32.7266,
      meetup_lng: 74.857,
      meetup_place_id: 'ChIJtest_place_id',
      starts_at: new Date(Date.now() + 86400e3).toISOString(),
    });
    assert.equal(error, null, 'a located meetup stores fine');

    // Half a coordinate would put the map in the Gulf of Guinea.
    const half = await asha.from('ride_invites').insert({
      created_by: ashaId,
      route_id: routeId,
      title: 'test: half a coordinate',
      meetup_lat: 32.7266,
      starts_at: new Date(Date.now() + 86400e3).toISOString(),
    });
    assert.ok(half.error, 'lat without lng is refused');

    // The point has to come BACK, or the pin is decoration: this is the bug
    // 20260725000300 fixed — the columns were written and never returned.
    const board = await asha.rpc('invite_list', { p_crew_id: null });
    const row = board.data.find((i) => i.title === 'test: meetup point ride');
    assert.ok(row, 'the ride is on the board');
    assert.equal(Number(row.meetup_lat).toFixed(3), '32.727', 'the pin comes back');
    assert.equal(row.meetup_place_id, 'ChIJtest_place_id', 'and its place id with it');

    // And a meetup with no point at all is still perfectly legal.
    const wordsOnly = await asha.from('ride_invites').insert({
      created_by: ashaId,
      route_id: routeId,
      title: 'test: words only meetup',
      meetup: 'the usual place',
      starts_at: new Date(Date.now() + 86400e3).toISOString(),
    });
    assert.equal(wordsOnly.error, null, 'words-only meetups still work');
  });

  it('the adhoc sweep spares routes with an upcoming ride', async () => {
    const keep = await adhocRoute(asha, ashaId, 'test: upcoming adhoc');
    await asha.from('ride_invites').insert({
      created_by: ashaId,
      route_id: keep,
      title: 'test: upcoming adhoc',
      starts_at: new Date(Date.now() + 86400e3).toISOString(),
    });
    const orphan = await adhocRoute(asha, ashaId, 'test: stale adhoc');

    // Definer function, revoked from public — the sweep is a maintenance job,
    // so drive it through the service role rather than a rider's client.
    const sweepRun = await admin.rpc('sweep_stale_adhoc_routes');
    assert.equal(sweepRun.error, null, 'the sweep runs for the service role');

    // ...and a rider can't run it themselves.
    const forged = await asha.rpc('sweep_stale_adhoc_routes');
    assert.ok(forged.error, 'riders cannot trigger maintenance');

    const kept = await asha.from('routes').select('id').eq('id', keep).maybeSingle();
    assert.ok(kept.data, 'a route with a live planned ride survives the sweep');
    const swept = await asha.from('routes').select('id').eq('id', orphan).maybeSingle();
    assert.equal(swept.data, null, 'a geometry-less adhoc with no ride is soft-deleted');
  });
});

describe('a planned ride meets its recording', () => {
  let inviteId;
  let routeId;

  after(async () => {
    await asha.from('rides').delete().like('title', 'test:%');
    await asha.from('ride_invites').delete().like('title', 'test:%');
    await asha.from('routes').delete().like('name', 'test:%');
  });

  it('a ride can be attached to a plan, and shows who actually rode', async () => {
    routeId = await adhocRoute(asha, ashaId, 'test: sunday route');
    const { data: inv } = await asha
      .from('ride_invites')
      .insert({
        created_by: ashaId,
        route_id: routeId,
        title: 'test: sunday run',
        starts_at: new Date(Date.now() + 3600e3).toISOString(),
      })
      .select('id')
      .single();
    inviteId = inv.id;
    await asha.from('invite_rsvps').insert({ invite_id: inviteId, profile_id: ashaId });

    // It's within the window, so the recorder would offer it.
    const upcoming = await asha.rpc('my_upcoming_rides');
    assert.ok(
      upcoming.data.some((r) => r.id === inviteId),
      'the planned ride is offered when recording starts'
    );

    // Before anyone rides: RSVP'd, but no ride to show for it.
    const before = await asha.rpc('invite_riders', { p_invite_id: inviteId });
    const meBefore = before.data.find((r) => r.profile_id === ashaId);
    assert.equal(meBefore.rsvpd, true);
    assert.equal(meBefore.ride_id, null, 'intent recorded, nothing ridden yet');

    const rideId = crypto.randomUUID();
    const { error } = await asha.from('rides').insert({
      id: rideId,
      profile_id: ashaId,
      planned_ride_id: inviteId,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      title: 'test: the sunday run itself',
    });
    assert.equal(error, null, 'a ride attaches to a plan');

    const after = await asha.rpc('invite_riders', { p_invite_id: inviteId });
    const meAfter = after.data.find((r) => r.profile_id === ashaId);
    assert.equal(meAfter.ride_id, rideId, 'and now it shows who actually rode it');
  });

  it('riding a planned route gives it permanent geometry', async () => {
    // The point of the whole waypoints-only compromise: a Google-planned
    // route can't keep its line, but a recorded track is the rider's own
    // data — so riding it is what makes the geometry storable.
    const before = await asha.rpc('public_route_geojson', { p_route_id: routeId });
    assert.equal(before.data, null, 'the planned route starts with no geometry');

    const rideId = crypto.randomUUID();
    await asha.from('rides').insert({
      id: rideId,
      profile_id: ashaId,
      planned_ride_id: inviteId,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      title: 'test: backfill ride',
    });
    await asha.from('ride_tracks').upsert(
      {
        ride_id: rideId,
        profile_id: ashaId,
        geom: 'MULTILINESTRING((77.0 31.00, 77.0 31.02))',
      },
      { onConflict: 'ride_id' }
    );
    // The trigger fires on distance_km, which the track's own trigger sets.
    const after = await asha
      .from('routes')
      .select('geom_provider')
      .eq('id', routeId)
      .maybeSingle();
    const { data: line } = await asha.rpc('public_route_geojson', { p_route_id: routeId });
    assert.ok(line, 'the ridden track becomes the route’s geometry');
    assert.equal(after.data.geom_provider, 'recorded', 'and is marked as the rider’s own');
  });

  it('a recording with gaps never becomes a route', async () => {
    // §5: a route is a road others follow. Joining the segments either side of
    // a dropout would invent tarmac nobody rode, so a broken track is simply
    // not offered — the next clean ride fills it instead.
    const brokenRoute = await adhocRoute(asha, ashaId, 'test: gappy route');
    const { data: inv } = await asha
      .from('ride_invites')
      .insert({
        created_by: ashaId,
        route_id: brokenRoute,
        title: 'test: gappy plan',
        starts_at: new Date(Date.now() + 3600e3).toISOString(),
      })
      .select('id')
      .single();

    const rideId = crypto.randomUUID();
    await asha.from('rides').insert({
      id: rideId,
      profile_id: ashaId,
      planned_ride_id: inv.id,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      title: 'test: gappy ride',
      gap_count: 1,
    });
    await asha.from('ride_tracks').upsert(
      {
        ride_id: rideId,
        profile_id: ashaId,
        // Two segments — the signal dropped in between.
        geom: 'MULTILINESTRING((77.0 31.00, 77.0 31.01), (77.0 31.02, 77.0 31.03))',
      },
      { onConflict: 'ride_id' }
    );

    const { data: line } = await asha.rpc('public_route_geojson', { p_route_id: brokenRoute });
    assert.equal(line, null, 'a track with a dropout is not turned into a road');
  });

  it('you cannot attach your ride to a crew plan you are not in', async () => {
    const { data: crew } = await asha
      .from('crews')
      .insert({ name: 'test: closed crew', created_by: ashaId })
      .select('id')
      .single();
    const crewRoute = await adhocRoute(asha, ashaId, 'test: closed crew route', {
      crew_id: crew.id,
    });
    const { data: crewInvite } = await asha
      .from('ride_invites')
      .insert({
        created_by: ashaId,
        crew_id: crew.id,
        route_id: crewRoute,
        title: 'test: members only run',
        starts_at: new Date(Date.now() + 3600e3).toISOString(),
      })
      .select('id')
      .single();

    const forged = await veer.from('rides').insert({
      id: crypto.randomUUID(),
      profile_id: veerId,
      planned_ride_id: crewInvite.id,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      title: 'test: gatecrash',
    });
    assert.ok(forged.error, 'a non-member cannot claim a crew’s planned ride');

    await asha.from('crews').delete().eq('id', crew.id);
  });
});

describe('live location goes to chosen crews only', () => {
  let crewId;

  after(async () => {
    await asha.from('live_positions').delete().eq('profile_id', ashaId);
    if (crewId) await asha.from('crews').delete().eq('id', crewId);
  });

  it('a crewmate sees it; a stranger and a mere follower do not', async () => {
    const { data: crew } = await asha
      .from('crews')
      .insert({ name: 'test: live crew', created_by: ashaId })
      .select('id')
      .single();
    crewId = crew.id;

    await asha.from('live_positions').upsert({
      profile_id: ashaId,
      geom: 'POINT(74.857 32.7266)',
      shared_crew_ids: [crewId],
      updated_at: new Date().toISOString(),
    });

    // veer is not in the crew — sharing with a crew is not sharing with the world.
    const stranger = await veer.rpc('crew_live_riders', { p_crew_id: crewId });
    assert.equal(stranger.data.length, 0, 'a non-member sees nobody');
    const direct = await veer
      .from('live_positions')
      .select('profile_id')
      .eq('profile_id', ashaId)
      .maybeSingle();
    assert.equal(direct.data, null, 'and cannot read the row directly either');

    // The rider's own crew does see it.
    const mine = await asha.rpc('crew_live_riders', { p_crew_id: crewId });
    assert.equal(mine.data.length, 1, 'a crewmate sees the rider');
    assert.equal(mine.data[0].handle, 'asha');
    assert.ok(mine.data[0].point, 'with a position to look at');
  });

  it('a stale position stops counting as live', async () => {
    await asha.from('live_positions').upsert({
      profile_id: ashaId,
      geom: 'POINT(74.857 32.7266)',
      shared_crew_ids: [crewId],
      // Twenty minutes old: the app died or the ride ended badly. Showing this
      // as "live" is worse than showing nothing — someone might ride to it.
      updated_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    });
    const rows = await asha.rpc('crew_live_riders', { p_crew_id: crewId });
    assert.equal(rows.data.length, 0, 'nothing older than 15 minutes is live');
  });

  it('sharing with no crews broadcasts to nobody', async () => {
    await asha.from('live_positions').upsert({
      profile_id: ashaId,
      geom: 'POINT(74.857 32.7266)',
      shared_crew_ids: [],
      updated_at: new Date().toISOString(),
    });
    const rows = await asha.rpc('crew_live_riders', { p_crew_id: crewId });
    assert.equal(rows.data.length, 0, 'an empty audience is an empty audience');
  });

  it('you cannot announce yourself into a crew you are not in', async () => {
    const before = await asha.rpc('crew_chat', { p_crew_id: crewId });
    const forged = await veer.rpc('announce_live_share', { p_crew_ids: [crewId] });
    assert.equal(forged.error, null, 'the call succeeds but does nothing');
    const after = await asha.rpc('crew_chat', { p_crew_id: crewId });
    assert.equal(after.data.length, before.data.length, 'no message reached the room');
  });

  it('the client cannot forge a live_share message', async () => {
    const forged = await asha.from('crew_messages').insert({
      crew_id: crewId,
      profile_id: ashaId,
      body: 'is sharing live location',
      kind: 'live_share',
    });
    assert.ok(forged.error, 'only the definer function writes these');
  });
});

describe('profile stats', () => {
  it('own numbers resolve; a private rider’s do not leak', async () => {
    const mine = await asha.rpc('profile_stats', { p_profile_id: ashaId });
    assert.equal(mine.data.length, 1, 'own stats come back');
    const row = mine.data[0];
    for (const k of [
      'total_km',
      'ride_count',
      'bike_count',
      'crew_count',
      'follower_count',
      'following_count',
    ]) {
      assert.ok(row[k] !== undefined && row[k] !== null, `${k} present`);
    }

    const peeking = await asha.rpc('profile_stats', { p_profile_id: veerId });
    assert.equal(peeking.data.length, 0, 'private rider’s stats withheld');
  });
});

describe('suggested riders', () => {
  it('same region surfaces, already-followed does not', async () => {
    // veer(private) suggests nothing; make a comparable check with region match:
    // asha (Himachal) vs veer (J&K) — no region match, no shared bike, so empty.
    const { data } = await asha.rpc('suggested_riders');
    assert.ok(Array.isArray(data));
    assert.ok(!data.some((s) => s.id === veerId), 'private profiles never suggested');
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

/**
 * Column privilege — the security audit of 2026-07-26.
 *
 * RLS gates rows, never columns. Every one of these covers a case where a
 * policy widened to share a row and quietly took a column with it that was
 * only ever meant to be served through something that cleans it first.
 */
describe('column privilege', () => {
  it('a stranger cannot read raw route geometry off the table', async () => {
    const { data, error } = await veer.from('routes').select('geom').eq('id', ASHA_ROUTE);
    assert.ok(error, 'selecting geom is refused outright');
    assert.equal(data, null);
  });

  it('a stranger cannot read raw waypoints off the table', async () => {
    const { error } = await veer.from('routes').select('waypoints').eq('id', ASHA_ROUTE);
    assert.ok(error, 'selecting waypoints is refused outright');
  });

  it('the metadata a route list needs still reads fine', async () => {
    const { data, error } = await veer
      .from('routes')
      .select('id, name, distance_km, region, difficulty')
      .eq('id', ASHA_ROUTE)
      .maybeSingle();
    assert.equal(error, null, `catalogue read broke: ${error?.message}`);
    assert.equal(data.id, ASHA_ROUTE);
  });

  it('waypoints reach a stranger only with the owner’s zones taken out', async () => {
    // Two points: one out on the road, one standing on a spot asha then hides.
    const HIDDEN = { lat: 31.368, lng: 78.39, place_id: null, label: 'test: home' };
    const OPEN = { lat: 31.1, lng: 77.17, place_id: null, label: 'test: road' };
    const routeId = await adhocRoute(asha, ashaId, 'test: waypoint route', {
      source: 'user',
      waypoints: [HIDDEN, OPEN],
    });

    const owner = await asha.rpc('route_waypoints', { p_route_id: routeId });
    assert.equal(owner.data.length, 2, 'the owner keeps every point of their own route');

    await asha.from('privacy_zones').insert({
      profile_id: ashaId,
      label: 'test: waypoint zone',
      area: 'POLYGON((78.38 31.378, 78.40 31.378, 78.40 31.358, 78.38 31.358, 78.38 31.378))',
    });

    const stranger = await veer.rpc('route_waypoints', { p_route_id: routeId });
    assert.equal(stranger.data.length, 1, 'the hidden point is gone');
    assert.equal(stranger.data[0].label, 'test: road', 'the road survives');

    const still = await asha.rpc('route_waypoints', { p_route_id: routeId });
    assert.equal(still.data.length, 2, 'the owner’s own view is never clipped');

    await asha.from('privacy_zones').delete().eq('label', 'test: waypoint zone');
    await asha.from('routes').delete().eq('id', routeId);
  });

  it('a rider cannot make themselves an admin', async () => {
    const { error } = await veer.from('profiles').update({ is_admin: true }).eq('id', veerId);
    assert.ok(error, 'writing is_admin is refused outright');

    // Read back through veer's own row — service_role holds no select on the
    // app tables (they were granted explicitly to anon/authenticated only).
    const { data } = await veer.from('profiles').select('is_admin').eq('id', veerId).single();
    assert.equal(data.is_admin, false, 'and the flag did not move');
  });

  it('a rider cannot smuggle is_admin in on insert either', async () => {
    const fresh = createClient(URL, ANON);
    const email = `audit-${Date.now()}@test.local`;
    const { data: signed } = await fresh.auth.signUp({ email, password: 'password123' });
    if (!signed?.user) return; // confirmations on — nothing to test here
    const { error } = await fresh
      .from('profiles')
      .insert({ id: signed.user.id, handle: `audit${Date.now()}`, is_admin: true });
    assert.ok(error, 'is_admin is not a column a rider may write');
    await admin.auth.admin.deleteUser(signed.user.id).catch(() => {});
  });

  it('the profile fields a rider does own still write', async () => {
    const { error } = await asha
      .from('profiles')
      .update({ display_name: 'Asha', home_region: 'Himachal' })
      .eq('id', ashaId);
    assert.equal(error, null, `own-profile write broke: ${error?.message}`);
  });

  it('upload buckets carry a ceiling and a type shortlist', async () => {
    // What's being asserted is a row in storage.buckets, but the only way to
    // it from here is the storage service — which comes up a moment after the
    // database does. Retry the CONNECTION, never the assertion: a 502 while
    // the container settles is not a finding, and a flaky test is worse than
    // no test because it teaches you to re-run reds.
    let data, error;
    for (let i = 0; i < 10; i++) {
      ({ data, error } = await admin.storage.listBuckets());
      if (!error) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(error, null, `listing buckets failed: ${error?.message}`);
    const ours = data.filter((b) => ['avatars', 'route-photos'].includes(b.id));
    assert.equal(ours.length, 2, 'both buckets exist');
    for (const b of ours) {
      assert.ok(b.file_size_limit > 0, `${b.id} has a size ceiling`);
      assert.ok(b.allowed_mime_types?.length, `${b.id} has a type shortlist`);
    }
  });
});

/**
 * The definer sweep, 2026-07-26.
 *
 * rider_rode_route() reads ride_tracks as the owner, so RLS is not in the room.
 * It answered about anyone, to anyone, including unauthenticated callers — and
 * because the caller supplies the geometry, a boolean per call is enough to
 * walk inward on somebody's position.
 */
describe('a boolean is still an answer', () => {
  const VEER_PROFILE = '00000000-0000-4000-a000-000000000002';

  // Drawn over veer's seed track (Srinagar). If the oracle is open, this is
  // the probe that finds him.
  const overVeersTrack = 'LINESTRING(74.8300 34.0800, 74.8450 34.0900, 74.8600 34.1000)';

  it('will not say where another rider has been', async () => {
    const { data: probe, error } = await asha
      .from('routes')
      .insert({
        profile_id: ashaId,
        source: 'user',
        visibility: 'private',
        name: 'test: probe over veer',
        distance_km: 1,
        geom: overVeersTrack,
      })
      .select('id')
      .single();
    assert.equal(error, null, `probe insert failed: ${error?.message}`);

    // asha cannot see veer at all — he is private and unfollowed.
    const { data: visible } = await asha.from('profiles').select('id').eq('id', VEER_PROFILE);
    assert.equal(visible.length, 0, 'veer is genuinely invisible to asha');

    const { data: answer } = await asha.rpc('rider_rode_route', {
      p_profile_id: VEER_PROFILE,
      p_route_id: probe.id,
    });
    assert.notEqual(answer, true, 'asking about someone else never returns true');

    await asha.from('routes').delete().eq('id', probe.id);
  });

  it('tells an unauthenticated caller the same thing either way', async () => {
    // The property that matters is not "never true" — it's that the answer
    // carries no information. The first fix returned null where the rider had
    // ridden and false where they hadn't, which is the same oracle in a
    // different alphabet, and a "never true" assertion sailed straight past it.
    const mk = async (name, geom) => {
      const { data } = await asha
        .from('routes')
        .insert({ profile_id: ashaId, source: 'user', visibility: 'private', name, distance_km: 1, geom })
        .select('id')
        .single();
      return data.id;
    };
    const hit = await mk('test: anon probe hit', overVeersTrack);
    const miss = await mk('test: anon probe miss', 'LINESTRING(72.5000 23.0000, 72.5100 23.0100, 72.5200 23.0200)');

    const ask = (id) => anon.rpc('rider_rode_route', { p_profile_id: VEER_PROFILE, p_route_id: id });
    const onTrack = await ask(hit);
    const faraway = await ask(miss);

    if (onTrack.error && faraway.error) {
      // Grant is gone — nothing to distinguish.
    } else {
      assert.equal(
        onTrack.data,
        faraway.data,
        'a probe over the rider and a probe 1500km away must be indistinguishable'
      );
      assert.notEqual(onTrack.data, true, 'and certainly never true');
    }

    await asha.from('routes').delete().in('id', [hit, miss]);
  });

  it('still tells a rider about their own riding', async () => {
    // Asha's own track, so the honest use — the one set_rode_it() makes —
    // must keep working.
    const { data: probe } = await asha
      .from('routes')
      .insert({
        profile_id: ashaId,
        source: 'user',
        visibility: 'public',
        name: 'test: over my own track',
        distance_km: 1,
        geom: 'LINESTRING(78.3700 31.3760, 78.3900 31.3680, 78.4100 31.3590)',
      })
      .select('id')
      .single();

    const { data: mine } = await asha.rpc('rider_rode_route', {
      p_profile_id: ashaId,
      p_route_id: probe.id,
    });
    assert.equal(mine, true, 'a rider is still told they rode their own road');

    await asha.from('routes').delete().eq('id', probe.id);
  });
});

/**
 * The signed-out surface, asserted.
 *
 * `revoke ... from public` never removed anon on hosted — Supabase grants
 * EXECUTE to anon directly — so eleven functions written as authenticated-only
 * answered anonymous callers in production for months. Their internal
 * auth.uid() predicates held, so nothing leaked, but the second layer was
 * decorative. And crew_roster shows the other erosion: a DROP FUNCTION for a
 * new return shape discards the ACL, and the recreate takes the default.
 *
 * So the list of what a stranger may call is pinned here. Adding to it should
 * be a deliberate act with a test change attached.
 */
describe('the signed-out surface', () => {
  // Everything the app calls that requires a rider. Called with the anon key
  // and no session; each must refuse on privilege, not merely return empty.
  const mustRefuseAnon = [
    ['crew_chat', { p_crew_id: '00000000-0000-0000-0000-000000000000', p_before: null }],
    ['crew_roster', { p_crew_id: '00000000-0000-0000-0000-000000000000' }],
    ['crew_live_riders', { p_crew_id: '00000000-0000-0000-0000-000000000000' }],
    ['crew_leaderboard', {}],
    ['crew_member_contributions', { p_crew_id: '00000000-0000-0000-0000-000000000000' }],
    ['my_crew_contributions', {}],
    ['invite_list', { p_crew_id: null }],
    ['invite_detail', { p_invite_id: '00000000-0000-0000-0000-000000000000' }],
    ['invite_riders', { p_invite_id: '00000000-0000-0000-0000-000000000000' }],
    ['my_upcoming_rides', {}],
    ['follow_edges', {}],
    ['explore_feed', { p_before: null }],
    ['suggested_riders', {}],
    ['owns_ride', { p_ride_id: '00000000-0000-0000-0000-000000000000' }],
    ['rider_rode_route', {
      p_profile_id: '00000000-0000-0000-0000-000000000000',
      p_route_id: '00000000-0000-0000-0000-000000000000',
    }],
    ['award_achievements', { p_profile_id: '00000000-0000-0000-0000-000000000000' }],
  ];

  for (const [fn, args] of mustRefuseAnon) {
    it(`${fn} refuses a signed-out caller`, async () => {
      const { error } = await anon.rpc(fn, args);
      assert.ok(error, `${fn} answered anon — it should not be executable at all`);
      assert.match(
        error.message,
        /permission denied|does not exist/i,
        `${fn} refused for the wrong reason: ${error.message}`
      );
    });
  }

  // The other half: the signed-out surface must still work, or the catalogue
  // goes dark for anyone who hasn't signed up yet.
  it('still lets a stranger read the public catalogue', async () => {
    const { error: rp } = await anon.from('routes_public').select('id, name').limit(1);
    assert.equal(rp, null, `routes_public broke for anon: ${rp?.message}`);

    const { error: geo } = await anon.rpc('public_route_geojson', { p_route_id: ASHA_ROUTE });
    assert.equal(geo, null, `clipped geometry broke for anon: ${geo?.message}`);

    const { error: stats } = await anon.rpc('profile_stats', { p_profile_id: ashaId });
    assert.equal(stats, null, `profile_stats broke for anon: ${stats?.message}`);
  });
});

/**
 * The grant side of the same coin.
 *
 * Revoking anon from a definer function also removes PUBLIC, and PUBLIC was
 * the only path `authenticated` still had to crew_roster — its real grant was
 * discarded by a DROP FUNCTION in 20260717000100 and never restored. The suite
 * had 130 tests and none of them read a roster as a member, so tightening the
 * ACL would have shipped a dark screen. It reads one now.
 */
describe('a member can still read their own crew', () => {
  it('crew_roster answers an authenticated member', async () => {
    const { data: crew, error: ce } = await asha
      .from('crews')
      .insert({ created_by: ashaId, name: 'test: roster crew', region: 'HP' })
      .select('id')
      .single();
    assert.equal(ce, null, `crew insert failed: ${ce?.message}`);

    const { data, error } = await asha.rpc('crew_roster', { p_crew_id: crew.id });
    assert.equal(error, null, `crew_roster refused a member: ${error?.message}`);
    assert.ok(Array.isArray(data) && data.length >= 1, 'the creator is on their own roster');
    assert.ok(data.some((m) => m.profile_id === ashaId), 'and it is them');

    await asha.from('crews').delete().eq('id', crew.id);
  });
});

/**
 * One answer to who may see a route.
 *
 * Route standardization gave a route its own visibility, and moved
 * public_route_geom() onto route_readable(). route_visible() was left on the
 * old owner-only rule, so the line on the map was hidden while the
 * conversation about it stayed open — and comments are where riders write the
 * things a map cannot show.
 */
describe('a route’s own visibility governs its thread', () => {
  it('a private route’s comments do not reach a stranger', async () => {
    // Asha's profile is public. The ROUTE is not.
    const { data: rt, error } = await asha
      .from('routes')
      .insert({
        profile_id: ashaId,
        source: 'user',
        visibility: 'private',
        name: 'test: private route',
        distance_km: 5,
        geom: 'LINESTRING(78.37 31.376, 78.39 31.368)',
      })
      .select('id')
      .single();
    assert.equal(error, null, `route insert failed: ${error?.message}`);

    const { error: ce } = await asha.from('route_comments').insert({
      route_id: rt.id,
      profile_id: ashaId,
      body: 'test: the gate by my house is locked after 8pm',
    });
    assert.equal(ce, null, `owner could not comment on their own route: ${ce?.message}`);

    // The two helpers must now agree.
    const readable = await anon.rpc('route_readable', { p_route_id: rt.id });
    const visible = await anon.rpc('route_visible', { p_route_id: rt.id });
    assert.equal(readable.data, false, 'route_readable withholds it');
    assert.equal(visible.data, false, 'and route_visible now agrees');

    const thread = await anon.rpc('route_thread', { p_route_id: rt.id });
    assert.equal(thread.data?.length ?? 0, 0, 'the conversation is withheld too');

    const geom = await anon.rpc('public_route_geojson', { p_route_id: rt.id });
    assert.equal(geom.data, null, 'as it always was for the line itself');

    // And the owner still sees their own.
    const mine = await asha.rpc('route_thread', { p_route_id: rt.id });
    assert.equal(mine.data.length, 1, 'the owner still reads their own thread');

    await asha.from('routes').delete().eq('id', rt.id);
  });

  it('a shared route’s comments still reach everyone', async () => {
    // The tightening must not take the ordinary case with it: ASHA_ROUTE is a
    // public user route from the seed.
    const { error } = await anon.rpc('route_thread', { p_route_id: ASHA_ROUTE });
    assert.equal(error, null, `public route thread broke: ${error?.message}`);
    const { data: readable } = await anon.rpc('route_visible', { p_route_id: ASHA_ROUTE });
    assert.equal(readable, true, 'a shared route stays readable');
  });
});

/**
 * The cross-user matrix.
 *
 * The definer sweep covered half the authorization model. This is the other
 * half, and it is deliberately not a reading of the policies — reading is what
 * missed `routes` keeping a table-wide select grant when routes_read widened,
 * and what missed route_visible going stale after the visibility model changed.
 * This attacks instead: veer, a second real account, tries to touch asha's rows
 * in every table that has RLS.
 *
 * One invariant covers every table regardless of its read rules: whatever a
 * stranger may SEE, they may never modify. So each table is attacked three
 * ways — update, delete, and insert-as-someone-else — and all 23 are listed,
 * so a new table arriving with no policies fails here rather than in
 * production.
 */
describe('cross-user write protection', () => {
  const fx = {};

  before(async () => {
    fx.route = ASHA_ROUTE;
    fx.post = (
      await asha.from('posts').insert({ profile_id: ashaId, body: 'matrix: asha post' }).select('id').single()
    ).data?.id;
    fx.crew = (
      await asha.from('crews').insert({ created_by: ashaId, name: 'matrix: asha crew', region: 'HP' }).select('id').single()
    ).data?.id;
    fx.invite = (
      await asha.from('ride_invites').insert({
        created_by: ashaId,
        route_id: fx.route,
        title: 'matrix: asha ride',
        starts_at: new Date(Date.now() + 864e5).toISOString(),
      }).select('id').single()
    ).data?.id;
  });

  after(async () => {
    await asha.from('ride_invites').delete().like('title', 'matrix:%');
    await asha.from('posts').delete().like('body', 'matrix:%');
    await asha.from('crews').delete().like('name', 'matrix:%');
    await asha.from('bikes').delete().like('make', 'matrix:%');
    await asha.from('privacy_zones').delete().like('label', 'matrix:%');
  });

  // owner: the column naming the row's owner.
  // mk:    a row owned by the given id, for the insert-as-someone-else attack.
  // patch: a harmless column to attempt to overwrite.
  const TABLES = [
    { t: 'profiles', owner: 'id', patch: { display_name: 'matrix: hacked' }, mk: (id) => ({ id, handle: 'matrixhandle' }) },
    { t: 'bikes', owner: 'profile_id', patch: { make: 'matrix: hacked' }, mk: (id) => ({ profile_id: id, make: 'matrix: x', model: 'y' }) },
    { t: 'rides', owner: 'profile_id', patch: { title: 'matrix: hacked' }, mk: (id) => ({ profile_id: id, started_at: new Date().toISOString(), ended_at: new Date().toISOString() }) },
    { t: 'ride_tracks', owner: 'profile_id', patch: { geom: 'MULTILINESTRING((1 1, 2 2))' }, mk: (id) => ({ ride_id: crypto.randomUUID(), profile_id: id, geom: 'MULTILINESTRING((1 1, 2 2))' }) },
    { t: 'routes', owner: 'profile_id', patch: { name: 'matrix: hacked' }, mk: (id) => ({ profile_id: id, source: 'user', name: 'matrix: x', geom: 'LINESTRING(1 1, 2 2)' }) },
    { t: 'privacy_zones', owner: 'profile_id', patch: { label: 'matrix: hacked' }, mk: (id) => ({ profile_id: id, label: 'matrix: z', area: 'POLYGON((1 1, 2 1, 2 2, 1 2, 1 1))' }) },
    { t: 'recording_reports', owner: 'profile_id', patch: {}, mk: (id) => ({ profile_id: id }) },
    { t: 'follows', owner: 'follower_id', patch: { state: 'accepted' }, mk: (id) => ({ follower_id: id, followee_id: veerId }) },
    { t: 'route_comments', owner: 'profile_id', patch: { body: 'matrix: hacked' }, mk: (id) => ({ route_id: fx.route, profile_id: id, body: 'matrix: c' }) },
    { t: 'condition_reports', owner: 'profile_id', patch: { note: 'matrix: hacked' }, mk: (id) => ({ route_id: fx.route, profile_id: id, status: 'clear' }) },
    { t: 'content_reports', owner: 'reporter_id', patch: {}, mk: (id) => ({ reporter_id: id }) },
    { t: 'push_tokens', owner: 'profile_id', patch: { token: 'matrix: hacked' }, mk: (id) => ({ profile_id: id, token: 'matrix: tok' }) },
    { t: 'notifications', owner: 'profile_id', patch: { title: 'matrix: hacked' }, mk: (id) => ({ profile_id: id, title: 'matrix: n' }) },
    { t: 'crews', owner: 'created_by', patch: { name: 'matrix: hacked' }, mk: (id) => ({ created_by: id, name: 'matrix: crew2' }) },
    { t: 'crew_members', owner: 'profile_id', patch: { role: 'admin' }, mk: (id) => ({ crew_id: fx.crew, profile_id: id, role: 'member' }) },
    { t: 'crew_messages', owner: 'profile_id', patch: { body: 'matrix: hacked' }, mk: (id) => ({ crew_id: fx.crew, profile_id: id, body: 'matrix: m' }) },
    { t: 'ride_invites', owner: 'created_by', patch: { title: 'matrix: hacked' }, mk: (id) => ({ created_by: id, route_id: fx.route, title: 'matrix: i', starts_at: new Date(Date.now() + 864e5).toISOString() }) },
    { t: 'invite_rsvps', owner: 'profile_id', patch: {}, mk: (id) => ({ invite_id: fx.invite, profile_id: id }) },
    { t: 'live_positions', owner: 'profile_id', patch: { geom: 'POINT(1 1)' }, mk: (id) => ({ profile_id: id, geom: 'POINT(1 1)' }) },
    { t: 'achievements', owner: 'profile_id', patch: {}, mk: (id) => ({ profile_id: id, key: 'matrix: k' }) },
    { t: 'posts', owner: 'profile_id', patch: { body: 'matrix: hacked' }, mk: (id) => ({ profile_id: id, body: 'matrix: p' }) },
    { t: 'post_comments', owner: 'profile_id', patch: { body: 'matrix: hacked' }, mk: (id) => ({ post_id: fx.post, profile_id: id, body: 'matrix: pc' }) },
    { t: 'post_likes', owner: 'profile_id', patch: {}, mk: (id) => ({ post_id: fx.post, profile_id: id }) },
  ];

  for (const { t, owner, patch, mk } of TABLES) {
    it(t + ': a stranger cannot create a row owned by someone else', async () => {
      const { data, error } = await veer.from(t).insert(mk(ashaId)).select();
      // Refused on policy, refused on privilege, or it wrote nothing. Never a row.
      assert.ok(error || (data?.length ?? 0) === 0, 'veer inserted into ' + t + ' as asha');
    });

    if (Object.keys(patch).length > 0) {
      it(t + ': a stranger cannot overwrite another rider row', async () => {
        const { data, error } = await veer.from(t).update(patch).eq(owner, ashaId).select();
        assert.ok(error || (data?.length ?? 0) === 0, 'veer updated ' + data?.length + ' row(s) in ' + t);
      });
    }

    it(t + ': a stranger cannot delete another rider row', async () => {
      const { data, error } = await veer.from(t).delete().eq(owner, ashaId).select();
      assert.ok(error || (data?.length ?? 0) === 0, 'veer deleted ' + data?.length + ' row(s) from ' + t);
    });
  }
});
