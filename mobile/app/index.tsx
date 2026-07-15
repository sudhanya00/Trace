import { StyleSheet, Text, View } from 'react-native';

import { color, font, layout, monoLabel } from '../src/theme/tokens';

/**
 * Boot placeholder — replaced by the auth gate (§9) in the next build step.
 * Exists so the shell runs end-to-end: fonts, tokens, router, splash.
 */
export default function Index() {
  return (
    <View style={st.root}>
      <Text style={st.eyebrow}>RIDE. TRACE. BELONG.</Text>
      <Text style={st.word}>TRACE</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.void,
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    padding: layout.screenPadding,
    paddingBottom: 64,
  },
  eyebrow: { ...monoLabel, marginBottom: 8 },
  word: {
    fontFamily: font.display,
    fontSize: 64,
    color: color.white,
    letterSpacing: 2,
    lineHeight: 64,
  },
});
