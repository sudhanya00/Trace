import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { MonoLabel } from '../../src/components/ui';
import { Bike, listBikes } from '../../src/lib/db';
import { listLocalRides, LocalRide, rideState } from '../../src/lib/localdb';
import { syncPendingRides } from '../../src/lib/sync';
import { color, font, layout } from '../../src/theme/tokens';

/**
 * Ride list, local-first: every ride appears the moment it's finished, with
 * an honest sync state. Server-side detail (canonical distance, map preview)
 * is the step-9 build.
 */
export default function Rides() {
  const [rides, setRides] = useState<LocalRide[]>([]);
  const [bikes, setBikes] = useState<Map<string, Bike>>(new Map());

  useFocusEffect(
    useCallback(() => {
      const load = () => setRides(listLocalRides().filter((r) => r.sync_state !== 'recording'));
      load();
      syncPendingRides().finally(load);
      listBikes()
        .then((bs) => setBikes(new Map(bs.map((b) => [b.id, b]))))
        .catch(() => {});
      const t = setInterval(load, 3000);
      return () => clearInterval(t);
    }, [])
  );

  return (
    <View style={st.root}>
      <View style={st.head}>
        <Text style={st.h1}>Rides</Text>
      </View>
      {rides.length === 0 ? (
        <View style={st.empty}>
          <MonoLabel size={9.5} style={{ marginBottom: 8 }}>
            No rides yet
          </MonoLabel>
          <Text style={st.emptyText}>Record your first ride and it lands here.</Text>
        </View>
      ) : (
        <FlatList
          data={rides}
          keyExtractor={(r) => r.id}
          contentContainerStyle={st.list}
          renderItem={({ item }) => <RideRow ride={item} bike={item.bike_id ? bikes.get(item.bike_id) ?? null : null} />}
        />
      )}
    </View>
  );
}

function RideRow({ ride, bike }: { ride: LocalRide; bike: Bike | null }) {
  const s = rideState(ride.id);
  const km = s ? (s.distance_m / 1000).toFixed(1) : null;
  const date = new Date(ride.started_at);
  return (
    <View style={st.row}>
      <View style={{ flex: 1 }}>
        <Text style={st.rowTitle}>
          {date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ·{' '}
          {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <Text style={st.rowSub} allowFontScaling={false}>
          {km != null ? `${km} km` : 'synced'}
          {bike ? ` · ${bike.make} ${bike.model}` : ''}
          {s && s.gap_count > 0 ? ` · ${s.gap_count} gap${s.gap_count > 1 ? 's' : ''}` : ''}
        </Text>
      </View>
      <SyncChip state={ride.sync_state} />
    </View>
  );
}

function SyncChip({ state }: { state: LocalRide['sync_state'] }) {
  const map: Record<string, { label: string; tint: string }> = {
    pending: { label: 'WAITING TO SYNC', tint: color.steel },
    syncing: { label: 'SYNCING', tint: color.steel },
    synced: { label: 'SYNCED', tint: color.moss },
    failed: { label: 'RETRYING', tint: color.amber },
  };
  const m = map[state] ?? map.pending;
  return (
    <Text style={[st.chip, { color: m.tint, borderColor: color.hair }]}>{m.label}</Text>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  head: { paddingHorizontal: layout.screenPadding, paddingTop: 64 },
  h1: {
    fontFamily: font.display,
    fontSize: 41,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 42,
  },
  empty: { flex: 1, paddingHorizontal: layout.screenPadding, paddingTop: 48 },
  emptyText: { fontFamily: font.body, color: color.steel, fontSize: 13, lineHeight: 19 },
  list: { padding: layout.screenPadding, paddingTop: 20, paddingBottom: 110 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
    gap: 10,
  },
  rowTitle: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  rowSub: {
    fontFamily: font.mono,
    fontSize: 10,
    color: color.steel,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  chip: {
    fontFamily: font.mono,
    fontSize: 7.5,
    letterSpacing: 1.2,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 3.5,
  },
});
