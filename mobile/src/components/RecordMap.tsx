import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  VectorSource,
} from '@maplibre/maplibre-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { accent, color } from '../theme/tokens';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

type Pt = { lat: number; lng: number; segment_seq: number };

/**
 * The record screen's map bed — a real map now, not a drawing of one.
 *
 * It replaced an SVG of invented terrain contours, which was decoration
 * pretending to be information: the screen was black, and a rider glancing
 * down learned nothing about where they were. The line you're drawing as you
 * ride is the single most useful thing that screen can show, and it's the
 * app's own signature besides.
 *
 * Segments stay separate, as everywhere else — the pen lifts across a
 * dropout and never draws road the rider didn't cover (§5).
 *
 * Battery: this only costs while the screen is on, which for most of an
 * eight-hour ride it isn't. Tiles simply fail to load in a dead zone and the
 * track keeps drawing over whatever is cached — the recording never depends
 * on the map.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const TILE_URL = `${SUPABASE_URL}/rest/v1/rpc/trace_tiles?z={z}&x={x}&y={y}`;

export function RecordMap({
  points,
  destination,
  recentreKey = 0,
  mode = 'ride',
  traceBounds,
}: {
  points: Pt[];
  /** A line to somewhere, when the rider set one. Drawn behind the ridden track. */
  destination?: [number, number][] | null;
  /** Bump to snap the camera back to the rider after they've panned away. */
  recentreKey?: number;
  /** 'ride' draws what you're recording; 'traces' draws everywhere you've been. */
  mode?: 'ride' | 'traces';
  /** [w,s,e,n] of the rider's whole history, so 'traces' opens fitted to it. */
  traceBounds?: [number, number, number, number] | null;
}) {
  // One line per segment. A gap is drawn as nothing at all.
  const segments = useMemo(() => {
    const out = new Map<number, [number, number][]>();
    for (const p of points) {
      const arr = out.get(p.segment_seq) ?? [];
      arr.push([p.lng, p.lat]);
      out.set(p.segment_seq, arr);
    }
    return [...out.values()].filter((s) => s.length >= 2);
  }, [points]);

  const head = points.length ? ([points[points.length - 1].lng, points[points.length - 1].lat] as [number, number]) : null;
  const centre = head ?? (destination?.[0] ?? null);

  return (
    // Interactive: pan and pinch are what anyone expects of a map, and a
    // rider checking what's ahead needs to move it. Only the scrim below
    // ignores touches; the map itself takes them.
    <View style={StyleSheet.absoluteFill}>
      <MapLibreMap
        logo={false}
        attributionPosition={{ top: 8, left: 8 }}
        style={{ flex: 1 }}
        mapStyle={STYLE_URL}
        compass
        scaleBar={false}
      >
        {/* Keyed on `recentre` so the camera follows the ride only when it
            changes — otherwise every position update would yank the map back
            and fight the rider trying to look ahead. In traces mode it opens
            fitted to everywhere you've ridden. */}
        {mode === 'traces' && traceBounds ? (
          <Camera key="c-traces" initialViewState={{ bounds: traceBounds }} />
        ) : (
          centre && <Camera key={`c-${recentreKey}`} center={centre} zoom={14} />
        )}

        {/* Everywhere you've ever ridden. Three translucent passes, so a road
            ridden ten times glows ten times over — density reads as heat. */}
        {mode === 'traces' && (
          <VectorSource id="trace" tiles={[TILE_URL]}>
            <Layer
              type="line"
              id="trace-glow"
              source="trace"
              source-layer="trace"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': accent.trace, 'line-width': 6, 'line-opacity': 0.07 }}
            />
            <Layer
              type="line"
              id="trace-mid"
              source="trace"
              source-layer="trace"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': accent.trace, 'line-width': 2.5, 'line-opacity': 0.18 }}
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
        )}

        {/* Where you're headed, if you said. Deliberately dimmer than the
            ridden line — it's a suggestion, not a record of anything. */}
        {destination && destination.length > 1 && (
          <GeoJSONSource
            id="rec-destination"
            data={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: destination },
            }}
          >
            <Layer
              type="line"
              id="rec-dest-line"
              source="rec-destination"
              paint={{
                'line-color': color.white,
                'line-width': 3,
                'line-opacity': 0.28,
                'line-dasharray': [2, 2],
              }}
            />
          </GeoJSONSource>
        )}

        {/* What you have actually ridden, in the trace language. */}
        {mode === 'ride' && segments.length > 0 && (
          <GeoJSONSource
            id="rec-track"
            data={{
              type: 'FeatureCollection',
              features: segments.map((seg) => ({
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: seg },
              })),
            }}
          >
            <Layer
              type="line"
              id="rec-track-glow"
              source="rec-track"
              paint={{ 'line-color': accent.trace, 'line-width': 9, 'line-opacity': 0.22 }}
            />
            <Layer
              type="line"
              id="rec-track-line"
              source="rec-track"
              paint={{ 'line-color': accent.trace, 'line-width': 3.5 }}
            />
          </GeoJSONSource>
        )}

        {head && (
          <GeoJSONSource
            id="rec-head"
            data={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: head } }}
          >
            <Layer
              type="circle"
              id="rec-head-halo"
              source="rec-head"
              paint={{ 'circle-radius': 15, 'circle-color': accent.trace, 'circle-opacity': 0.16 }}
            />
            <Layer
              type="circle"
              id="rec-head-dot"
              source="rec-head"
              paint={{
                'circle-radius': 6,
                'circle-color': accent.trace,
                'circle-stroke-width': 2,
                'circle-stroke-color': color.void,
              }}
            />
          </GeoJSONSource>
        )}
      </MapLibreMap>

      {/* Just enough shade under the numbers to keep them legible — a soft
          fade at the bottom, not the sheet of black that was covering most of
          the map. */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.88)']}
        locations={[0, 0.45, 1]}
        style={st.fade}
        pointerEvents="none"
      />
    </View>
  );
}

const st = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '34%' },
});
