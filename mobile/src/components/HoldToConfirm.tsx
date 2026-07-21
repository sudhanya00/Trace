import { useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, font } from '../theme/tokens';

/**
 * Hold, don't tap. For the one action in the app that destroys data a rider
 * cannot get back — an in-progress ride.
 *
 * A tap target here would be a disaster in a tank-bag pocket at 80 km/h, so
 * the bar has to fill before anything happens, and a confirm still follows.
 * Releasing early rewinds it, which also makes the gesture teach itself.
 */
export function HoldToConfirm({
  label,
  holdingLabel,
  onConfirm,
  durationMs = 1400,
}: {
  label: string;
  holdingLabel: string;
  onConfirm: () => void;
  durationMs?: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);

  const start = () => {
    setHolding(true);
    Animated.timing(progress, {
      toValue: 1,
      duration: durationMs,
      easing: Easing.linear,
      useNativeDriver: false, // width interpolation
    }).start(({ finished }) => {
      if (!finished) return;
      setHolding(false);
      progress.setValue(0);
      onConfirm();
    });
  };

  const cancel = () => {
    setHolding(false);
    Animated.timing(progress, {
      toValue: 0,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  };

  return (
    <Pressable onPressIn={start} onPressOut={cancel} style={st.wrap}>
      <Animated.View
        style={[
          st.fill,
          { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
        ]}
      />
      <Text style={[st.label, holding && { color: color.amber }]}>
        {holding ? holdingLabel : label}
      </Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  wrap: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,138,76,0.18)',
  },
  label: {
    fontFamily: font.mono,
    fontSize: 9.5,
    letterSpacing: 1.8,
    color: color.steel,
    textTransform: 'uppercase',
  },
});
