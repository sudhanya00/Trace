import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badges } from '../../src/components/Badges';
import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { ActivitySection } from '../../src/sections/ActivitySection';
import { CrewsSection } from '../../src/sections/CrewsSection';
import { GarageSection } from '../../src/sections/GarageSection';
import { RidesSection } from '../../src/sections/RidesSection';
import { color, font, layout } from '../../src/theme/tokens';

const SECTIONS = ['garage', 'rides', 'crews', 'activity'] as const;
type Section = (typeof SECTIONS)[number];

/**
 * The profile, multi-section (user decision 2026-07-17): who you are on top,
 * then GARAGE · RIDES · CREWS · ACTIVITY underneath — the whole rider in one
 * place, Reddit-style.
 */
export default function ProfileTab() {
  const { profile } = useAuth();
  const [section, setSection] = useState<Section>('garage');

  if (!profile) return <View style={st.root} />;

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content}>
      <View style={st.headRow}>
        <View style={{ flex: 1 }}>
          <MonoLabel size={9.5}>
            {[profile.home_region, profile.visibility === 'public' ? 'PUBLIC' : 'PRIVATE']
              .filter(Boolean)
              .join(' — ')
              .toUpperCase()}
          </MonoLabel>
          <Text style={st.h1}>@{profile.handle}</Text>
          {profile.display_name ? <Text style={st.sub}>{profile.display_name}</Text> : null}
        </View>
        <Pressable onPress={() => router.push('/profile-edit')} hitSlop={8} style={st.editBtn}>
          <Feather name="edit-2" size={15} color={color.steel} />
        </Pressable>
      </View>

      <Badges profileId={profile.id} />

      <View style={st.tabsRow}>
        {SECTIONS.map((s) => (
          <Pressable key={s} onPress={() => setSection(s)} style={st.tabBtn}>
            <Text style={[st.tabText, section === s && st.tabTextOn]}>{s.toUpperCase()}</Text>
            {section === s && <View style={st.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      <View style={{ marginTop: 18 }}>
        {section === 'garage' && <GarageSection />}
        {section === 'rides' && <RidesSection />}
        {section === 'crews' && <CrewsSection profileId={profile.id} own />}
        {section === 'activity' && <ActivitySection profileId={profile.id} handle={profile.handle} own />}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 64, paddingBottom: 110 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start' },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 40,
  },
  sub: { fontFamily: font.body, fontSize: 13, color: color.steel, marginTop: 6 },
  editBtn: { padding: 10, marginTop: 8 },
  tabsRow: {
    flexDirection: 'row',
    marginTop: 24,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
  },
  tabBtn: { paddingVertical: 10, marginRight: 22, alignItems: 'center' },
  tabText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.6, color: color.dim },
  tabTextOn: { color: color.white },
  tabUnderline: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: color.signal,
  },
});
