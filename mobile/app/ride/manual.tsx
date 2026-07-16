import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { Bike, createManualRide, listBikes } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

/**
 * §12b fallback: if recording fails, the rider still keeps the odometer
 * honest. Distance + date + bike, no track — and the garage stays useful
 * regardless of GPS quality.
 */
export default function ManualRide() {
  const { session } = useAuth();
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [bikeId, setBikeId] = useState<string | null>(null);
  const [distance, setDistance] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listBikes()
      .then((b) => {
        const active = b.filter((x) => x.is_active);
        setBikes(active);
        setBikeId((cur) => cur ?? (active.length ? active[active.length - 1].id : null));
      })
      .catch(() => {});
  }, []);

  const km = Number(distance.trim().replace(',', '.'));
  const parsedDate = new Date(`${date}T12:00:00`);
  const valid =
    Number.isFinite(km) && km > 0 && km < 2000 && !Number.isNaN(+parsedDate) && parsedDate <= new Date();

  const submit = async () => {
    if (!session || !valid) return;
    setBusy(true);
    try {
      await createManualRide(session.user.id, {
        bike_id: bikeId,
        date: parsedDate,
        distance_km: Math.round(km * 10) / 10,
        title: title.trim() || null,
      });
      router.back();
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <MonoLabel size={9}>No track — just the kilometres</MonoLabel>
        <Text style={st.h1}>Add a ride by hand</Text>
        <Text style={st.sub}>
          For rides the recorder missed. The distance goes onto the bike's odometer like any other
          ride.
        </Text>

        <View style={{ flexDirection: 'row', gap: 14, marginTop: 26 }}>
          <Field label="Distance (km)" value={distance} onChangeText={setDistance} placeholder="142" keyboardType="numeric" style={{ flex: 1 }} />
          <Field label="Date" value={date} onChangeText={setDate} placeholder="2026-07-16" style={{ flex: 1 }} />
        </View>
        <Field label="Title" value={title} onChangeText={setTitle} placeholder="Srinagar loop" autoCapitalize="sentences" style={{ marginTop: 16 }} />

        {bikes.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <MonoLabel size={8.5} style={{ marginBottom: 8 }}>
              Bike
            </MonoLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {bikes.map((b) => (
                <Pressable
                  key={b.id}
                  onPress={() => setBikeId(b.id)}
                  style={[st.chip, b.id === bikeId && st.chipOn]}
                >
                  <Text style={[st.chipText, b.id === bikeId && { color: color.signal }]}>
                    {b.make.toUpperCase()} {b.model.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <PushButton label="Save ride" onPress={submit} disabled={busy || !valid} style={{ marginTop: 28 }} />

        <Pressable onPress={() => router.back()} style={st.back}>
          <Text style={st.backText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 84, paddingBottom: 60 },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 8,
    lineHeight: 40,
  },
  sub: { fontFamily: font.body, fontSize: 13, color: color.steel, lineHeight: 19, marginTop: 10 },
  chip: {
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipOn: { borderColor: 'rgba(46,125,255,.4)', backgroundColor: 'rgba(46,125,255,.10)' },
  chipText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1, color: color.steel },
  back: { alignSelf: 'center', marginTop: 20, padding: 8 },
  backText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
