import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { accent, radius, surface } from '../theme/tokens';

export type Segments = [number, number][][]; // [lng, lat] per point, per segment

const W = 100;
const H = 64;
const PAD = 8;

/**
 * A ride's shape at list size — the signature element, everywhere a ride
 * appears. SVG, not a live map: forty of these scroll in a feed.
 *
 * Rendered statically and always visible: the trace glows (layered strokes,
 * since RN SVG blur filters are unreliable) with a start ring and an end dot.
 * The earlier stroke-draw-on animation was removed — it depended on animating
 * an SVG dash offset, which if it failed on a device left the whole thumbnail
 * blank. A visible trace beats a clever one.
 *
 * Segments stay separate exactly as everywhere else — a gap is drawn as
 * nothing at all, never a line across a place the rider didn't ride (§5).
 * Missing geometry (a manual ride, one mid-sync, or one wholly inside a
 * privacy zone) gets a ghosted dashed placeholder, never a blank box.
 */
export function TrackThumb({ segments }: { id?: string; segments: Segments }) {
  const pts = segments.flat();

  if (pts.length < 2) {
    return (
      <View style={st.box}>
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <Line
            x1={PAD}
            y1={H * 0.62}
            x2={W - PAD}
            y2={H * 0.38}
            stroke={accent.traceDim}
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeDasharray="1 6"
            opacity={0.7}
          />
        </Svg>
      </View>
    );
  }

  // Fit the whole track into the viewport at one scale so it keeps its real
  // proportions — a squashed ride reads as a different road.
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of pts) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  const spanX = Math.max(e - w, 1e-6);
  const spanY = Math.max(n - s, 1e-6);
  const k = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
  const offX = (W - spanX * k) / 2;
  const offY = (H - spanY * k) / 2;
  const project = ([lng, lat]: [number, number]): [number, number] => [
    offX + (lng - w) * k,
    H - (offY + (lat - s) * k), // SVG y grows downward
  ];

  const drawn = segments.filter((seg) => seg.length >= 2).map((seg) => seg.map(project));
  const first = drawn[0]?.[0];
  const lastSeg = drawn[drawn.length - 1];
  const last = lastSeg?.[lastSeg.length - 1];

  // Three stacked strokes fake a glow: wide+faint under crisp+bright.
  const GLOW = [
    { width: 4, opacity: 0.16 },
    { width: 2.6, opacity: 0.34 },
    { width: 1.5, opacity: 1 },
  ];

  return (
    <View style={st.box}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {drawn.map((seg, i) => {
          const points = seg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
          return GLOW.map((g, j) => (
            <Polyline
              key={`${i}-${j}`}
              points={points}
              fill="none"
              stroke={accent.trace}
              strokeWidth={g.width}
              opacity={g.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ));
        })}
        {first && (
          <Circle cx={first[0]} cy={first[1]} r={2.4} fill={surface.base} stroke={accent.trace} strokeWidth={1.4} />
        )}
        {last && <Circle cx={last[0]} cy={last[1]} r={2.6} fill={accent.trace} />}
      </Svg>
    </View>
  );
}

const st = StyleSheet.create({
  box: {
    width: W,
    height: H,
    borderRadius: radius.thumb,
    backgroundColor: surface.raised,
    borderWidth: 1,
    borderColor: surface.stroke,
    overflow: 'hidden',
  },
});
