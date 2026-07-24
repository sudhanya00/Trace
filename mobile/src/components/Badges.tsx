import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { listAchievements } from '../lib/db';
import { color, font } from '../theme/tokens';
import { MonoLabel } from './ui';

/** Badge labels in the rider's vernacular. Order = display order. */
const BADGE_META: [string, string][] = [
  ['rides_1', 'FIRST RIDE'],
  ['km_100', '100 KM'],
  ['km_500', '500 KM'],
  ['km_1000', '1,000 KM'],
  ['km_5000', '5,000 KM'],
  ['km_10000', '10,000 KM'],
  ['km_25000', '25,000 KM'],
  ['km_50000', '50,000 KM'],
  ['rides_10', '10 RIDES'],
  ['rides_50', '50 RIDES'],
  ['rides_100', '100 RIDES'],
  ['longest_100', '100 KM DAY'],
  ['longest_300', '300 KM DAY'],
  ['longest_500', '500 KM DAY'],
  ['routes_1', 'ROAD SHARED'],
  ['routes_10', 'TEN ROADS SHARED'],
  ['bikes_2', 'SECOND BIKE'],
  ['bikes_3', 'THIRD BIKE'],
  ['crews_1', 'CREWED UP'],
];

export function Badges({ profileId }: { profileId: string }) {
  const [earned, setEarned] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    listAchievements(profileId)
      .then((a) => alive && setEarned(new Set(a.map((x) => x.key))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [profileId]);

  const badges = BADGE_META.filter(([k]) => earned.has(k));
  if (badges.length === 0) return null;

  return (
    <View>
      <MonoLabel size={9} style={{ marginTop: 28, marginBottom: 10 }}>
        Badges · {badges.length}
      </MonoLabel>
      <View style={st.grid}>
        {badges.map(([k, label]) => (
          <Text key={k} style={st.badge}>
            ◆ {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // Badges are jewellery, not buttons (§2.1): a diamond in the dim trace
  // colour, condensed uppercase, hairline border — they should look earned,
  // and they carry no action-yellow.
  badge: {
    fontFamily: font.mono,
    fontSize: 8.5,
    letterSpacing: 1.4,
    color: color.traceDim,
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: 'hidden',
  },
});
