import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../src/components/Avatar';
import { Field, MonoLabel } from '../src/components/ui';
import { useAuth } from '../src/lib/auth';
import { Profile, searchRiders, suggestedRiders, SuggestedRider } from '../src/lib/db';
import { color, font, layout } from '../src/theme/tokens';

/** Find riders. Lived in the Riders tab until 2026-07-21; searching for people
 *  belongs next to people, so it moved behind the profile's search icon. */
export default function Search() {
  const { session } = useAuth();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [suggested, setSuggested] = useState<SuggestedRider[]>([]);

  useEffect(() => {
    suggestedRiders().then(setSuggested).catch(() => {});
  }, []);

  useEffect(() => {
    if (!session || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchRiders(session.user.id, q.trim()).then(setResults).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q, session]);

  const searching = q.trim().length >= 2;

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
      <View style={st.head}>
        <Text style={st.h1}>Find riders</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 8 }}>
          <Text style={st.back}>Done</Text>
        </Pressable>
      </View>

      <Field
        label="Search"
        value={q}
        onChangeText={setQ}
        placeholder="handle or name"
        style={{ marginTop: 18 }}
      />

      {searching ? (
        results.length === 0 ? (
          <Text style={st.empty}>Nobody by that name yet.</Text>
        ) : (
          results.map((p) => (
            <Row
              key={p.id}
              id={p.id}
              handle={p.handle}
              avatar={p.avatar_url}
              sub={[p.display_name, p.home_region].filter(Boolean).join(' · ')}
            />
          ))
        )
      ) : (
        <>
          <MonoLabel size={9} style={{ marginTop: 30, marginBottom: 4 }}>
            Riders you might know
          </MonoLabel>
          {suggested.length === 0 ? (
            <Text style={st.empty}>
              Nothing to suggest yet — add a bike or set your region and riders like you show up
              here.
            </Text>
          ) : (
            suggested.map((s) => (
              <Row key={s.id} id={s.id} handle={s.handle} avatar={null} sub={s.reason} />
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

function Row({
  id,
  handle,
  avatar,
  sub,
}: {
  id: string;
  handle: string;
  avatar: string | null;
  sub: string;
}) {
  return (
    <Pressable onPress={() => router.push(`/rider/${id}`)}>
      {({ pressed }) => (
        <View style={[st.row, pressed && { backgroundColor: color.slate }]}>
          <Avatar url={avatar} handle={handle} size={38} />
          <View style={{ flex: 1 }}>
            <Text style={st.name}>@{handle}</Text>
            {sub ? <Text style={st.sub}>{sub}</Text> : null}
          </View>
          <Feather name="chevron-right" size={16} color={color.dim} />
        </View>
      )}
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 70, paddingBottom: 60 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h1: {
    fontFamily: font.display,
    fontSize: 34,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 36,
  },
  back: { fontFamily: font.bodyMedium, fontSize: 14, color: color.steel },
  empty: { fontFamily: font.body, fontSize: 12.5, color: color.dim, marginTop: 14, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
  },
  name: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  sub: { fontFamily: font.body, fontSize: 11.5, color: color.steel, marginTop: 3 },
});
