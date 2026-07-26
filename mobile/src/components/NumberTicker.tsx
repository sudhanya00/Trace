import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, TextStyle } from 'react-native';

import { motion } from '../theme/tokens';

/**
 * The one stat count-up, shared everywhere numbers land on screen (§4):
 * profile stats, the trace km, anywhere a figure arrives. Counts from zero to
 * the value once, on the first view, then holds. Tabular figures are the
 * caller's job via `style` (every number in the app is type.numeric).
 *
 * Reduced-motion renders the final value with no roll (§0.4).
 */
export function NumberTicker({
  value,
  format = (n) => String(Math.round(n)),
  style,
  durationMs = motion.standardMs * 2,
}: {
  value: number;
  format?: (n: number) => string;
  style?: TextStyle | TextStyle[];
  durationMs?: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(() => format(0));
  const reduceRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceRef.current = on));
  }, []);

  useEffect(() => {
    if (reduceRef.current || value === 0) {
      setDisplay(format(value));
      return;
    }
    anim.setValue(0);
    const id = anim.addListener(({ value: t }) => setDisplay(format(t * value)));
    const run = Animated.timing(anim, {
      toValue: 1,
      duration: durationMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    run.start(() => setDisplay(format(value)));
    return () => {
      anim.removeListener(id);
      run.stop();
    };
    // Re-run when the target value changes (stats arrive after the first paint).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <Animated.Text allowFontScaling={false} style={style}>
      {display}
    </Animated.Text>
  );
}
