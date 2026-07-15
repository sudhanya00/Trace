import { StyleSheet, Text, View } from 'react-native';

import { MonoLabel } from '../../src/components/ui';
import { color, font, layout } from '../../src/theme/tokens';

export default function Rides() {
  return (
    <View style={st.root}>
      <View style={st.head}>
        <Text style={st.h1}>Rides</Text>
      </View>
      <View style={st.empty}>
        <MonoLabel size={9.5} style={{ marginBottom: 8 }}>No rides yet</MonoLabel>
        <Text style={st.emptyText}>Record your first ride and it lands here.</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  head: { paddingHorizontal: layout.screenPadding, paddingTop: 64 },
  h1: {
    fontFamily: font.display,
    fontSize: 41,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 42,
  },
  empty: { flex: 1, alignItems: 'flex-start', paddingHorizontal: layout.screenPadding, paddingTop: 48 },
  emptyText: { fontFamily: font.body, color: color.steel, fontSize: 13, lineHeight: 19 },
});
