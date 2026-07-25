import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '@maplibre/maplibre-react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../../../src/components/Avatar';
import { crewLiveRiders, LiveRider } from '../../../src/lib/db';
import { accent, color, font, layout, surface } from '../../../src/theme/tokens';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/**
 * Where the crew is, right now.
 *
 * This is the answer to "where do they see it": the crew room says someone is
 * out, and this is where you look. Only riders who named this crew appear, and
 * only while their position is fresh — a dot older than fifteen minutes is a
 * lie someone might ride toward, so it simply stops existing.
 */
export default function CrewLive() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [riders, setRiders] = useState<LiveRider[]>([]);

  const load = useCallback(() => {
    if (!id) return;
    crewLiveRiders(id).then(setRiders).catch(() => {});
  }, [id]);

  // Polled rather than realtime: positions are written every 30s by the
  // recorder, so a socket would mostly sit idle and cost battery to hold open.
  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const points = riders
    .map((r) => r.point?.coordinates)
    .filter(Boolean) as [number, number][];

  return (
    <View style={st.root}>
      <MapLibreMap
        logo={false}
        attributionPosition={{ bottom: 8, left: 8 }}
        style={{ flex: 1 }}
        mapStyle={STYLE_URL}
        compass
        scaleBar={false}
      >
        {points.length > 0 && (
          <Camera
            key={`cam-${points.length}`}
            initialViewState={
              points.length === 1
                ? { center: points[0], zoom: 12 }
                : { bounds: boundsOf(points) }
            }
          />
        )}

        {riders.map((r) =>
          r.point?.coordinates ? (
            <GeoJSONSource
              key={r.profile_id}
              id={`live-${r.profile_id}`}
              data={{
                type: 'Feature',
                properties: {},
                geometry: { type: 'Point', coordinates: r.point.coordinates },
              }}
            >
              <Layer
                type="circle"
                id={`live-halo-${r.profile_id}`}
                source={`live-${r.profile_id}`}
                paint={{ 'circle-radius': 16, 'circle-color': accent.trace, 'circle-opacity': 0.18 }}
              />
              <Layer
                type="circle"
                id={`live-dot-${r.profile_id}`}
                source={`live-${r.profile_id}`}
                paint={{
                  'circle-radius': 7,
                  'circle-color': accent.trace,
                  'circle-stroke-width': 2,
                  'circle-stroke-color': color.void,
                }}
              />
            </GeoJSONSource>
          ) : null
        )}
      </MapLibreMap>

      <View style={[st.top, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 6 }}>
          <Feather name="chevron-left" size={20} color={color.white} />
        </Pressable>
        <Text style={st.title}>Out right now</Text>
      </View>

      <View style={[st.list, { paddingBottom: insets.bottom + 14 }]}>
        {riders.length === 0 ? (
          <Text style={st.empty}>Nobody is sharing right now.</Text>
        ) : (
          riders.map((r) => (
            <Pressable
              key={r.profile_id}
              onPress={() => router.push(`/rider/${r.profile_id}`)}
              style={st.row}
            >
              <Avatar url={r.avatar_url} handle={r.handle} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={st.handle}>@{r.handle}</Text>
                <Text style={st.since}>
                  {r.ride_started_at ? `Riding ${ago(r.ride_started_at)}` : 'Riding now'} · seen{' '}
                  {ago(r.updated_at)} ago
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

function ago(iso: string): string {
  const m = Math.max(0, Math.floor((Date.now() - +new Date(iso)) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function boundsOf(coords: [number, number][]): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  const padX = Math.max((e - w) * 0.25, 0.02);
  const padY = Math.max((n - s) * 0.25, 0.02);
  return [w - padX, s - padY, e + padX, n + padY];
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  title: {
    flex: 1,
    fontFamily: font.displaySemi,
    fontSize: 15,
    color: color.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  list: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 12,
    paddingHorizontal: layout.screenPadding,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderTopWidth: 1,
    borderTopColor: surface.stroke,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9 },
  handle: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  since: { fontFamily: font.mono, fontSize: 9, color: color.dim, marginTop: 3 },
  empty: { fontFamily: font.body, fontSize: 13, color: color.steel, paddingVertical: 8 },
});
