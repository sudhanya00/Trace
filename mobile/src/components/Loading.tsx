import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { color, font } from '../theme/tokens';

/**
 * The branded loader: three signal dots breathing in sequence. Anything that
 * takes longer than a beat (trace tiles, feeds, maps) shows this instead of
 * a blank screen — waiting should feel intentional.
 */
export function Loading({ label }: { label?: string }) {
  const dots = [useRef(new Animated.Value(0.25)).current, useRef(new Animated.Value(0.25)).current, useRef(new Animated.Value(0.25)).current];

  useEffect(() => {
    const loops = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(v, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.25, duration: 420, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.delay((2 - i) * 160),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={st.wrap}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {dots.map((v, i) => (
          <Animated.View key={i} style={[st.dot, { opacity: v }]} />
        ))}
      </View>
      {label ? <Text style={st.label}>{label}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: 14, flex: 1 },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: color.signal,
    boxShadow: '0 0 12px rgba(255, 214, 10, 0.5)',
  },
  label: { fontFamily: font.bodyMedium, fontSize: 12.5, color: color.steel, letterSpacing: 0.3 },
});
