import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { BikeType } from '../lib/db';
import { color } from '../theme/tokens';

/**
 * The rider's puck on the trace map: a geometric side-profile silhouette that
 * follows the active bike's type — a Duke wears the naked profile, an Xpulse
 * the adv beak. Deliberately abstract single-weight strokes, instrument-style,
 * not clip-art.
 */

// 36×22 viewBox. Wheels shared; the body line is what changes.
const BODIES: Record<BikeType, string> = {
  // compact, flat tank, upright bars
  naked: 'M7 15 L13 9 L20 9 L23 12 L27 12 M13 9 L15 15 M20 9 L19 15',
  // low wedge fairing, crouched
  sport: 'M6 14 L16 8 L24 10 L28 13 M16 8 L17 14 M24 10 L22 14',
  // tall beak, long travel, upright
  adv: 'M5 10 L10 8 L14 12 L21 8 L24 8 L27 12 M21 8 L20 14 M10 8 L12 14',
  // long, low, raked out front
  cruiser: 'M6 12 L12 14 L19 14 L25 10 L29 13 M19 14 L21 9 L24 9',
  // flat bench seat, high pipe
  scrambler: 'M7 14 L12 9 L22 9 L26 12 M12 9 L14 15 M22 9 L21 14 M14 12 L24 11',
  // big fairing, top box
  tourer: 'M6 13 L11 7 L15 7 L15 12 L22 12 L22 7 L26 8 L28 12 M15 7 L18 14',
};

export function BikeMarker({ type }: { type: BikeType | null }) {
  return (
    <View style={st.puck}>
      <Svg width={30} height={19} viewBox="0 0 36 22">
        <Circle cx={9} cy={16} r={4.4} stroke={color.white} strokeWidth={1.8} fill="none" />
        <Circle cx={27} cy={16} r={4.4} stroke={color.white} strokeWidth={1.8} fill="none" />
        <Path
          d={BODIES[type ?? 'naked']}
          stroke={color.signal}
          strokeWidth={1.9}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const st = StyleSheet.create({
  puck: {
    width: 44,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.92)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,214,10,.55)',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 14px rgba(255, 214, 10, 0.35)',
  },
});
