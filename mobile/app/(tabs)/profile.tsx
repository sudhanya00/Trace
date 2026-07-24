import { Feather } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { Badges } from '../../src/components/Badges';
import { NumberTicker } from '../../src/components/NumberTicker';
import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { profileStats, ProfileStats, updateProfile, uploadAvatar } from '../../src/lib/db';
import { ActivitySection } from '../../src/sections/ActivitySection';
import { CrewsSection } from '../../src/sections/CrewsSection';
import { GarageSection } from '../../src/sections/GarageSection';
import { RidesSection } from '../../src/sections/RidesSection';
import { color, font, layout } from '../../src/theme/tokens';

const SECTIONS = ['posts', 'rides', 'crews', 'garage'] as const;
type Section = (typeof SECTIONS)[number];

function compact(n: number): string {
  if (n >= 100000) return `${Math.round(n / 1000)}k`;
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * The profile, rebuilt to the shape riders already know (item 9, 2026-07-21):
 * face and handle, the follow graph right under it, four numbers that say what
 * you've done, then POSTS · RIDES · CREWS · GARAGE. Finding riders moved here
 * from the Riders tab — searching for people belongs where people are.
 */
export default function ProfileTab() {
  const { session, profile, refreshProfile } = useAuth();
  const [section, setSection] = useState<Section>('posts');
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [uploading, setUploading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (profile) {
        profileStats(profile.id).then((s) => alive && setStats(s)).catch(() => {});
      }
      return () => {
        alive = false;
      };
    }, [profile?.id])
  );

  const pickAvatar = async () => {
    if (!session) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 1,
      allowsMultipleSelection: false,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (res.canceled || !res.assets[0]) return;
    setUploading(true);
    try {
      // 512px is plenty for a face that renders at 84 — bandwidth costs money
      // on the roads these riders are actually on.
      const resized = await ImageManipulator.manipulateAsync(
        res.assets[0].uri,
        [{ resize: { width: 512 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );
      const bytes = await new File(resized.uri).arrayBuffer();
      const url = await uploadAvatar(session.user.id, bytes);
      await updateProfile(session.user.id, { avatar_url: url });
      await refreshProfile();
    } catch (e) {
      Alert.alert('Could not update your photo', (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (!profile) return <View style={st.root} />;

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content}>
      {/* Search sits top-right, where every app that ever had a search put it. */}
      <View style={st.topBar}>
        <MonoLabel size={9.5} style={{ letterSpacing: 2.3 }}>
          {[profile.home_region, profile.visibility === 'public' ? 'PUBLIC' : 'PRIVATE']
            .filter(Boolean)
            .join(' — ')
            .toUpperCase()}
        </MonoLabel>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <Pressable onPress={() => router.push('/search')} hitSlop={8} style={st.iconBtn}>
            <Feather name="search" size={18} color={color.steel} />
          </Pressable>
          <Pressable onPress={() => router.push('/profile-edit')} hitSlop={8} style={st.iconBtn}>
            <Feather name="edit-2" size={16} color={color.steel} />
          </Pressable>
        </View>
      </View>

      <View style={st.identity}>
        <Pressable onPress={pickAvatar} disabled={uploading}>
          <Avatar url={profile.avatar_url} handle={profile.handle} size={84} />
          <View style={st.camBadge}>
            {uploading ? (
              <ActivityIndicator size="small" color={color.steel} />
            ) : (
              <Feather name="camera" size={12} color={color.steel} />
            )}
          </View>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.h1} numberOfLines={1}>
            @{profile.handle}
          </Text>
          {profile.display_name ? <Text style={st.sub}>{profile.display_name}</Text> : null}
          <View style={st.followRow}>
            <Pressable onPress={() => router.push('/follows?dir=followers')} hitSlop={6}>
              <Text style={st.followText}>
                <Text style={st.followNum}>{stats?.follower_count ?? 0}</Text> followers
              </Text>
            </Pressable>
            <Pressable onPress={() => router.push('/follows?dir=following')} hitSlop={6}>
              <Text style={st.followText}>
                <Text style={st.followNum}>{stats?.following_count ?? 0}</Text> following
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      <Badges profileId={profile.id} />

      {/* Four numbers, no units in the value — the label carries the unit.
          They count up on first view (§3.5). */}
      <View style={st.statRow}>
        <Stat label="Kms" value={stats?.total_km ?? 0} format={compact} first />
        <Stat label="Rides" value={stats?.ride_count ?? 0} />
        <Stat label="Bikes" value={stats?.bike_count ?? 0} />
        <Stat label="Crews" value={stats?.crew_count ?? 0} />
      </View>

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
          <ActivitySection profileId={profile.id} handle={profile.handle} own />
        )}
        {section === 'rides' && <RidesSection profileId={profile.id} />}
        {section === 'crews' && <CrewsSection profileId={profile.id} own />}
        {section === 'garage' && <GarageSection />}
      </View>
    </ScrollView>
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
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 60, paddingBottom: 110 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconBtn: { padding: 8 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 16 },
  camBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.slate2,
    borderWidth: 1,
    borderColor: color.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  h1: {
    fontFamily: font.display,
    fontSize: 27,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 29,
  },
  sub: { fontFamily: font.body, fontSize: 13, color: color.steel, marginTop: 4 },
  followRow: { flexDirection: 'row', gap: 16, marginTop: 9 },
  followText: { fontFamily: font.body, fontSize: 12.5, color: color.steel },
  followNum: { fontFamily: font.bodyBold, color: color.white },
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
  // Four equal columns across the full width, rather than bunched left.
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.6, color: color.dim },
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
