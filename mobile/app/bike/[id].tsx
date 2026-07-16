import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BikeForm } from '../../src/components/BikeForm';
import { PushButton } from '../../src/components/PushButton';
import { MonoLabel } from '../../src/components/ui';
import { Bike, BikeInput, getBike, listRidesForBike, Ride, updateBike } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

const fmtKm = (n: number) => Math.round(n).toLocaleString('en-IN');

export default function BikeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [bike, setBike] = useState<Bike | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    getBike(id).then(setBike).catch(() => {});
    listRidesForBike(id).then(setRides).catch(() => {});
  }, [id]);

  if (!bike) return <View style={st.root} />;

  const save = async (input: BikeInput) => {
    setBusy(true);
    try {
      await updateBike(bike.id, input);
      router.back();
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
      setBusy(false);
    }
  };

  const toggleRetired = async () => {
    try {
      const updated = await updateBike(bike.id, { is_active: !bike.is_active });
      setBike(updated);
    } catch (e) {
      Alert.alert('Could not update', (e as Error).message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled">
        <MonoLabel size={9.5}>{bike.is_active ? 'In the garage' : 'Retired'}</MonoLabel>
        <Text style={st.h1}>
          {bike.make} {bike.model}
        </Text>
        <Text style={st.odo} allowFontScaling={false}>
          {fmtKm(Number(bike.current_odometer_km))}
          <Text style={st.odoUnit}> km</Text>
        </Text>

        <BikeForm
          initial={{
            make: bike.make,
            model: bike.model,
            year: bike.year,
            mods: bike.mods,
            current_odometer_km: Number(bike.current_odometer_km),
            type: bike.type,
          }}
          submitLabel="Save changes"
          onSubmit={save}
          busy={busy}
          style={{ marginTop: 28 }}
        />

        <PushButton
          label={bike.is_active ? 'Retire this bike' : 'Back into the garage'}
          variant="slate"
          onPress={toggleRetired}
          style={{ marginTop: 16 }}
        />

        <MonoLabel size={9} style={{ marginTop: 36, marginBottom: 10 }}>
          Rides on this bike
        </MonoLabel>
        {rides.length === 0 ? (
          <Text style={st.empty}>Rides you record on this bike land here.</Text>
        ) : (
          rides.map((r) => (
            <View key={r.id} style={st.rideRow}>
              <Text style={st.rideTitle}>{r.title ?? 'Untitled ride'}</Text>
              <Text style={st.rideStats} allowFontScaling={false}>
                {Number(r.distance_km).toFixed(1)} km ·{' '}
                {new Date(r.started_at).toLocaleDateString()}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  scroll: { paddingHorizontal: layout.screenPadding, paddingTop: 72, paddingBottom: 48 },
  h1: {
    fontFamily: font.display,
    fontSize: 34,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 36,
  },
  odo: {
    fontFamily: font.display,
    fontSize: 27,
    color: color.white,
    fontVariant: ['tabular-nums'],
    marginTop: 10,
  },
  odoUnit: { fontSize: 13, color: color.steel },
  empty: { fontFamily: font.body, color: color.steel, fontSize: 13 },
  rideRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: color.hair,
  },
  rideTitle: { fontFamily: font.bodySemi, color: color.white, fontSize: 13 },
  rideStats: {
    fontFamily: font.mono,
    color: color.steel,
    fontSize: 10,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
});
