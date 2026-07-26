import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';

import { layout, radius, surface } from '../theme/tokens';

/**
 * A shimmer skeleton (§4): the shape of content, breathing, while it loads —
 * a spinner says "wait", a skeleton says "here's what's coming". Dark base,
 * ~8% white peak, a single shared pulse so a screen of them breathes as one.
 *
 * Reduced-motion isn't special-cased here: the animation is a low-amplitude
 * opacity pulse on native driver, not motion — nothing slides or flies.
 */
export function SkeletonBox({ style }: { style?: ViewStyle }) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 720, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 720, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return <Animated.View style={[st.box, { opacity: pulse }, style]} />;
}

/** The feed's loading state: a few post-shaped rows. */
export function FeedSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View style={{ paddingTop: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={st.post}>
          <SkeletonBox style={st.avatar} />
          <View style={{ flex: 1, gap: 8 }}>
            <SkeletonBox style={{ width: '38%', height: 12, borderRadius: 6 }} />
            <SkeletonBox style={{ width: '92%', height: 12, borderRadius: 6 }} />
            <SkeletonBox style={{ width: '70%', height: 12, borderRadius: 6 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  box: { backgroundColor: surface.overlay, borderRadius: radius.chip },
  post: {
    flexDirection: 'row',
    gap: 11,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: surface.stroke,
  },
  avatar: { width: 36, height: 36, borderRadius: 18 },
});
