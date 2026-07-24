import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { accent, color, font, motion, radius, status, surface, text } from '../theme/tokens';

type Variant = 'primary' | 'secondary' | 'destructive' | 'signal' | 'slate';

/**
 * The button. Overhaul §2.2: no outer glow (a glow on black is a tell), a
 * press that scales to 0.98 and darkens over motion.quick, and a disabled
 * state that reads as disabled — surface fill, muted label — never a dimmed
 * yellow that looks like a broken enabled button.
 *
 * 'signal'/'slate' are kept as aliases for 'primary'/'secondary' so the dozen
 * existing call sites didn't all have to change at once.
 */
export function PushButton({
  label,
  onPress,
  variant = 'primary',
  height = 56,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  height?: number;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const press = useRef(new Animated.Value(0)).current;

  const move = (down: boolean) =>
    Animated.timing(press, {
      toValue: down ? 1 : 0,
      duration: motion.quickMs,
      useNativeDriver: true,
    }).start();

  const kind: Exclude<Variant, 'signal' | 'slate'> =
    variant === 'signal' ? 'primary' : variant === 'slate' ? 'secondary' : variant;

  const face =
    kind === 'primary'
      ? { backgroundColor: accent.action }
      : kind === 'destructive'
        ? { backgroundColor: surface.raised, borderWidth: 1, borderColor: surface.stroke }
        : { backgroundColor: surface.overlay, borderWidth: 1, borderColor: surface.stroke };

  const labelColor = disabled
    ? text.disabled
    : kind === 'primary'
      ? '#141200' // black on yellow
      : kind === 'destructive'
        ? status.danger
        : text.primary;

  const disabledFace = disabled ? { backgroundColor: surface.raised, borderWidth: 0 } : null;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => move(true)}
      onPressOut={() => move(false)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={style}
    >
      <Animated.View
        style={[
          st.face,
          face,
          disabledFace,
          {
            height,
            transform: [
              { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.98] }) },
            ],
          },
        ]}
      >
        {/* A darkening scrim on press, in place of the old plinth travel. */}
        <Animated.View
          pointerEvents="none"
          style={[
            st.scrim,
            { opacity: press.interpolate({ inputRange: [0, 1], outputRange: [0, 0.12] }) },
          ]}
        />
        <Text style={[st.label, { color: labelColor, fontSize: Math.max(15, Math.round(height * 0.28)) }]}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  face: {
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    overflow: 'hidden',
  },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color.void },
  label: {
    fontFamily: font.display,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
});
