import { Image, StyleSheet, Text, View } from 'react-native';

import { color, font } from '../theme/tokens';

/**
 * A rider's face, or the initial of their handle when they haven't set one.
 * The fallback is deliberately plain — a lettered disc, not an illustration:
 * generated avatars are the fastest way to make an app look machine-made (§8
 * quality floor).
 */
export function Avatar({
  url,
  handle,
  size = 38,
}: {
  url?: string | null;
  handle?: string | null;
  size?: number;
}) {
  const radius = { width: size, height: size, borderRadius: size / 2 };

  if (url) {
    return <Image source={{ uri: url }} style={[st.base, radius]} />;
  }
  return (
    <View style={[st.base, st.fallback, radius]}>
      <Text style={[st.letter, { fontSize: size * 0.42 }]} allowFontScaling={false}>
        {(handle?.[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  base: {
    backgroundColor: color.slate2,
    borderWidth: 1,
    borderColor: color.glassBorder,
  },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  letter: { fontFamily: font.displaySemi, color: color.steel },
});
