import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NumberTicker } from '../components/NumberTicker';
import { MonoLabel } from '../components/ui';
import { profileStats, ProfileStats } from '../lib/db';
import { color, font } from '../theme/tokens';

import { ActivitySection } from './ActivitySection';
import { CrewsSection } from './CrewsSection';
import { GarageSection } from './GarageSection';
import { RidesSection } from './RidesSection';
import { RoutesSection } from './RoutesSection';

const SECTIONS = ['posts', 'rides', 'routes', 'crews', 'garage'] as const;
type Section = (typeof SECTIONS)[number];

function compact(n: number): string {
  if (n >= 100000) return `${Math.round(n / 1000)}k`;
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Everything below the identity block on a profile: the four numbers and the
 * tabbed sections.
 *
 * It lives here rather than in either screen because the two profiles have to
 * be the same page (item 2, 2026-07-25) — a rider looking at someone else
 * should recognise exactly what they're looking at. Two copies of this layout
 * would drift apart by the next feature; one can't.
 */
export function ProfileBody({
  profileId,
  handle,
  own = false,
}: {
  profileId: string;
  handle: string;
  own?: boolean;
}) {
  const [section, setSection] = useState<Section>('posts');

  return (
    <>
      <View style={st.tabsRow}>
        {SECTIONS.map((s) => (
          <Pressable key={s} onPress={() => setSection(s)} style={st.tabBtn}>
            <Text style={[st.tabText, section === s && st.tabTextOn]}>{s.toUpperCase()}</Text>
            {section === s && <View style={st.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      <View style={{ marginTop: 18 }}>
        {section === 'posts' && (
          <ActivitySection profileId={profileId} handle={handle} own={own} />
        )}
        {section === 'rides' && <RidesSection profileId={profileId} />}
        {section === 'routes' && <RoutesSection profileId={profileId} own={own} />}
        {section === 'crews' && <CrewsSection profileId={profileId} own={own} />}
        {section === 'garage' && <GarageSection profileId={profileId} />}
      </View>
    </>
  );
}

/**
 * Four numbers, no units in the value — the label carries the unit. They
 * count up on first view (§3.5). `onFollowers`/`onFollowing` are only wired on
 * your own profile: followEdges() reads your graph, not theirs.
 */
export function ProfileStatsRow({
  profileId,
  onStats,
}: {
  profileId: string;
  onStats?: (s: ProfileStats) => void;
}) {
  const [stats, setStats] = useState<ProfileStats | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      profileStats(profileId)
        .then((s) => {
          if (!alive) return;
          setStats(s);
          onStats?.(s);
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [profileId])
  );

  return (
    <View style={st.statRow}>
      <Stat label="Kms" value={stats?.total_km ?? 0} format={compact} first />
      <Stat label="Rides" value={stats?.ride_count ?? 0} />
      <Stat label="Bikes" value={stats?.bike_count ?? 0} />
      <Stat label="Crews" value={stats?.crew_count ?? 0} />
    </View>
  );
}

function Stat({
  label,
  value,
  format,
  first = false,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  first?: boolean;
}) {
  return (
    <View style={[st.stat, !first && st.statDivider]}>
      <NumberTicker value={value} format={format} style={st.statValue} />
      <MonoLabel size={8} style={{ marginTop: 4 }}>
        {label}
      </MonoLabel>
    </View>
  );
}

const st = StyleSheet.create({
  statRow: {
    flexDirection: 'row',
    marginTop: 24,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.hair,
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: color.hair },
  statValue: {
    fontFamily: font.displaySemi,
    fontSize: 22,
    color: color.white,
    fontVariant: ['tabular-nums'],
    lineHeight: 24,
  },
  tabsRow: {
    flexDirection: 'row',
    marginTop: 22,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
  },
  // Equal columns across the full width, rather than bunched left.
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabText: { fontFamily: font.mono, fontSize: 8.5, letterSpacing: 1.1, color: color.dim },
  tabTextOn: { color: color.white },
  tabUnderline: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: color.white,
  },
});
