import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { color, font } from '../theme/tokens';

/**
 * Google requires visible attribution wherever their data is shown outside a
 * Google Map — which is everywhere in TRACE, since the basemap is MapLibre
 * over OpenFreeMap tiles. Place search results and planned route lines are
 * both Google-derived, so both carry this.
 *
 * NOTE BEFORE LAUNCH: Google supplies an official "Powered by Google" logo
 * asset and asks that it be used rather than set text. This renders the
 * wordmark as text so the requirement is met and visible now; drop their PNG
 * in here (light-on-dark variant) and this becomes compliant to the letter.
 * Reproducing their multicoloured logo by hand would be worse than text.
 */
export function GoogleAttribution({
  style,
  align = 'right',
}: {
  style?: ViewStyle;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <View
      style={[
        st.wrap,
        { alignItems: align === 'left' ? 'flex-start' : align === 'center' ? 'center' : 'flex-end' },
        style,
      ]}
    >
      <Text style={st.text} allowFontScaling={false}>
        Powered by Google
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingVertical: 6 },
  text: {
    fontFamily: font.body,
    fontSize: 10.5,
    color: color.dim,
    letterSpacing: 0.2,
  },
});
