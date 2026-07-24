import { ReactNode, useState } from 'react';
import {
  KeyboardTypeOptions,
  Pressable,
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

/** Card (§2.3): raised surface, hairline border, no shadow — containment for
 *  content objects. Active = a thin white left edge (never yellow: action is
 *  reserved for the one primary button). Press brightens the border. */
export function Card({
  children,
  active = false,
  pressed = false,
  style,
}: {
  children: ReactNode;
  active?: boolean;
  pressed?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        st.card,
        pressed && { borderColor: color.disabled, transform: [{ scale: 0.988 }] },
        style,
      ]}
    >
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

/**
 * A row of choices. Signal marks the live one — the same rule the whole app
 * runs on, applied to selection. `onChange` receives null when the current
 * choice is tapped again and `clearable` is set, which is how an optional
 * question gets un-asked.
 */
export function ChipSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  clearable = false,
  labelOf,
  style,
}: {
  label?: string;
  options: readonly T[];
  value: T | null;
  onChange: (v: T | null) => void;
  clearable?: boolean;
  labelOf?: (v: T) => string;
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      {label ? <MonoLabel size={8.5} style={{ marginBottom: 8 }}>{label}</MonoLabel> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const on = value === o;
          return (
            <Pressable
              key={o}
              onPress={() => onChange(on && clearable ? null : o)}
              style={[st.chip, on && st.chipOn]}
            >
              <Text style={[st.chipText, on && { color: color.white }]}>
                {(labelOf ? labelOf(o) : o).toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** The Y/N question, as its own control — three states, because "not asked"
 *  is a real answer and null must stay reachable. */
export function YesNo({
  label,
  value,
  onChange,
  clearable = false,
  style,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  clearable?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View style={style}>
      <MonoLabel size={8.5} style={{ marginBottom: 8 }}>{label}</MonoLabel>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {([true, false] as const).map((b) => {
          const on = value === b;
          return (
            <Pressable
              key={String(b)}
              onPress={() => onChange(on && clearable ? null : b)}
              style={[st.chip, on && st.chipOn]}
            >
              <Text style={[st.chipText, on && { color: color.white }]}>{b ? 'YES' : 'NO'}</Text>
            </Pressable>
          );
        })}
      </View>
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
    borderRadius: 16,
    padding: 18,
    overflow: 'hidden',
  },
  activeEdge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: color.white,
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
  // Input chip (§2.1): no yellow. Selection reads as a brighter border and a
  // white label — the border does the work, not the fill.
  chip: {
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipOn: { borderColor: color.disabled, backgroundColor: color.slate2 },
  chipText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1, color: color.steel },
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
