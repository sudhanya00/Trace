import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { Bike, listBikes, listMyRides, Ride } from '../../src/lib/db';
import { listLocalRides, LocalRide, rideState } from '../../src/lib/localdb';
import { syncPendingRides } from '../../src/lib/sync';
import { color, font, layout } from '../../src/theme/tokens';

/**
 * Reverse-chron ride list (§9). Local-first: unsynced rides appear instantly
 * with their sync state; synced rides come from the server with the canonical
 * distance. One row model covers both.
 */
type Row = {
  id: string;
  startedAt: number;
  km: number | null;
  gaps: number;
  title: string | null;
  bikeId: string | null;
  sync: LocalRide['sync_state'] | 'server';
  manual: boolean;
};

export default function Rides() {
  const { session } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [bikes, setBikes] = useState<Map<string, Bike>>(new Map());

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const load = async () => {
        const local = listLocalRides().filter((r) => r.sync_state !== 'recording');
        const unsynced = local.filter((r) => r.sync_state !== 'synced');
        const server = session ? await listMyRides(session.user.id).catch(() => []) : [];
        const unsyncedIds = new Set(unsynced.map((r) => r.id));

        const rows: Row[] = [
          ...unsynced.map((r): Row => {
            const s = rideState(r.id);
            return {
              id: r.id,
              startedAt: r.started_at,
              km: s ? s.distance_m / 1000 : null,
              gaps: s?.gap_count ?? 0,
              title: null,
              bikeId: r.bike_id,
              sync: r.sync_state,
              manual: false,
            };
          }),
          ...server
            .filter((r) => !unsyncedIds.has(r.id))
            .map((r: Ride): Row => ({
              id: r.id,
              startedAt: +new Date(r.started_at),
              km: Number(r.distance_km),
              gaps: r.gap_count,
              title: r.title,
              bikeId: r.bike_id,
              sync: 'server',
              manual: r.started_at === r.ended_at,
            })),
        ].sort((a, b) => b.startedAt - a.startedAt);

        if (alive) setRows(rows);
      };

      load();
      syncPendingRides().finally(load);
      listBikes()
        .then((bs) => alive && setBikes(new Map(bs.map((b) => [b.id, b]))))
        .catch(() => {});
      const t = setInterval(load, 4000);
      return () => {
        alive = false;
        clearInterval(t);
      };
    }, [session])
  );

  return (
    <View style={st.root}>
      <View style={st.head}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <Text style={st.h1}>Rides</Text>
          <Pressable onPress={() => router.push('/ride/manual')} style={st.addManual}>
            <Text style={st.addManualText}>+ BY HAND</Text>
          </Pressable>
        </View>
      </View>
      {rows.length === 0 ? (
        <View style={st.empty}>
          <MonoLabel size={9.5} style={{ marginBottom: 8 }}>
            No rides yet
          </MonoLabel>
          <Text style={st.emptyText}>Record your first ride and it lands here.</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={st.list}
          renderItem={({ item }) => (
            <RideRow row={item} bike={item.bikeId ? bikes.get(item.bikeId) ?? null : null} />
          )}
        />
      )}
    </View>
  );
}

function RideRow({ row, bike }: { row: Row; bike: Bike | null }) {
  const date = new Date(row.startedAt);
  return (
    <Pressable onPress={() => router.push(`/ride/${row.id}`)}>
      {({ pressed }) => (
        <View style={[st.row, pressed && { backgroundColor: color.slate }]}>
          <View style={{ flex: 1 }}>
            <Text style={st.rowTitle}>
              {row.title ??
                `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            </Text>
            <Text style={st.rowSub} allowFontScaling={false}>
              {row.km != null ? `${row.km.toFixed(1)} km` : '—'}
              {bike ? ` · ${bike.make} ${bike.model}` : ''}
              {row.manual ? ' · by hand' : ''}
              {row.gaps > 0 ? ` · ${row.gaps} gap${row.gaps > 1 ? 's' : ''}` : ''}
            </Text>
          </View>
          {row.sync !== 'server' && <SyncChip state={row.sync} />}
        </View>
      )}
    </Pressable>
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
  return <Text style={[st.chip, { color: m.tint }]}>{m.label}</Text>;
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
  addManual: { paddingVertical: 8, paddingHorizontal: 4 },
  addManualText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.steel },
  empty: { flex: 1, paddingHorizontal: layout.screenPadding, paddingTop: 48 },
  emptyText: { fontFamily: font.body, color: color.steel, fontSize: 13, lineHeight: 19 },
  list: { paddingTop: 8, paddingBottom: 110 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: layout.screenPadding,
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
    borderColor: color.hair,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 3.5,
  },
});
