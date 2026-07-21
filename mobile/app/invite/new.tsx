import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { ChipSelect, Field, MonoLabel, YesNo } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import {
  BikeType,
  createInvite,
  Crew,
  Difficulty,
  DIFFICULTY,
  Experience,
  listCrews,
  myCrewIds,
} from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

const BIKE_CHOICES: (BikeType | 'any')[] = [
  'any',
  'naked',
  'sport',
  'adv',
  'cruiser',
  'scrambler',
  'tourer',
];
const EXP_CHOICES: (Experience | 'any')[] = ['any', 'beginner', 'intermediate', 'advanced'];

/** Plan a ride: when, where, and who it suits — the last of which is what
 *  stops a first-week rider turning up to a 300km mountain run (item 7). */
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
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [bike, setBike] = useState<BikeType | 'any' | null>(null);
  const [gear, setGear] = useState<boolean | null>(null);
  const [exp, setExp] = useState<Experience | 'any' | null>(null);
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
        difficulty,
        bike_category: bike,
        gear_required: gear,
        min_experience: exp,
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

        <Field
          label="Ride"
          value={title}
          onChangeText={setTitle}
          placeholder="Dawn run to Sonamarg"
          autoCapitalize="sentences"
          style={{ marginTop: 24 }}
        />
        <View style={{ flexDirection: 'row', gap: 14, marginTop: 16 }}>
          <Field label="Date" value={date} onChangeText={setDate} placeholder="2026-07-20" style={{ flex: 1 }} />
          <Field label="Time" value={time} onChangeText={setTime} placeholder="06:00" style={{ flex: 1 }} />
        </View>
        <Field
          label="Meetup"
          value={meetup}
          onChangeText={setMeetup}
          placeholder="Nishat gate, kickstands up at six"
          autoCapitalize="sentences"
          style={{ marginTop: 16 }}
        />

        <ChipSelect
          label="Posts to"
          options={['board', ...myCrews.map((c) => c.id)]}
          value={scope ?? 'board'}
          onChange={(v) => setScope(v === 'board' ? null : v)}
          labelOf={(v) => (v === 'board' ? 'Public board' : myCrews.find((c) => c.id === v)?.name ?? '')}
          style={{ marginTop: 20 }}
        />
        {scope === null && (
          <Field
            label="Region"
            value={region}
            onChangeText={setRegion}
            placeholder="Kashmir"
            autoCapitalize="words"
            style={{ marginTop: 16 }}
          />
        )}

        {/* A property of the road, so it's stated, never asked back. */}
        <ChipSelect
          label="How hard is the route?"
          options={DIFFICULTY}
          value={difficulty}
          onChange={setDifficulty}
          clearable
          style={{ marginTop: 28 }}
        />

        <View style={st.divider} />
        <MonoLabel size={9}>Who it suits</MonoLabel>
        <Text style={st.note}>
          Optional. Whatever you set here gets asked of everyone who joins — leave it blank and
          they're asked nothing.
        </Text>

        <ChipSelect
          label="Bike"
          options={BIKE_CHOICES}
          value={bike}
          onChange={setBike}
          clearable
          style={{ marginTop: 20 }}
        />
        <YesNo label="Full gear required" value={gear} onChange={setGear} clearable style={{ marginTop: 20 }} />
        <ChipSelect
          label="Riding experience"
          options={EXP_CHOICES}
          value={exp}
          onChange={setExp}
          clearable
          style={{ marginTop: 20 }}
        />

        <PushButton label="Post the ride" onPress={submit} disabled={busy || !valid} style={{ marginTop: 30 }} />
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
  divider: { height: 1, backgroundColor: color.hair, marginTop: 30, marginBottom: 22 },
  note: { fontFamily: font.body, fontSize: 12, color: color.dim, lineHeight: 18, marginTop: 8 },
  cancel: { alignSelf: 'center', marginTop: 16, padding: 8 },
  cancelText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
