import { StyleSheet, Text, View } from 'react-native';

import { Odometer } from '../../src/components/Odometer';
import { PushButton } from '../../src/components/PushButton';
import { MonoLabel } from '../../src/components/ui';
import { color, font, layout } from '../../src/theme/tokens';

/**
 * Record — the odometer is the screen. The recording engine (§5) wires in
 * next; until then this is an honest placeholder, not a broken button.
 */
export default function Record() {
  return (
    <View style={st.root}>
      <View style={{ flex: 1 }} />

      <View style={{ paddingHorizontal: layout.screenPadding }}>
        <MonoLabel size={9.5} style={{ marginBottom: 6, letterSpacing: 2.3 }}>
          Distance — this ride
        </MonoLabel>
        <View style={st.odoRow}>
          <Odometer km={0} />
          <Text style={st.unit}>km</Text>
        </View>
      </View>

      <View style={st.note}>
        <Text style={st.noteText}>
          Recording lands in the next build. The garage is open — add your bikes.
        </Text>
      </View>

      <View style={st.ctrl}>
        <PushButton
          label="Start ride"
          onPress={() => {}}
          disabled
          height={layout.recordButtonHeight}
        />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  odoRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  unit: {
    fontFamily: font.displaySemi,
    fontSize: 19,
    color: color.steel,
    textTransform: 'uppercase',
    letterSpacing: 2,
    paddingBottom: 9,
  },
  note: { paddingHorizontal: layout.screenPadding, marginTop: 20 },
  noteText: { fontFamily: font.body, color: color.dim, fontSize: 11, lineHeight: 16 },
  ctrl: { padding: layout.screenPadding, paddingBottom: 34, marginTop: 6 },
});
