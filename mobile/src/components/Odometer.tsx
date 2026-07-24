import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { color, font, motion } from '../theme/tokens';

/**
 * The mechanical odometer — the one memorable element (§8). Everything else
 * stays quiet so this can be loud.
 *
 * Each digit is a vertical strip of 0–9 translated on the Y axis, exactly like
 * the reference prototype: heavy cubic-bezier(.16,1,.3,1) settle over 580ms,
 * an 85ms left→right stagger on first load, and the decimal point is the only
 * blue in the readout.
 */

const SETTLE = Easing.bezier(0.16, 1, 0.3, 1);

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

function Digit({
  value,
  height,
  width,
  fontSize,
  delayMs,
  reduced,
  staggered = false,
}: {
  value: number;
  height: number;
  width: number;
  fontSize: number;
  delayMs: number;
  reduced: boolean;
  /** Apply the stagger delay on every change, not just the first roll (sweep mode). */
  staggered?: boolean;
}) {
  const y = useRef(new Animated.Value(0)).current;
  const mounted = useRef(false);

  useEffect(() => {
    const target = -value * height;
    if (reduced) {
      y.setValue(target);
      return;
    }
    Animated.timing(y, {
      toValue: target,
      duration: motion.odometerDigitMs,
      // Stagger applies to the load roll only; live ticks move immediately.
      delay: mounted.current && !staggered ? 0 : delayMs,
      easing: SETTLE,
      useNativeDriver: true,
    }).start();
    mounted.current = true;
  }, [value, height, delayMs, reduced, staggered, y]);

  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      <Animated.View style={{ transform: [{ translateY: y }] }}>
        {Array.from({ length: 10 }, (_, i) => (
          <Text
            key={i}
            style={[st.digit, { height, lineHeight: height, fontSize }]}
            allowFontScaling={false}
          >
            {i}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

export function Odometer({
  km,
  intDigits = 3,
  height = 66,
  sweepKey = 0,
}: {
  km: number;
  /** Leading digit count — 84.6 with intDigits 3 reads 084.6, like a stamped odometer. */
  intDigits?: number;
  height?: number;
  /**
   * Bump to run an ignition sweep: every digit rolls up to 9 and settles back,
   * staggered left→right — the cluster needle-sweep, in odometer vernacular.
   * It's how the signature element stays alive on a screen reading 000.0.
   */
  sweepKey?: number;
}) {
  const reduced = useReducedMotion();
  const [sweeping, setSweeping] = useState(false);
  const width = Math.round(height * 0.58);
  const fontSize = Math.round(height * 0.94);

  useEffect(() => {
    if (!sweepKey || reduced) return;
    setSweeping(true);
    const t = setTimeout(() => setSweeping(false), 620);
    return () => clearTimeout(t);
  }, [sweepKey, reduced]);

  const clamped = Math.max(0, km);
  const whole = Math.min(Math.floor(clamped), 10 ** intDigits - 1);
  const tenth = Math.floor((clamped * 10) % 10);
  const intStr = String(whole).padStart(intDigits, '0');

  return (
    <View style={st.row} accessible accessibilityLabel={`${clamped.toFixed(1)} kilometres`}>
      {intStr.split('').map((ch, i) => (
        <Digit
          key={`i${i}`}
          value={sweeping ? 9 : Number(ch)}
          height={height}
          width={width}
          fontSize={fontSize}
          delayMs={i * (sweeping ? 45 : motion.odometerStaggerMs)}
          reduced={reduced}
          staggered={sweeping}
        />
      ))}
      <Text style={[st.dot, { fontSize, lineHeight: height }]} allowFontScaling={false}>
        .
      </Text>
      <Digit
        value={sweeping ? 9 : tenth}
        height={height}
        width={width}
        fontSize={fontSize}
        delayMs={intDigits * (sweeping ? 45 : motion.odometerStaggerMs)}
        reduced={reduced}
        staggered={sweeping}
      />
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  digit: {
    fontFamily: font.display,
    color: color.white,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  dot: {
    fontFamily: font.display,
    color: color.white, // the only blue in the readout
    marginHorizontal: 1,
    includeFontPadding: false,
  },
});
