import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { createInvite, Crew, listCrews, myCrewIds } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

/** Plan a ride: date, meetup line, and where it posts — a crew or the board. */
export default function NewInvite() {
  const { crewId: presetCrew } = useLocalSearchParams<{ crewId?: string }>();
  const { session, profile } = useAuth();
  const [myCrews, setMyCrews] = useState<Crew[]>([]);
  const [scope, setScope] = useState<string | null>(presetCrew ?? null); // null = public board
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date(Date.now() + 86400e3).toISOString().slice(0, 10));
  const [time, setTime] = useState('06:00');
  const [meetup, setMeetup] = useState('');
  const [region, setRegion] = useState(profile?.home_region ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    Promise.all([listCrews(), myCrewIds(session.user.id)])
      .then(([all, mine]) => setMyCrews(all.filter((c) => mine.has(c.id))))
      .catch(() => {});
  }, [session]);

  const startsAt = new Date(`${date}T${time}:00`);
  const valid =
    title.trim().length >= 3 && !Number.isNaN(+startsAt) && +startsAt > Date.now() - 3600e3;

  const submit = async () => {
    if (!session || !valid) return;
    setBusy(true);
    try {
      await createInvite(session.user.id, {
        crew_id: scope,
        title: title.trim(),
        meetup: meetup.trim() || null,
        region: scope ? null : region.trim() || null,
        starts_at: startsAt,
      });
      router.back();
    } catch (e) {
      Alert.alert('Could not post', (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <MonoLabel size={9}>Who's in?</MonoLabel>
        <Text style={st.h1}>Plan a ride</Text>

        <Field label="Ride" value={title} onChangeText={setTitle} placeholder="Dawn run to Sonamarg" autoCapitalize="sentences" style={{ marginTop: 24 }} />
        <View style={{ flexDirection: 'row', gap: 14, marginTop: 16 }}>
          <Field label="Date" value={date} onChangeText={setDate} placeholder="2026-07-20" style={{ flex: 1 }} />
          <Field label="Time" value={time} onChangeText={setTime} placeholder="06:00" style={{ flex: 1 }} />
        </View>
        <Field label="Meetup" value={meetup} onChangeText={setMeetup} placeholder="Nishat gate, kickstands up at six" autoCapitalize="sentences" style={{ marginTop: 16 }} />

        <MonoLabel size={8.5} style={{ marginTop: 20, marginBottom: 8 }}>
          Posts to
        </MonoLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable onPress={() => setScope(null)} style={[st.chip, scope === null && st.chipOn]}>
            <Text style={[st.chipText, scope === null && { color: color.signal }]}>PUBLIC BOARD</Text>
          </Pressable>
          {myCrews.map((c) => (
            <Pressable key={c.id} onPress={() => setScope(c.id)} style={[st.chip, scope === c.id && st.chipOn]}>
              <Text style={[st.chipText, scope === c.id && { color: color.signal }]}>
                {c.name.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
        {scope === null && (
          <Field label="Region" value={region} onChangeText={setRegion} placeholder="Kashmir" autoCapitalize="words" style={{ marginTop: 16 }} />
        )}

        <PushButton label="Post the ride" onPress={submit} disabled={busy || !valid} style={{ marginTop: 28 }} />
        <Pressable onPress={() => router.back()} style={st.cancel}>
          <Text style={st.cancelText}>Cancel</Text>
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
  cancel: { alignSelf: 'center', marginTop: 16, padding: 8 },
  cancelText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
