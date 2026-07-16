import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { Card, Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { createCrew, Crew, listCrews, myCrewIds } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

/** Crews: discoverable by anyone, joined in one tap. Density beats spread. */
export default function Crews() {
  const { session } = useAuth();
  const [crews, setCrews] = useState<Crew[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      listCrews().then((c) => alive && setCrews(c)).catch(() => {});
      if (session) myCrewIds(session.user.id).then((m) => alive && setMine(m)).catch(() => {});
      return () => {
        alive = false;
      };
    }, [session])
  );

  const submit = async () => {
    if (!session || name.trim().length < 3) return;
    setBusy(true);
    try {
      const crew = await createCrew(session.user.id, {
        name: name.trim(),
        region: region.trim() || null,
        description: description.trim() || null,
      });
      router.push(`/crew/${crew.id}`);
    } catch (e) {
      Alert.alert('Could not create crew', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={st.root}>
      <View style={st.head}>
        <Text style={st.h1}>Crews</Text>
        <Text style={st.sub}>Local groups beat a global feed. Find yours or start it.</Text>
      </View>

      <FlatList
        data={crews}
        keyExtractor={(c) => c.id}
        contentContainerStyle={st.list}
        ListEmptyComponent={
          <Text style={st.empty}>No crews yet — the first one in your region is yours to start.</Text>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/crew/${item.id}`)}>
            {({ pressed }) => (
              <Card pressed={pressed} active={mine.has(item.id)} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={st.crewName}>{item.name}</Text>
                    <MonoLabel size={8.5} style={{ marginTop: 5, letterSpacing: 1 }}>
                      {[item.region, `${item.member_count} rider${item.member_count === 1 ? '' : 's'}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </MonoLabel>
                  </View>
                  {mine.has(item.id) && <Text style={st.joinedChip}>JOINED</Text>}
                </View>
                {item.description ? <Text style={st.crewDesc}>{item.description}</Text> : null}
              </Card>
            )}
          </Pressable>
        )}
        ListFooterComponent={
          creating ? (
            <View style={{ marginTop: 12 }}>
              <Field label="Crew name" value={name} onChangeText={setName} placeholder="Srinagar Sunday Riders" autoCapitalize="words" />
              <Field label="Region" value={region} onChangeText={setRegion} placeholder="Kashmir" autoCapitalize="words" style={{ marginTop: 14 }} />
              <Field label="One line about the crew" value={description} onChangeText={setDescription} placeholder="Dawn rides, chai at Nishat, back by ten." autoCapitalize="sentences" style={{ marginTop: 14 }} />
              <PushButton label="Start the crew" onPress={submit} disabled={busy || name.trim().length < 3} style={{ marginTop: 18 }} />
              <Pressable onPress={() => setCreating(false)} style={st.cancelRow}>
                <Text style={st.cancelText}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <PushButton label="Start a crew" variant="slate" onPress={() => setCreating(true)} style={{ marginTop: 8 }} />
          )
        }
      />

      <Pressable onPress={() => router.back()} style={st.back}>
        <Text style={st.cancelText}>Back</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  head: { paddingHorizontal: layout.screenPadding, paddingTop: 84 },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 40,
  },
  sub: { fontFamily: font.body, fontSize: 13, color: color.steel, marginTop: 8, lineHeight: 19 },
  list: { padding: layout.screenPadding, paddingTop: 20, paddingBottom: 20 },
  empty: { fontFamily: font.body, fontSize: 12.5, color: color.dim, lineHeight: 18 },
  crewName: {
    fontFamily: font.display,
    fontSize: 21,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 23,
  },
  crewDesc: { fontFamily: font.body, fontSize: 12.5, color: color.steel, lineHeight: 18, marginTop: 10 },
  joinedChip: {
    fontFamily: font.mono,
    fontSize: 8,
    letterSpacing: 1.2,
    color: color.signal,
    borderWidth: 1,
    borderColor: 'rgba(46,125,255,.3)',
    backgroundColor: 'rgba(46,125,255,.14)',
    borderRadius: 3,
    paddingHorizontal: 7,
    paddingVertical: 3.5,
  },
  cancelRow: { alignSelf: 'center', marginTop: 14, padding: 8 },
  cancelText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
  back: { alignSelf: 'center', marginBottom: 28, padding: 8 },
});
