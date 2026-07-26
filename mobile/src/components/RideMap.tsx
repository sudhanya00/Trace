import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '@maplibre/maplibre-react-native';
import { View, ViewStyle } from 'react-native';

import { color, layout } from '../theme/tokens';

/**
 * Static ride preview: the recorded track over the dark OpenFreeMap basemap.
 * Gaps render dashed at reduced opacity between segments — visible, never
 * counted, exactly like the record screen bed (§5). Gestures are off; this is
 * a picture, not a map to wander.
 */

export type Segments = [number, number][][]; // [lng, lat] per point, per segment

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

export function RideMap({ segments, height = 220, style }: { segments: Segments; height?: number; style?: ViewStyle }) {
  const coords = segments.flat();
  if (coords.length < 2) return null;

  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  // Pad the box ourselves — 18% margin so the track never kisses the frame.
  const padX = Math.max((e - w) * 0.18, 0.002);
  const padY = Math.max((n - s) * 0.18, 0.002);
  const bounds: [number, number, number, number] = [w - padX, s - padY, e + padX, n + padY];

  const features: object[] = segments
    .filter((seg) => seg.length >= 2)
    .map((seg) => ({
      type: 'Feature',
      properties: { kind: 'ridden' },
      geometry: { type: 'LineString', coordinates: seg },
    }));
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const cur = segments[i];
    if (!prev.length || !cur.length) continue;
    features.push({
      type: 'Feature',
      properties: { kind: 'gap' },
      geometry: { type: 'LineString', coordinates: [prev[prev.length - 1], cur[0]] },
    });
  }

  return (
    <View
      style={[
        {
          height,
          borderRadius: layout.cardRadius,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: color.hair,
        },
        style,
      ]}
    >
      <MapLibreMap
          logo={false}
          attributionPosition={{ top: 110, right: 10 }}
          style={{ flex: 1 }}
        mapStyle={STYLE_URL}
        dragPan={false}
        touchZoom={false}
        doubleTapZoom={false}
        doubleTapHoldZoom={false}
        touchRotate={false}
        touchPitch={false}
        compass={false}
        scaleBar={false}
      >
        <Camera initialViewState={{ bounds }} />
        <GeoJSONSource
          id="ride-track"
          data={{ type: 'FeatureCollection', features } as GeoJSON.GeoJSON}
        >
          <Layer
            type="line"
            id="ride-track-line"
            source="ride-track"
            filter={['!=', ['get', 'kind'], 'gap']}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': color.trace, 'line-width': 3.4 }}
          />
          <Layer
            type="line"
            id="ride-track-gaps"
            source="ride-track"
            filter={['==', ['get', 'kind'], 'gap']}
            layout={{ 'line-cap': 'round' }}
            paint={{
              'line-color': color.trace,
              'line-width': 2.2,
              'line-dasharray': [1.5, 3.5],
              'line-opacity': 0.55,
            }}
          />
        </GeoJSONSource>
      </MapLibreMap>
    </View>
  );
}
