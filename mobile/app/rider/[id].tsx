import { Feather } from '@expo/vector-icons';
import { Camera, Map as MapLibreMap, Marker } from '@maplibre/maplibre-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { Badges } from '../../src/components/Badges';
import { BikeMarker } from '../../src/components/BikeMarker';
import { showAlert } from '../../src/components/Dialog';
import { PushButton } from '../../src/components/PushButton';
import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import {
  follow,
  followEdges,
  livePositionOf,
  LivePosition,
  Profile,
  ProfileStats,
  unfollow,
} from '../../src/lib/db';
import { ProfileBody, ProfileStatsRow } from '../../src/sections/ProfileBody';
import { supabase } from '../../src/lib/supabase';
import { color, font, layout } from '../../src/theme/tokens';

type FollowState = 'none' | 'pending' | 'accepted';

/**
 * Another rider — the same page as your own (item 2, 2026-07-25). Same avatar,
 * same follow counts, same four numbers, same sections, because a rider who
 * has learned their own profile shouldn't have to learn a second one.
 *
 * What differs is what only makes sense here: a Follow button where your edit
 * and search controls sit, and the live map when they're out riding. What you
 * can see still obeys the visibility rules end to end — a private profile
 * shows only its handle until they accept you.
 */
export default function RiderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [rider, setRider] = useState<Profile | null>(null);
  const [known, setKnown] = useState<{ handle: string } | null>(null);
  const [state, setState] = useState<FollowState>('none');
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [live, setLive] = useState<LivePosition | null>(null);

  // Riding now: poll the live point while the screen is open. RLS makes this
  // return nothing unless they accepted your follow.
  useEffect(() => {
    if (!id || state !== 'accepted') return;
    let alive = true;
    const check = () =>
      livePositionOf(id)
        .then((p) => {
          if (!alive) return;
          const fresh = p && Date.now() - +new Date(p.updated_at) < 10 * 60_000;
          setLive(fresh ? p : null);
        })
        .catch(() => {});
    check();
    const t = setInterval(check, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, state]);

  const load = useCallback(() => {
    if (!id) return;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => setRider(data));
    followEdges()
      .then((edges) => {
        const e = edges.find((x) => x.direction === 'following' && x.other_id === id);
        setState((e?.state as FollowState) ?? 'none');
        const anyEdge = edges.find((x) => x.other_id === id);
        if (anyEdge) setKnown({ handle: anyEdge.handle });
      })
      .catch(() => {});
  }, [id]);

  useEffect(load, [load]);

  const onFollow = async () => {
    if (!session || !id) return;
    try {
      setState(await follow(session.user.id, id));
    } catch (e) {
      showAlert('Could not follow', (e as Error).message);
    }
  };

  const onUnfollow = async () => {
    if (!session || !id) return;
    await unfollow(session.user.id, id).catch(() => {});
    setState('none');
    load();
  };

  const handle = rider?.handle ?? known?.handle;

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content}>
      <View style={st.topBar}>
        <MonoLabel size={9.5} style={{ letterSpacing: 2.3 }}>
          {[rider?.home_region, rider?.visibility === 'public' ? 'PUBLIC' : 'PRIVATE']
            .filter(Boolean)
            .join(' — ')
            .toUpperCase()}
        </MonoLabel>
        <Pressable onPress={() => router.back()} hitSlop={8} style={st.iconBtn}>
          <Feather name="x" size={18} color={color.steel} />
        </Pressable>
      </View>

      <View style={st.identity}>
        <Avatar url={rider?.avatar_url} handle={handle} size={84} />
        <View style={{ flex: 1 }}>
          <Text style={st.h1} numberOfLines={1}>
            {handle ? `@${handle}` : 'Rider'}
          </Text>
          {rider?.display_name ? <Text style={st.sub}>{rider.display_name}</Text> : null}
          {/* Their graph, stated but not walkable: followEdges() reads your
              own follows, and browsing someone else's isn't ours to offer. */}
          <View style={st.followRow}>
            <Text style={st.followText}>
              <Text style={st.followNum}>{stats?.follower_count ?? 0}</Text> followers
            </Text>
            <Text style={st.followText}>
              <Text style={st.followNum}>{stats?.following_count ?? 0}</Text> following
            </Text>
          </View>
        </View>
      </View>

      {state === 'none' && <PushButton label="Follow" onPress={onFollow} style={{ marginTop: 18 }} />}
      {state === 'pending' && (
        <PushButton
          label="Requested — cancel"
          variant="secondary"
          onPress={onUnfollow}
          style={{ marginTop: 18 }}
        />
      )}
      {state === 'accepted' && (
        <PushButton
          label="Following — unfollow"
          variant="secondary"
          onPress={onUnfollow}
          style={{ marginTop: 18 }}
        />
      )}

      {live && (
        <View style={st.liveWrap}>
          <View style={st.liveHead}>
            <View style={st.liveDot} />
            <Text style={st.liveLabel}>RIDING NOW</Text>
            <Text style={st.liveWhen}>
              updated{' '}
              {Math.max(1, Math.round((Date.now() - +new Date(live.updated_at)) / 60000))}m ago
            </Text>
          </View>
          <View style={st.liveMap}>
            <MapLibreMap
              logo={false}
              attributionPosition={{ top: 110, right: 10 }}
              style={{ flex: 1 }}
              mapStyle="https://tiles.openfreemap.org/styles/dark"
              dragPan={false}
              touchZoom={false}
              doubleTapZoom={false}
              touchRotate={false}
              touchPitch={false}
              compass={false}
              scaleBar={false}
            >
              <Camera initialViewState={{ center: live.point.coordinates, zoom: 11 }} />
              <Marker lngLat={live.point.coordinates} anchor="center">
                <BikeMarker type={null} />
              </Marker>
            </MapLibreMap>
          </View>
        </View>
      )}

      {rider ? (
        <>
          <Badges profileId={rider.id} />
          <ProfileStatsRow profileId={rider.id} onStats={setStats} />
          <ProfileBody profileId={rider.id} handle={rider.handle} />
        </>
      ) : (
        <Text style={st.privateNote}>
          This rider is private. Their rides, routes and garage open up if they accept your follow.
        </Text>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 60, paddingBottom: 80 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { padding: 8 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 16 },
  h1: {
    fontFamily: font.display,
    fontSize: 27,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 29,
  },
  sub: { fontFamily: font.body, fontSize: 13, color: color.steel, marginTop: 4 },
  followRow: { flexDirection: 'row', gap: 16, marginTop: 9 },
  followText: { fontFamily: font.body, fontSize: 12.5, color: color.steel },
  followNum: { fontFamily: font.bodyBold, color: color.white },
  privateNote: {
    fontFamily: font.body,
    fontSize: 12.5,
    color: color.steel,
    lineHeight: 18,
    marginTop: 24,
  },
  liveWrap: { marginTop: 22 },
  liveHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.trace },
  liveLabel: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.6, color: color.trace },
  liveWhen: { fontFamily: font.mono, fontSize: 8, color: color.dim, marginLeft: 'auto' },
  liveMap: {
    height: 170,
    borderRadius: layout.cardRadius,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(46,125,255,.25)',
  },
});
