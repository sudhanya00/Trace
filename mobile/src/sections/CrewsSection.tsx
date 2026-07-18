import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MonoLabel } from '../components/ui';
import { crewsOf, RiderCrew } from '../lib/db';
import { color, font } from '../theme/tokens';

/** Crews a rider belongs to. Own view gets the browse link. */
export function CrewsSection({ profileId, own = false }: { profileId: string; own?: boolean }) {
  const [crews, setCrews] = useState<RiderCrew[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      crewsOf(profileId).then((c) => alive && setCrews(c)).catch(() => {});
      return () => {
        alive = false;
      };
    }, [profileId])
  );

  return (
    <View>
      {own && (
        <Pressable onPress={() => router.push('/crews')} style={st.browse}>
          <Text style={st.browseText}>BROWSE ALL CREWS →</Text>
        </Pressable>
      )}
      {crews.length === 0 ? (
        <Text style={st.empty}>
          {own ? 'No crew yet — find your people or start them.' : 'Rides alone, for now.'}
        </Text>
      ) : (
        crews.map((c) => (
          <Pressable key={c.id} onPress={() => router.push(`/crew/${c.id}`)}>
            {({ pressed }) => (
              <View style={[st.row, pressed && { backgroundColor: color.slate }]}>
                <View style={{ flex: 1 }}>
                  <Text style={st.name}>{c.name}</Text>
                  <MonoLabel size={8.5} style={{ marginTop: 4, letterSpacing: 1 }}>
                    {[
                      c.region,
                      `${c.member_count} rider${c.member_count === 1 ? '' : 's'}`,
                      c.role === 'admin' ? 'ADMIN' : null,
                      c.is_private ? 'PRIVATE' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </MonoLabel>
                </View>
              </View>
            )}
          </Pressable>
        ))
      )}
    </View>
  );
}

const st = StyleSheet.create({
  browse: { alignSelf: 'flex-end', paddingVertical: 4, marginBottom: 6 },
  browseText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.steel },
  empty: { fontFamily: font.body, fontSize: 13, color: color.steel, lineHeight: 19 },
  row: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: color.hair },
  name: { fontFamily: font.bodySemi, fontSize: 14.5, color: color.white },
});
