import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient as SvgLinearGradient,
  Path,
  Polyline,
  Stop,
} from 'react-native-svg';

import { color } from '../theme/tokens';

/**
 * The record screen's map bed, straight from the reference: terrain contours
 * behind, the ridden track over them, gaps as dashed connectors (§5 says the
 * rider must SEE where data is missing — the dashed line is the spec'd
 * rendering, at reduced opacity so it never reads as ridden distance), and
 * the current position pulsing at the head of the line. A scrim keeps the
 * numbers dominant.
 *
 * This is not decoration standing in for a map — the track IS the rider's
 * real recorded points, projected to the viewport. The contours are the bed
 * texture from the reference and get replaced by real map tiles in Phase 02.
 */

type Pt = { lat: number; lng: number; segment_seq: number };

const W = 390;
const H = 500;

export function TrackBed({ points }: { points: Pt[] }) {
  const segments = project(points);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg
        style={StyleSheet.absoluteFill}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          <SvgLinearGradient id="trk" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFD60A" stopOpacity="0.3" />
            <Stop offset="0.55" stopColor="#FFDE47" stopOpacity="0.8" />
            <Stop offset="1" stopColor="#FFF1A6" stopOpacity="1" />
          </SvgLinearGradient>
        </Defs>

        {/* terrain contours — the bed texture from the reference */}
        <G stroke="#222829" strokeWidth={1} fill="none" opacity={0.9}>
          <Path d="M-20 120 C 70 96, 150 150, 230 118 S 360 66, 420 96" />
          <Path d="M-20 158 C 80 132, 160 188, 240 154 S 366 104, 420 134" />
          <Path d="M-20 200 C 66 176, 158 228, 236 196 S 358 146, 420 176" />
          <Path d="M-20 250 C 88 224, 150 276, 244 244 S 352 196, 420 224" />
          <Path d="M-20 302 C 74 278, 162 326, 238 296 S 360 248, 420 276" />
          <Path d="M-20 352 C 84 330, 154 376, 246 348 S 350 300, 420 328" />
          <Path d="M-20 404 C 70 382, 160 426, 236 400 S 358 352, 420 380" />
        </G>
        <Path
          d="M-20 258 L 58 196 L 118 236 L 186 150 L 250 214 L 318 162 L 410 224"
          stroke="#2C3335"
          strokeWidth={1.2}
          fill="none"
          opacity={0.8}
        />

        {/* the ridden track — real points, one polyline per segment */}
        {segments.map((seg, i) => (
          <Polyline
            key={`s${i}`}
            points={seg.map(([x, y]) => `${x},${y}`).join(' ')}
            stroke="url(#trk)"
            strokeWidth={3.4}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* gaps: dashed, reduced opacity — visible, never counted */}
        {segments.slice(1).map((seg, i) => {
          const prev = segments[i];
          const [x1, y1] = prev[prev.length - 1];
          const [x2, y2] = seg[0];
          return (
            <Line
              key={`g${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color.signal}
              strokeWidth={2.2}
              strokeDasharray="3 7"
              strokeLinecap="round"
              opacity={0.55}
            />
          );
        })}

        {/* current position at the head of the line */}
        {segments.length > 0 &&
          (() => {
            const last = segments[segments.length - 1];
            const [x, y] = last[last.length - 1];
            return (
              <>
                <Circle cx={x} cy={y} r={14} fill={color.signal} opacity={0.14} />
                <Circle cx={x} cy={y} r={5.5} fill={color.signal} stroke={color.void} strokeWidth={2} />
              </>
            );
          })()}
      </Svg>

      {/* scrim — the numbers stay dominant (reference gradient stops) */}
      <LinearGradient
        style={StyleSheet.absoluteFill}
        colors={[
          'rgba(0,0,0,0.55)',
          'rgba(0,0,0,0.10)',
          'rgba(0,0,0,0.10)',
          'rgba(0,0,0,0.92)',
          color.void,
        ]}
        locations={[0, 0.26, 0.44, 0.74, 0.86]}
      />
    </View>
  );
}

/** Project [lng,lat] segments into an arbitrary box — shared with ShareCard. */
export function projectSegmentsToBox(
  segments: [number, number][][],
  boxW: number,
  boxH: number,
  pad = 0.16
): [number, number][][] {
  const pts: Pt[] = segments.flatMap((seg, i) =>
    seg.map(([lng, lat]) => ({ lng, lat, segment_seq: i }))
  );
  return projectInto(pts, boxW, boxH, pad);
}

/** Project lat/lng points into the bed viewport, preserving aspect. */
function project(points: Pt[]): [number, number][][] {
  return projectInto(points, W, H, 0.16);
}

function projectInto(points: Pt[], boxW: number, boxH: number, pad: number): [number, number][][] {
  if (points.length < 2) return [];

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  // Longitude degrees shrink with latitude; correct so the shape isn't squashed.
  const latMid = (minLat + maxLat) / 2;
  const lngScale = Math.cos((latMid * Math.PI) / 180);

  const spanX = Math.max((maxLng - minLng) * lngScale, 1e-5);
  const spanY = Math.max(maxLat - minLat, 1e-5);
  const scale = Math.min((boxW * (1 - 2 * pad)) / spanX, (boxH * (1 - 2 * pad)) / spanY);
  const offX = (boxW - spanX * scale) / 2;
  const offY = (boxH - spanY * scale) / 2;

  const segs: [number, number][][] = [];
  let cur: [number, number][] = [];
  let curSeg = points[0].segment_seq;
  for (const p of points) {
    const x = offX + (p.lng - minLng) * lngScale * scale;
    const y = boxH - (offY + (p.lat - minLat) * scale); // north is up
    if (p.segment_seq !== curSeg) {
      if (cur.length >= 2) segs.push(cur);
      cur = [];
      curSeg = p.segment_seq;
    }
    cur.push([x, y]);
  }
  if (cur.length >= 2) segs.push(cur);
  return segs;
}
