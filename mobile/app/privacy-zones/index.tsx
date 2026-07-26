import { router, useFocusEffect } from 'expo-router';
import { showAlert } from '../../src/components/Dialog';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { MonoLabel } from '../../src/components/ui';
import { deletePrivacyZone, listPrivacyZones, PrivacyZone } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

/**
 * Privacy zones: everything inside a zone vanishes from every public read —
 * tracks and routes alike, applied at read time, past rides included. The
 * rider's own data is never touched (§3).
 */
export default function PrivacyZones() {
  const [zones, setZones] = useState<PrivacyZone[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      listPrivacyZones().then((z) => alive && setZones(z)).catch(() => {});
      return () => {
        alive = false;
      };
    }, [])
  );

  const remove = (z: PrivacyZone) => {
    showAlert(
      'Delete this zone?',
      'Tracks through this area become visible on your public rides and routes again.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deletePrivacyZone(z.id).catch((e) => showAlert('Could not delete', e.message));
            setZones(await listPrivacyZones().catch(() => zones));
          },
        },
      ]
    );
  };

  return (
    <View style={st.root}>
      <View style={st.head}>
        <Text style={st.h1}>Privacy zones</Text>
        <Text style={st.sub}>
          Anything you ride inside a zone is cut from what other riders see — your own data stays
          complete. Put one over home, work, anywhere that shouldn't be on a shared map.
        </Text>
      </View>

      <FlatList
        data={zones}
        keyExtractor={(z) => z.id}
        contentContainerStyle={st.list}
        ListEmptyComponent={
          <Text style={st.empty}>No zones yet — your shared tracks show everything.</Text>
        }
        renderItem={({ item }) => (
          <View style={st.row}>
            <View style={{ flex: 1 }}>
              <Text style={st.rowTitle}>{item.label || 'Unnamed zone'}</Text>
              <Text style={st.rowSub}>
                since {new Date(item.created_at).toLocaleDateString()}
              </Text>
            </View>
            <Pressable onPress={() => remove(item)} hitSlop={10} style={st.deleteBtn}>
              <Text style={st.deleteText}>✕</Text>
            </Pressable>
          </View>
        )}
        ListFooterComponent={
          <PushButton
            label="Add a zone"
            onPress={() => router.push('/privacy-zones/new')}
            style={{ marginTop: 18 }}
          />
        }
      />

      <Pressable onPress={() => router.back()} style={st.back}>
        <Text style={st.backText}>Back</Text>
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
  sub: { fontFamily: font.body, fontSize: 13, color: color.steel, lineHeight: 19, marginTop: 10 },
  list: { padding: layout.screenPadding, paddingTop: 22 },
  empty: { fontFamily: font.body, fontSize: 13, color: color.dim },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
    gap: 10,
  },
  rowTitle: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  rowSub: { fontFamily: font.mono, fontSize: 9.5, color: color.steel, marginTop: 4 },
  deleteBtn: { padding: 8 },
  deleteText: { color: color.steel, fontSize: 14 },
  back: { alignSelf: 'center', marginBottom: 30, padding: 8 },
  backText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
