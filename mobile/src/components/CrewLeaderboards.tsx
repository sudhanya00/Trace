import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LeaderboardCrew } from '../lib/db';
import { color, font } from '../theme/tokens';
import { MonoLabel } from './ui';

type Board = 'riders' | 'lifetime' | 'today';

const BOARDS: { key: Board; label: string; blurb: string }[] = [
  { key: 'riders', label: 'Riders', blurb: 'Biggest crews by active members' },
  { key: 'lifetime', label: 'Lifetime', blurb: 'Every kilometre the crew has ever ridden' },
  { key: 'today', label: 'Today', blurb: 'Distance since midnight — resets 00:00 IST' },
];

function km(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Three boards, one opted-in set of crews (items 5 + 6, 2026-07-21). A crew
 * only appears here once it has flipped its own leaderboard switch — private
 * or public makes no difference to that, it is a separate choice.
 *
 * Rank is never signal-coloured: signal means live, and a standing isn't.
 * Today's board is the exception that proves it — the crews moving right now
 * are the ones with a number on it at all.
 */
export function CrewLeaderboards({ crews }: { crews: LeaderboardCrew[] }) {
  const [board, setBoard] = useState<Board>('today');

  const ranked = useMemo(() => {
    const value = (c: LeaderboardCrew) =>
      board === 'riders' ? c.member_count : board === 'lifetime' ? c.lifetime_km : c.today_km;
    return [...crews]
      .filter((c) => value(c) > 0)
      .sort((a, b) => value(b) - value(a))
      .slice(0, 20)
      .map((c) => ({ crew: c, value: value(c) }));
  }, [crews, board]);

  const active = BOARDS.find((b) => b.key === board)!;

  return (
    <View>
      <View style={st.switcher}>
        {BOARDS.map((b) => (
          <Pressable
            key={b.key}
            onPress={() => setBoard(b.key)}
            style={[st.tab, board === b.key && st.tabOn]}
          >
            <Text style={[st.tabText, board === b.key && { color: color.white }]}>
              {b.label.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={st.blurb}>{active.blurb}</Text>

      {ranked.length === 0 ? (
        <Text style={st.empty}>
          {board === 'today'
            ? 'Nobody has ridden yet today. Be the crew that starts it.'
            : 'No crews on the board yet — a crew joins from its own page.'}
        </Text>
      ) : (
        ranked.map(({ crew, value }, i) => (
          <Pressable key={crew.id} onPress={() => router.push(`/crew/${crew.id}`)}>
            {({ pressed }) => (
              <View style={[st.row, pressed && { backgroundColor: color.slate }]}>
                <Text style={[st.rank, i < 3 && st.rankTop]} allowFontScaling={false}>
                  {i + 1}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={st.name} numberOfLines={1}>
                    {crew.name}
                  </Text>
                  <MonoLabel size={8} style={{ marginTop: 3, letterSpacing: 1 }}>
                    {[crew.region, `${crew.member_count} rider${crew.member_count === 1 ? '' : 's'}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </MonoLabel>
                </View>
                {crew.i_am_in && <View style={st.mineDot} />}
                <Text style={st.value} allowFontScaling={false}>
                  {board === 'riders' ? value : km(value)}
                  {board !== 'riders' ? <Text style={st.unit}> km</Text> : null}
                </Text>
              </View>
            )}
          </Pressable>
        ))
      )}
    </View>
  );
}

const st = StyleSheet.create({
  switcher: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: color.slate,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    padding: 4,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 7 },
  tabOn: { backgroundColor: color.slate2 },
  tabText: { fontFamily: font.mono, fontSize: 8.5, letterSpacing: 1.3, color: color.dim },
  blurb: { fontFamily: font.body, fontSize: 11.5, color: color.dim, marginTop: 10, lineHeight: 17 },
  empty: { fontFamily: font.body, fontSize: 12.5, color: color.dim, marginTop: 14, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
  },
  rank: {
    fontFamily: font.displaySemi,
    fontSize: 15,
    color: color.dim,
    fontVariant: ['tabular-nums'],
    minWidth: 20,
  },
  rankTop: { color: color.white },
  name: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  mineDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: color.signal },
  value: {
    fontFamily: font.displaySemi,
    fontSize: 19,
    color: color.white,
    fontVariant: ['tabular-nums'],
  },
  unit: { fontFamily: font.displayMedium, fontSize: 10, color: color.steel },
});
