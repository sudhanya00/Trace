import { ReactNode, useState } from 'react';
import {
  KeyboardTypeOptions,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { color, font, layout } from '../theme/tokens';

/** Mono label: always uppercase, letter-spaced, steel (§8 typography). */
export function MonoLabel({
  children,
  size = 9,
  style,
}: {
  children: ReactNode;
  size?: number;
  style?: TextStyle;
}) {
  return (
    <Text
      style={[
        {
          fontFamily: font.mono,
          color: color.steel,
          fontSize: size,
          letterSpacing: size * 0.18,
          textTransform: 'uppercase',
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Card: slate fill, hairline border, 14px radius. Active = 2px signal left edge, never a glow. */
export function Card({
  children,
  active = false,
  style,
}: {
  children: ReactNode;
  active?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View style={[st.card, style]}>
      {active && <View style={st.activeEdge} />}
      {children}
    </View>
  );
}

/** Labelled input with a visible focus state (§8 quality floor). */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  autoCapitalize = 'none',
  style,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  style?: ViewStyle;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={style}>
      <MonoLabel style={{ marginBottom: 7 }}>{label}</MonoLabel>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.dim}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[st.input, focused && st.inputFocused]}
      />
    </View>
  );
}

/** Data strip cell: hairline-ruled value cells — rules, not boxes (§8 layout). */
export function DataCell({
  label,
  value,
  unit,
  first = false,
}: {
  label: string;
  value: string;
  unit?: string;
  first?: boolean;
}) {
  return (
    <View style={[st.cell, !first && st.cellDivider]}>
      <MonoLabel size={8.5}>{label}</MonoLabel>
      <Text style={st.cellValue} allowFontScaling={false}>
        {value}
        {unit ? <Text style={st.cellUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  card: {
    backgroundColor: color.slate,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: layout.cardRadius,
    padding: 18,
    overflow: 'hidden',
  },
  activeEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: color.signal,
  },
  input: {
    backgroundColor: color.slate2,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: color.white,
    fontFamily: font.body,
    fontSize: 15,
  },
  inputFocused: {
    borderColor: color.steel,
  },
  cell: { flex: 1, paddingVertical: 13 },
  cellDivider: { borderLeftWidth: 1, borderLeftColor: color.hair, paddingLeft: 16 },
  cellValue: {
    fontFamily: font.displaySemi,
    fontSize: 25,
    color: color.white,
    fontVariant: ['tabular-nums'],
    marginTop: 5,
    lineHeight: 26,
  },
  cellUnit: { fontSize: 12, color: color.steel, fontFamily: font.displayMedium },
});
