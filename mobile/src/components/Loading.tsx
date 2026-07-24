import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { accent, motion, text as textToken } from '../theme/tokens';

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

// A little mountain-road wiggle. Same points drive every size.
const W = 46;
const H = 22;
const POINTS = '3,15 11,7 18,16 26,6 33,15 43,8';
// Approximate polyline length for the dash math — points are fixed, so is this.
const LEN = 62;

/**
 * The loading language: a trace segment drawing and redrawing itself. One
 * motif everywhere (feeds, routes, maps) reads as coherence, where a spinner
 * reads as a stall. The trace is the app's signature, so waiting looks like
 * the thing the app is for.
 */
export function TraceLoader({ size = 1 }: { size?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => alive && setReduce(on));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (reduce) {
      t.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: motion.traceMs, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.delay(220),
        Animated.timing(t, { toValue: 0, duration: 260, easing: Easing.in(Easing.ease), useNativeDriver: false }),
        Animated.delay(120),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, t]);

  const offset = t.interpolate({ inputRange: [0, 1], outputRange: [LEN, 0] });
  const glow = [
    { w: 4, o: 0.16 },
    { w: 2.6, o: 0.34 },
    { w: 1.6, o: 1 },
  ];

  return (
    <Svg width={W * size} height={H * size} viewBox={`0 0 ${W} ${H}`}>
      {glow.map((g, i) => (
        <AnimatedPolyline
          key={i}
          points={POINTS}
          fill="none"
          stroke={accent.trace}
          strokeWidth={g.w}
          opacity={g.o}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={`${LEN} ${LEN}`}
          strokeDashoffset={reduce ? 0 : offset}
        />
      ))}
    </Svg>
  );
}

/** Full-bleed loading state — the trace motif over a label. */
export function Loading({ label }: { label?: string }) {
  return (
    <View style={st.wrap}>
      <TraceLoader size={1.4} />
      {label ? <Text style={st.label}>{label}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: 16, flex: 1 },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 12.5, color: textToken.secondary, letterSpacing: 0.3 },
});
