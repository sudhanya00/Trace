import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../lib/auth';
import { Crew, listCrews, myCrewIds } from '../lib/db';
import { color, font } from '../theme/tokens';
import { MonoLabel } from './ui';

/**
 * Which crew does this ride count toward? (user, 2026-07-21)
 *
 * A rider is in several crews and a ride belongs to at most one. Nothing is
 * the default — a ride counts for nobody until the rider says otherwise, so
 * NONE is a real option sitting first, not a way to escape the question.
 */
export function CrewContribution({
  value,
  onChange,
  distanceKm,
}: {
  value: string | null;
  onChange: (crewId: string | null) => void;
  distanceKm?: number;
}) {
  const { session } = useAuth();
  const [crews, setCrews] = useState<Crew[] | null>(null);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    Promise.all([listCrews(), myCrewIds(session.user.id)])
      .then(([all, mine]) => alive && setCrews(all.filter((c) => mine.has(c.id))))
      .catch(() => alive && setCrews([]));
    return () => {
      alive = false;
    };
  }, [session]);

  // No crews, no question. Never show a chooser with one dead option in it.
  if (!crews || crews.length === 0) return null;

  const km = distanceKm != null ? `${distanceKm.toFixed(1)} km` : 'this ride';

  return (
    <View>
      <MonoLabel size={8.5} style={{ marginBottom: 8 }}>
        Count it toward
      </MonoLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pressable onPress={() => onChange(null)} style={[st.chip, value === null && st.chipOn]}>
          <Text style={[st.chipText, value === null && { color: color.signal }]}>NO CREW</Text>
        </Pressable>
        {crews.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => onChange(c.id)}
            style={[st.chip, value === c.id && st.chipOn]}
          >
            <Text style={[st.chipText, value === c.id && { color: color.signal }]}>
              {c.name.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={st.note}>
        {value === null
          ? `${km === 'this ride' ? 'This ride' : km} counts toward no crew.`
          : `Adds ${km} to ${crews.find((c) => c.id === value)?.name ?? 'the crew'} — the crew sees it on their timeline.`}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipOn: { borderColor: 'rgba(255,214,10,.4)', backgroundColor: 'rgba(255,214,10,.10)' },
  chipText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1, color: color.steel },
  note: { fontFamily: font.body, fontSize: 11.5, color: color.dim, marginTop: 9, lineHeight: 17 },
});
