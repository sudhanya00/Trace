import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { color, font, motion } from '../theme/tokens';

/**
 * Button with physical travel (§8 motion #3): the face depresses 5px onto its
 * plinth in 70ms linear. Mechanical, not springy.
 */
export function PushButton({
  label,
  onPress,
  variant = 'signal',
  height = 56,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'signal' | 'slate';
  height?: number;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const travel = useRef(new Animated.Value(0)).current;

  const move = (down: boolean) =>
    Animated.timing(travel, {
      toValue: down ? motion.buttonTravelPx : 0,
      duration: motion.buttonTravelMs,
      useNativeDriver: true,
    }).start();

  const face =
    variant === 'signal'
      ? { backgroundColor: color.signal }
      : { backgroundColor: color.slate2, borderWidth: 1, borderColor: color.hair };
  const plinth = variant === 'signal' ? color.signalDown : '#0A0C0E';
  // The label was near-black for both variants, which is right on a yellow
  // face and invisible on a dark slate one. Slate buttons are secondary
  // actions, so their text is white rather than signal: twelve yellow buttons
  // across the app would leave signal meaning nothing (§8).
  const labelColor = variant === 'signal' ? '#151100' : color.white;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => move(true)}
      onPressOut={() => move(false)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        {
          borderRadius: 16,
          backgroundColor: plinth,
          paddingBottom: motion.buttonTravelPx,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          st.face,
          face,
          variant === 'signal' && st.glow,
          { height, transform: [{ translateY: travel }] },
        ]}
      >
        <Text
          style={[st.label, { color: labelColor, fontSize: Math.max(16, Math.round(height * 0.3)) }]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  face: {
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  label: {
    fontFamily: font.display,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  // The reference's signal-button halo: 0 14px 30px rgba(255,214,10,.32).
  glow: {
    boxShadow: '0 14px 30px rgba(255, 214, 10, 0.32)',
  },
});
