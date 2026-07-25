import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '@maplibre/maplibre-react-native';
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
export function RecordMap({
  points,
  destination,
}: {
  points: Pt[];
  /** A line to somewhere, when the rider set one. Drawn behind the ridden track. */
  destination?: [number, number][] | null;
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
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <MapLibreMap
        logo={false}
        attributionPosition={{ top: 8, left: 8 }}
        style={{ flex: 1 }}
        mapStyle={STYLE_URL}
        compass={false}
        scaleBar={false}
      >
        {centre && <Camera center={centre} zoom={14} />}

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
        {segments.length > 0 && (
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

      {/* The numbers have to stay dominant: a scrim from the bottom so the
          odometer never fights the map for contrast. */}
      <View style={st.scrim} pointerEvents="none" />
    </View>
  );
}

const st = StyleSheet.create({
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '58%',
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
});
