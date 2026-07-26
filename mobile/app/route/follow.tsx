import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '@maplibre/maplibre-react-native';
import { Feather } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoogleAttribution } from '../../src/components/GoogleAttribution';
import { Loading } from '../../src/components/Loading';
import { getRoute, Route, routeLine } from '../../src/lib/db';
import { metersBetween } from '../../src/lib/geo';
import { accent, color, font, layout, status, surface } from '../../src/theme/tokens';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/**
 * Follow the line.
 *
 * Deliberately not turn-by-turn (spec §6): the road is drawn, your position
 * moves along it, and that's the whole contract. No spoken instructions, no
 * rerouting — a rider in a helmet with gloves on wants a glance, not a
 * conversation, and voice guidance without an intercom is noise.
 *
 * What it does tell you is the thing a line alone can't: how far along you
 * are, how far is left, and — the one that actually matters on a mountain —
 * whether you have drifted off the route entirely.
 *
 * This screen is a battery cost: map rendering plus a live GPS watch plus the
 * screen held awake. Recording an eight-hour ride is the promise everything
 * else rests on, so this is a foreground screen the rider opens deliberately
 * and closes when they don't need it, never something running in the
 * background alongside the recorder.
 */
export default function FollowRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  useKeepAwake(); // a navigation screen that sleeps is not navigation

  const [route, setRoute] = useState<Route | null>(null);
  const [line, setLine] = useState<[number, number][]>([]);
  const [here, setHere] = useState<[number, number] | null>(null);
  const [offRoute, setOffRoute] = useState(false);
  const [remainingKm, setRemainingKm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sub = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      const r = await getRoute(id).catch(() => null);
      if (!r || !alive) return;
      setRoute(r);
      const segs = await routeLine(r.id).catch(() => []);
      if (!alive) return;
      if (segs.length === 0) {
        setError('This route has no line to follow yet.');
        return;
      }
      // Following wants one continuous thread, so segments are laid end to end.
      setLine(segs.flat());
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // Live position. Foreground only — the recorder owns background location,
  // and two watchers fighting over the GPS is how you ruin both.
  useEffect(() => {
    let alive = true;
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        const asked = await Location.requestForegroundPermissionsAsync();
        if (!asked.granted) {
          setError('Location is off, so there is nothing to follow.');
          return;
        }
      }
      const watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 10 },
        (loc) => {
          if (!alive) return;
          setHere([loc.coords.longitude, loc.coords.latitude]);
        }
      ).catch(() => null);
      sub.current = watcher;
    })();
    return () => {
      alive = false;
      sub.current?.remove();
    };
  }, []);

  // How far along, how far left, and whether the rider is still on it.
  useEffect(() => {
    if (!here || line.length < 2) return;
    let nearest = Infinity;
    let nearestIdx = 0;
    for (let i = 0; i < line.length; i++) {
      const d = metersBetween(here[1], here[0], line[i][1], line[i][0]);
      if (d < nearest) {
        nearest = d;
        nearestIdx = i;
      }
    }
    // 150m of slack: GPS wanders, and a dual carriageway is wide.
    setOffRoute(nearest > 150);

    let left = 0;
    for (let i = nearestIdx; i < line.length - 1; i++) {
      left += metersBetween(line[i][1], line[i][0], line[i + 1][1], line[i + 1][0]);
    }
    setRemainingKm(left / 1000);
  }, [here, line]);

  if (!route) return <Loading label="Getting the road" />;

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
        {/* Follows the rider rather than the whole route: on the road you care
            about the next few kilometres, not the shape of the entire day. */}
        <Camera center={here ?? line[0]} zoom={14} />

        {line.length > 1 && (
          <GeoJSONSource
            id="follow-line"
            data={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: line },
            }}
          >
            <Layer
              type="line"
              id="follow-glow"
              source="follow-line"
              paint={{ 'line-color': accent.trace, 'line-width': 9, 'line-opacity': 0.22 }}
            />
            <Layer
              type="line"
              id="follow-road"
              source="follow-line"
              paint={{ 'line-color': accent.trace, 'line-width': 4 }}
            />
          </GeoJSONSource>
        )}

        {here && (
          <GeoJSONSource
            id="me"
            data={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: here } }}
          >
            <Layer
              type="circle"
              id="me-halo"
              source="me"
              paint={{ 'circle-radius': 14, 'circle-color': color.white, 'circle-opacity': 0.15 }}
            />
            <Layer
              type="circle"
              id="me-dot"
              source="me"
              paint={{
                'circle-radius': 6,
                'circle-color': color.white,
                'circle-stroke-width': 2,
                'circle-stroke-color': color.void,
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      {/* Chrome over the map: name and exit up top, the numbers underneath. */}
      <View style={[st.top, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={st.back}>
          <Feather name="chevron-left" size={20} color={color.white} />
        </Pressable>
        <Text style={st.name} numberOfLines={1}>
          {route.name}
        </Text>
      </View>

      <View style={[st.bottom, { paddingBottom: insets.bottom + 14 }]}>
        {error ? (
          <Text style={st.error}>{error}</Text>
        ) : offRoute ? (
          <Text style={st.off}>Off the route — the line is elsewhere.</Text>
        ) : remainingKm != null ? (
          <Text style={st.left} allowFontScaling={false}>
            {remainingKm.toFixed(1)}
            <Text style={st.leftUnit}> km to go</Text>
          </Text>
        ) : (
          <Text style={st.waiting}>Waiting for a fix…</Text>
        )}
        <Text style={st.note}>Following only — no turn instructions.</Text>
        <GoogleAttribution align="center" />
      </View>
    </View>
  );
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
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  back: { padding: 6 },
  name: {
    flex: 1,
    fontFamily: font.displaySemi,
    fontSize: 15,
    color: color.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 14,
    paddingHorizontal: layout.screenPadding,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderTopWidth: 1,
    borderTopColor: surface.stroke,
  },
  left: {
    fontFamily: font.displaySemi,
    fontSize: 34,
    color: color.white,
    fontVariant: ['tabular-nums'],
  },
  leftUnit: { fontFamily: font.displayMedium, fontSize: 14, color: color.steel },
  off: { fontFamily: font.bodySemi, fontSize: 15, color: status.warning },
  waiting: { fontFamily: font.body, fontSize: 14, color: color.steel },
  error: { fontFamily: font.body, fontSize: 13, color: status.warning, textAlign: 'center' },
  note: { fontFamily: font.mono, fontSize: 8.5, letterSpacing: 1.2, color: color.dim, marginTop: 6 },
});
