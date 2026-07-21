import { StyleSheet, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { color } from '../theme/tokens';

export type Segments = [number, number][][]; // [lng, lat] per point, per segment

const W = 100;
const H = 64;

/**
 * A ride's shape at list size — SVG, not a map. Forty of these scroll in the
 * profile's Rides tab, and forty MapLibre instances is not a thing anyone
 * should ship.
 *
 * Segments stay separate, exactly as they do everywhere else: a gap is drawn
 * as nothing at all, never as a line joining two places the rider didn't
 * ride between (§5).
 */
export function TrackThumb({ segments }: { segments: Segments }) {
  const pts = segments.flat();
  if (pts.length < 2) return <View style={st.box} />;

  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of pts) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }

  // Fit the bounding box into the viewport at a single scale so the track
  // keeps its real proportions — a squashed ride reads as a different road.
  const spanX = Math.max(e - w, 1e-6);
  const spanY = Math.max(n - s, 1e-6);
  const pad = 6;
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const offX = (W - spanX * scale) / 2;
  const offY = (H - spanY * scale) / 2;

  const project = (seg: [number, number][]) =>
    seg
      .map(([lng, lat]) => {
        const x = offX + (lng - w) * scale;
        const y = H - (offY + (lat - s) * scale); // SVG y grows downward
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <View style={st.box}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {segments
          .filter((seg) => seg.length >= 2)
          .map((seg, i) => (
            <Polyline
              key={i}
              points={project(seg)}
              fill="none"
              stroke={color.steel}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
      </Svg>
    </View>
  );
}

const st = StyleSheet.create({
  box: {
    width: W,
    height: H,
    borderRadius: 10,
    backgroundColor: color.slate2,
    borderWidth: 1,
    borderColor: color.hair,
    overflow: 'hidden',
  },
});
