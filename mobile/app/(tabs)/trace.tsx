import {
  Camera,
  Layer,
  Map as MapLibreMap,
  Marker,
  TransformRequestManager,
  VectorSource,
} from '@maplibre/maplibre-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BikeMarker } from '../../src/components/BikeMarker';
import { Loading } from '../../src/components/Loading';
import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { BikeType, listBikes, listMyRides, traceBounds } from '../../src/lib/db';
import { supabase } from '../../src/lib/supabase';
import { color, font, layout } from '../../src/theme/tokens';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const TILE_URL = `${SUPABASE_URL}/rest/v1/rpc/trace_tiles?z={z}&x={x}&y={y}`;
const FALLBACK: [number, number] = [77.17, 31.1]; // Himachal

/**
 * The Trace Map (Phase 02): a personal map of everywhere you've ridden.
 * Lines, not percentages — no road-network dependency, so off-road just
 * works. Density = heat: three translucent passes per line mean a road
 * ridden ten times glows ten times over. Tiles come straight off the live
 * tables (serverless v1); a pregenerated pipeline slots in behind this same
 * layer when scale demands it.
 */
export default function TraceMap() {
  const { session } = useAuth();
  const [ready, setReady] = useState(false);
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [totalKm, setTotalKm] = useState<number | null>(null);
  const [rideCount, setRideCount] = useState(0);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [bikeType, setBikeType] = useState<BikeType | null>(null);

  // Tile requests need the caller's JWT — the function is RLS-scoped to the
  // rider. Headers are (re)applied on focus so a refreshed token wins.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token || !alive) return;
        TransformRequestManager.clearHeaders();
        TransformRequestManager.addHeader({
          match: /rpc\/trace_tiles/,
          name: 'apikey',
          value: ANON_KEY,
        });
        TransformRequestManager.addHeader({
          match: /rpc\/trace_tiles/,
          name: 'Authorization',
          value: `Bearer ${token}`,
        });
        TransformRequestManager.addHeader({
          match: /rpc\/trace_tiles/,
          name: 'Accept',
          value: 'application/vnd.mapbox-vector-tile',
        });
        setReady(true);
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  const [camResolved, setCamResolved] = useState(false);

  useEffect(() => {
    if (!session) return;
    listMyRides(session.user.id)
      .then((rides) => {
        setRideCount(rides.length);
        setTotalKm(rides.reduce((s, r) => s + Number(r.distance_km), 0));
      })
      .catch(() => {});
    listBikes(session.user.id)
      .then((bikes) => {
        const active = bikes.filter((b) => b.is_active);
        if (active.length) setBikeType(active[active.length - 1].type);
      })
      .catch(() => {});
    // The camera waits until it knows where to open: your trace's bounds if
    // any exist, else where you're standing right now — never a random
    // default. A short deadline keeps a dead network from blanking the tab.
    (async () => {
      const locate = (async () => {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) return null;
        const pos =
          (await Location.getLastKnownPositionAsync()) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(
            () => null
          ));
        return pos ? ([pos.coords.longitude, pos.coords.latitude] as [number, number]) : null;
      })();
      const boundsQ = traceBounds().catch(() => null);
      const deadline = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3000));
      const [loc, b] = (await Promise.race([
        Promise.all([locate, boundsQ]),
        deadline.then(async () => [await Promise.race([locate, Promise.resolve(null)]), null]),
      ])) as [[number, number] | null, [number, number, number, number] | null];
      setMe(loc);
      setBounds(b);
      setCamResolved(true);
    })();
  }, [session]);

  return (
    <View style={st.root}>
      {(!ready || !camResolved) && <Loading label="Reading your trace" />}
      {ready && camResolved && (
        <MapLibreMap
          logo={false}
          attributionPosition={{ top: 110, right: 10 }}
          style={{ flex: 1 }}
          mapStyle={STYLE_URL}
          touchPitch={false}
          compass={false}
          scaleBar={false}
        >
          <Camera
            initialViewState={
              bounds
                ? {
                    bounds: [
                      bounds[0] - (bounds[2] - bounds[0]) * 0.15 - 0.01,
                      bounds[1] - (bounds[3] - bounds[1]) * 0.15 - 0.01,
                      bounds[2] + (bounds[2] - bounds[0]) * 0.15 + 0.01,
                      bounds[3] + (bounds[3] - bounds[1]) * 0.15 + 0.01,
                    ],
                  }
                : { center: me ?? FALLBACK, zoom: me ? 12 : 8 }
            }
          />
          {me && (
            <Marker lngLat={me} anchor="center">
              <BikeMarker type={bikeType} />
            </Marker>
          )}
          <VectorSource id="trace" tiles={[TILE_URL]}>
            {/* three translucent passes: overlap stacks into heat */}
            <Layer
              type="line"
              id="trace-glow"
              source="trace"
              source-layer="trace"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': color.signal, 'line-width': 6, 'line-opacity': 0.07 }}
            />
            <Layer
              type="line"
              id="trace-mid"
              source="trace"
              source-layer="trace"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': '#FFDE47', 'line-width': 2.5, 'line-opacity': 0.18 }}
            />
            <Layer
              type="line"
              id="trace-core"
              source="trace"
              source-layer="trace"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': '#FFF1A6', 'line-width': 1.2, 'line-opacity': 0.5 }}
            />
          </VectorSource>
        </MapLibreMap>
      )}

      {/* edge glow: the map sits IN the cluster, not on top of it */}
      <LinearGradient
        colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']}
        style={st.edgeTop}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={st.edgeLeft}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={st.edgeRight}
        pointerEvents="none"
      />

      {/* header overlay — mono voice, out of the map's way */}
      <View style={st.head} pointerEvents="none">
        <MonoLabel size={9.5} style={{ letterSpacing: 2.3 }}>
          Everywhere you've ridden
        </MonoLabel>
        <Text style={st.h1}>Trace</Text>
        {totalKm != null && rideCount > 0 && (
          <Text style={st.total} allowFontScaling={false}>
            {Math.round(totalKm).toLocaleString('en-IN')}
            <Text style={st.totalUnit}> km · {rideCount} rides</Text>
          </Text>
        )}
      </View>

      {rideCount === 0 && (
        <View style={st.empty} pointerEvents="none">
          <Text style={st.emptyText}>
            Your map is blank until the first ride syncs. It won't stay that way.
          </Text>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  edgeTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  edgeLeft: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 42 },
  edgeRight: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 42 },
  head: {
    position: 'absolute',
    top: 64,
    left: layout.screenPadding,
    right: layout.screenPadding,
  },
  h1: {
    fontFamily: font.display,
    fontSize: 41,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 42,
  },
  total: {
    fontFamily: font.display,
    fontSize: 21,
    color: color.white,
    fontVariant: ['tabular-nums'],
    marginTop: 8,
  },
  totalUnit: { fontSize: 12, color: color.steel },
  empty: {
    position: 'absolute',
    left: layout.screenPadding,
    right: layout.screenPadding,
    bottom: 130,
  },
  emptyText: { fontFamily: font.body, fontSize: 12.5, color: color.steel, lineHeight: 18 },
});
