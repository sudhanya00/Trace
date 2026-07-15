import { useState } from 'react';
import { View, ViewStyle } from 'react-native';

import { BikeInput } from '../lib/db';
import { PushButton } from './PushButton';
import { Field } from './ui';

/**
 * Shared bike form — onboarding, add, and edit all use the same fields.
 * Odometer here is the baseline: the number on the bike's clocks right now.
 * Every logged ride adds on top of it server-side.
 */
export function BikeForm({
  initial,
  submitLabel,
  onSubmit,
  busy,
  style,
}: {
  initial?: Partial<BikeInput>;
  submitLabel: string;
  onSubmit: (input: BikeInput) => void;
  busy: boolean;
  style?: ViewStyle;
}) {
  const [make, setMake] = useState(initial?.make ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [year, setYear] = useState(initial?.year ? String(initial.year) : '');
  const [odo, setOdo] = useState(
    initial?.current_odometer_km != null ? String(initial.current_odometer_km) : ''
  );
  const [mods, setMods] = useState(initial?.mods ?? '');

  const yearNum = year.trim() ? Number(year.trim()) : null;
  const odoNum = odo.trim() ? Number(odo.trim().replace(',', '.')) : 0;
  const valid =
    make.trim().length > 0 &&
    model.trim().length > 0 &&
    (yearNum === null || (Number.isInteger(yearNum) && yearNum > 1900 && yearNum < 2100)) &&
    Number.isFinite(odoNum) &&
    odoNum >= 0;

  return (
    <View style={style}>
      <Field label="Make" value={make} onChangeText={setMake} placeholder="Royal Enfield" autoCapitalize="words" />
      <Field label="Model" value={model} onChangeText={setModel} placeholder="Himalayan 450" autoCapitalize="words" style={{ marginTop: 18 }} />
      <View style={{ flexDirection: 'row', gap: 14, marginTop: 18 }}>
        <Field label="Year" value={year} onChangeText={setYear} placeholder="2024" keyboardType="number-pad" style={{ flex: 1 }} />
        <Field label="Odometer (km)" value={odo} onChangeText={setOdo} placeholder="18442" keyboardType="numeric" style={{ flex: 2 }} />
      </View>
      <Field label="Mods" value={mods} onChangeText={setMods} placeholder="Rally footpegs, aux lights" autoCapitalize="sentences" style={{ marginTop: 18 }} />

      <PushButton
        label={submitLabel}
        onPress={() =>
          onSubmit({
            make: make.trim(),
            model: model.trim(),
            year: yearNum,
            mods: mods.trim() || null,
            current_odometer_km: odoNum,
          })
        }
        disabled={busy || !valid}
        style={{ marginTop: 30 }}
      />
    </View>
  );
}
