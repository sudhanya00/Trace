import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Polyline } from 'react-native-svg';

import { accent, color } from '../theme/tokens';

/** §1.3 ambient topography — warm white at ~5%, the quiet single layer. */
const CONTOUR = 'rgba(245,245,242,0.05)';

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
        {/* §1.3 — one quiet ambient layer, ≤6% white. Decoration must carry
            information or go: the busy reference contours are gone. The true
            last-ride elevation line is deferred until altitude is stored
            durably (it's dropped with local points at sync). */}
        <G stroke={CONTOUR} strokeWidth={1} fill="none">
          <Path d="M-20 210 C 80 186, 160 238, 240 206 S 366 156, 420 186" />
          <Path d="M-20 300 C 74 276, 162 324, 238 294 S 360 246, 420 274" />
        </G>

        {/* the ridden track — real points, one polyline per segment, in the
            trace language: stacked strokes for the glow (§1.1). */}
        {segments.map((seg, i) => {
          const points = seg.map(([x, y]) => `${x},${y}`).join(' ');
          return (
            <G key={`s${i}`}>
              <Polyline points={points} stroke={accent.trace} strokeWidth={7} opacity={0.16} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <Polyline points={points} stroke={accent.trace} strokeWidth={4.4} opacity={0.34} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <Polyline points={points} stroke={accent.trace} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </G>
          );
        })}

        {/* gaps: dashed and muted — visible, never counted, never trace-bright
            (§5). The trace-that-wasn't reads as absence, not distance. */}
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
              stroke={accent.traceDim}
              strokeWidth={2}
              strokeDasharray="3 7"
              strokeLinecap="round"
              opacity={0.7}
            />
          );
        })}

        {/* current position at the head of the line — trace, not action:
            one yellow per screen belongs to the record button. */}
        {segments.length > 0 &&
          (() => {
            const last = segments[segments.length - 1];
            const [x, y] = last[last.length - 1];
            return (
              <>
                <Circle cx={x} cy={y} r={14} fill={accent.trace} opacity={0.14} />
                <Circle cx={x} cy={y} r={5.5} fill={accent.trace} stroke={color.void} strokeWidth={2} />
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
