import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badges } from '../../src/components/Badges';
import { PushButton } from '../../src/components/PushButton';
import { Card, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { ActivitySection } from '../../src/sections/ActivitySection';
import { CrewsSection } from '../../src/sections/CrewsSection';
import { Bike, bikeSubtitle, bikeTitle } from '../../src/lib/db';
import { Camera, Map as MapLibreMap, Marker } from '@maplibre/maplibre-react-native';

import { BikeMarker } from '../../src/components/BikeMarker';
import {
  follow,
  followEdges,
  listRiderRoutes,
  livePositionOf,
  LivePosition,
  Profile,
  Route,
  unfollow,
} from '../../src/lib/db';
import { supabase } from '../../src/lib/supabase';
import { color, font, layout } from '../../src/theme/tokens';

type FollowState = 'none' | 'pending' | 'accepted';

/**
 * Another rider. What you see obeys the visibility rules end to end: a
 * private profile shows only its handle until they accept you.
 */
export default function RiderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [rider, setRider] = useState<Profile | null>(null);
  const [known, setKnown] = useState<{ handle: string } | null>(null);
  const [state, setState] = useState<FollowState>('none');
  const [routes, setRoutes] = useState<Route[]>([]);
  const [rideStats, setRideStats] = useState<{ count: number; km: number } | null>(null);
  const [live, setLive] = useState<LivePosition | null>(null);
  const [bikes, setBikes] = useState<Bike[]>([]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    supabase
      .from('bikes')
      .select('*')
      .eq('profile_id', id)
      .order('created_at')
      .then(({ data }) => alive && setBikes(data ?? []));
    return () => {
      alive = false;
    };
  }, [id]);

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
    listRiderRoutes(id).then(setRoutes).catch(() => {});
    supabase
      .from('rides')
      .select('distance_km')
      .eq('profile_id', id)
      .then(({ data }) => {
        if (data) {
          setRideStats({
            count: data.length,
            km: data.reduce((s, r) => s + Number(r.distance_km), 0),
          });
        }
      });
  }, [id]);

  useEffect(load, [load]);

  const onFollow = async () => {
    if (!session || !id) return;
    try {
      const result = await follow(session.user.id, id);
      setState(result);
    } catch (e) {
      Alert.alert('Could not follow', (e as Error).message);
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
      <MonoLabel size={9.5}>
        {rider
          ? rider.visibility === 'public'
            ? 'PUBLIC PROFILE'
            : 'PRIVATE — FOLLOWING'
          : 'PRIVATE PROFILE'}
      </MonoLabel>
      <Text style={st.h1}>{handle ? `@${handle}` : 'Rider'}</Text>
      {rider?.display_name || rider?.home_region ? (
        <Text style={st.sub}>
          {[rider?.display_name, rider?.home_region].filter(Boolean).join(' · ')}
        </Text>
      ) : null}

      {rider && rideStats && (
        <View style={st.strip}>
          <View style={st.cell}>
            <MonoLabel size={8.5}>Rides</MonoLabel>
            <Text style={st.cellValue} allowFontScaling={false}>
              {rideStats.count}
            </Text>
          </View>
          <View style={[st.cell, st.cellDivider]}>
            <MonoLabel size={8.5}>Distance</MonoLabel>
            <Text style={st.cellValue} allowFontScaling={false}>
              {Math.round(rideStats.km).toLocaleString('en-IN')}
              <Text style={st.cellUnit}> km</Text>
            </Text>
          </View>
        </View>
      )}

      {!rider && (
        <Text style={st.privateNote}>
          This rider is private. Their rides and routes open up if they accept your follow.
        </Text>
      )}

      {live && (
        <View style={st.liveWrap}>
          <View style={st.liveHead}>
            <View style={st.liveDot} />
            <Text style={st.liveLabel}>RIDING NOW</Text>
            <Text style={st.liveWhen}>
              updated {Math.max(1, Math.round((Date.now() - +new Date(live.updated_at)) / 60000))}m ago
            </Text>
          </View>
          <View style={st.liveMap}>
            <MapLibreMap
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
              <Camera
                initialViewState={{
                  center: live.point.coordinates,
                  zoom: 11,
                }}
              />
              <Marker lngLat={live.point.coordinates} anchor="center">
                <BikeMarker type={null} />
              </Marker>
            </MapLibreMap>
          </View>
        </View>
      )}

      {rider && <Badges profileId={rider.id} />}

      {state === 'none' && <PushButton label="Follow" onPress={onFollow} style={{ marginTop: 24 }} />}
      {state === 'pending' && (
        <PushButton label="Requested — cancel" variant="slate" onPress={onUnfollow} style={{ marginTop: 24 }} />
      )}
      {state === 'accepted' && (
        <PushButton label="Following — unfollow" variant="slate" onPress={onUnfollow} style={{ marginTop: 24 }} />
      )}

      {bikes.length > 0 && (
        <>
          <MonoLabel size={9} style={{ marginTop: 30, marginBottom: 6 }}>
            Garage
          </MonoLabel>
          {bikes.map((b) => (
            <View key={b.id} style={st.bikeRow}>
              <Text style={st.bikeName}>{bikeTitle(b)}</Text>
              <Text style={st.bikeSub} allowFontScaling={false}>
                {[bikeSubtitle(b), `${Math.round(Number(b.current_odometer_km)).toLocaleString('en-IN')} km`]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ))}
        </>
      )}

      {rider && (
        <>
          <MonoLabel size={9} style={{ marginTop: 30, marginBottom: 6 }}>
            Crews
          </MonoLabel>
          <CrewsSection profileId={rider.id} />
          <MonoLabel size={9} style={{ marginTop: 30, marginBottom: 6 }}>
            Activity
          </MonoLabel>
          <ActivitySection profileId={rider.id} handle={rider.handle} />
        </>
      )}

      {routes.length > 0 && (
        <>
          <MonoLabel size={9} style={{ marginTop: 30, marginBottom: 10 }}>
            Routes
          </MonoLabel>
          {routes.map((r) => (
            <Pressable key={r.id} onPress={() => router.push(`/route/${r.id}`)}>
              {({ pressed }) => (
                <Card pressed={pressed} style={{ marginBottom: 10 }}>
                  {r.photo_url && (
                    <Image source={{ uri: r.photo_url }} style={st.routePhoto} resizeMode="cover" />
                  )}
                  <Text style={st.routeName}>{r.name}</Text>
                  <Text style={st.routeSub} allowFontScaling={false}>
                    {Number(r.distance_km).toFixed(1)} km
                    {r.terrain_tags?.length ? ` · ${r.terrain_tags.join(' · ')}` : ''}
                  </Text>
                </Card>
              )}
            </Pressable>
          ))}
        </>
      )}

      <Pressable onPress={() => router.back()} style={st.back}>
        <Text style={st.backText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 72, paddingBottom: 60 },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 40,
  },
  sub: { fontFamily: font.body, fontSize: 13, color: color.steel, marginTop: 8 },
  strip: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.hair,
    marginTop: 20,
  },
  cell: { flex: 1, paddingVertical: 13 },
  cellDivider: { borderLeftWidth: 1, borderLeftColor: color.hair, paddingLeft: 16 },
  cellValue: {
    fontFamily: font.displaySemi,
    fontSize: 25,
    color: color.white,
    fontVariant: ['tabular-nums'],
    marginTop: 5,
    lineHeight: 26,
  },
  cellUnit: { fontSize: 12, color: color.steel },
  privateNote: { fontFamily: font.body, fontSize: 12.5, color: color.steel, lineHeight: 18, marginTop: 20 },
  liveWrap: { marginTop: 22 },
  liveHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.signal },
  liveLabel: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.6, color: color.signal },
  liveWhen: { fontFamily: font.mono, fontSize: 8, color: color.dim, marginLeft: 'auto' },
  liveMap: {
    height: 170,
    borderRadius: layout.cardRadius,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(46,125,255,.25)',
  },
  bikeRow: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: color.hair },
  bikeName: { fontFamily: font.displaySemi, fontSize: 16, color: color.white, textTransform: 'uppercase' },
  bikeSub: { fontFamily: font.mono, fontSize: 9, color: color.steel, marginTop: 4, fontVariant: ['tabular-nums'] },
  routePhoto: { width: '100%', height: 120, borderRadius: 8, marginBottom: 12 },
  routeName: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  routeSub: {
    fontFamily: font.mono,
    fontSize: 10,
    color: color.steel,
    marginTop: 5,
    fontVariant: ['tabular-nums'],
  },
  back: { alignSelf: 'center', marginTop: 22, padding: 8 },
  backText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
