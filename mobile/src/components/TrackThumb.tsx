import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { accent, motion, radius, surface } from '../theme/tokens';

export type Segments = [number, number][][]; // [lng, lat] per point, per segment

const W = 100;
const H = 64;
const PAD = 8;

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

/** Rides whose trace has drawn this session — draw-on is once per card, so a
 *  scroll back doesn't replay it. Cleared on app launch, so it greets you
 *  fresh each time you open the feed. */
const drawnThisSession = new Set<string>();

// Three stacked strokes fake a glow: wide+faint under crisp+bright.
const GLOW = [
  { width: 4, opacity: 0.16 },
  { width: 2.6, opacity: 0.34 },
  { width: 1.5, opacity: 1 },
];

/**
 * A ride's shape at list size — the signature element, everywhere a ride
 * appears. SVG, not a live map: forty of these scroll in a feed.
 *
 * The trace glows and draws itself start→finish on first view, then holds.
 * Built static-FIRST this time (the lesson from the last build): the moment
 * the animation ends — or a fallback timer fires, whichever comes first — it
 * snaps to the fully-drawn static trace. So even if stroke animation ever
 * fails on a device, the thumbnail can never be left blank.
 *
 * Segments stay separate exactly as everywhere else — the pen jumps a gap
 * invisibly, never a line across a place the rider didn't ride (§5). Missing
 * geometry (a manual ride, one mid-sync, or one wholly inside a privacy zone)
 * gets a ghosted dashed placeholder, never a blank box.
 */
export function TrackThumb({ id, segments }: { id?: string; segments: Segments }) {
  const pts = segments.flat();
  const hasGeom = pts.length >= 2;
  const t = useRef(new Animated.Value(0)).current;
  // done → render the guaranteed-visible static trace. Starts true if this
  // ride already drew this session.
  const [done, setDone] = useState(() => (id ? drawnThisSession.has(id) : true));

  useEffect(() => {
    if (!hasGeom || done) return;
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      if (id) drawnThisSession.add(id);
      setDone(true);
    };
    let anim: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) return finish(); // no draw-on under reduced motion (§0.4)
      anim = Animated.timing(t, { toValue: 1, duration: motion.traceMs, useNativeDriver: false });
      anim.start(({ finished }) => finished && finish());
    });
    // Belt-and-braces: whatever the animation does, snap to visible.
    const fallback = setTimeout(finish, motion.traceMs + 400);
    return () => {
      cancelled = true;
      clearTimeout(fallback);
      anim?.stop();
    };
  }, [hasGeom, done, id, t]);

  if (!hasGeom) {
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

  // Per-segment projected points + pixel length, and the total, so the sweep
  // sequences across segments (jumping gaps) rather than all at once.
  const projected = segments
    .filter((seg) => seg.length >= 2)
    .map((seg) => {
      const p = seg.map(project);
      let len = 0;
      for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      return { p, len };
    });
  const total = projected.reduce((a, seg) => a + seg.len, 0) || 1;

  const first = projected[0]?.p[0];
  const lastSeg = projected[projected.length - 1]?.p;
  const last = lastSeg?.[lastSeg.length - 1];

  let cum = 0;
  return (
    <View style={st.box}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {projected.map((seg, i) => {
          const start = cum;
          cum += seg.len;
          const points = seg.p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
          if (done) {
            // Static, fully drawn — the guaranteed-visible state.
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
          }
          const strokeDashoffset = t.interpolate({
            inputRange: [start / total, (start + seg.len) / total],
            outputRange: [seg.len, 0],
            extrapolate: 'clamp',
          });
          return GLOW.map((g, j) => (
            <AnimatedPolyline
              key={`${i}-${j}`}
              points={points}
              fill="none"
              stroke={accent.trace}
              strokeWidth={g.width}
              opacity={g.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${seg.len} ${seg.len}`}
              strokeDashoffset={strokeDashoffset}
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
