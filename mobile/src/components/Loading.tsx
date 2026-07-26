import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { accent, text as textToken } from '../theme/tokens';

// A little mountain-road wiggle. Fixed points drive every size.
const W = 46;
const H = 22;
const POINTS = '3,15 11,7 18,16 26,6 33,15 43,8';

/**
 * The loading language: the trace motif, breathing. One motif everywhere
 * (feeds, routes, maps) reads as coherence where a spinner reads as a stall.
 *
 * The squiggle is always drawn; only its brightness pulses. (An earlier
 * version animated an SVG dash offset to "draw" the line, but if that failed
 * on a device the loader showed nothing — a loader must never be invisible.)
 */
export function TraceLoader({ size = 1 }: { size?: number }) {
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 620, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const glow = [
    { w: 4, o: 0.16 },
    { w: 2.6, o: 0.34 },
    { w: 1.6, o: 1 },
  ];

  return (
    <Animated.View style={{ opacity: pulse }}>
      <Svg width={W * size} height={H * size} viewBox={`0 0 ${W} ${H}`}>
        {glow.map((g, i) => (
          <Polyline
            key={i}
            points={POINTS}
            fill="none"
            stroke={accent.trace}
            strokeWidth={g.w}
            opacity={g.o}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </Animated.View>
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
