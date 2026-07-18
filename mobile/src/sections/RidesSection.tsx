import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MonoLabel } from '../components/ui';
import { useAuth } from '../lib/auth';
import { Bike, bikeTitle, listBikes, listMyRides, Ride } from '../lib/db';
import { listLocalRides, LocalRide, rideState } from '../lib/localdb';
import { syncPendingRides } from '../lib/sync';
import { color, font } from '../theme/tokens';

/** The ride log, as a profile section. Local-first, same row model as before. */
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

export function RidesSection() {
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
        const merged: Row[] = [
          ...unsynced.map((r): Row => {
            const s = rideState(r.id);
            return {
              id: r.id,
              startedAt: r.started_at,
              km: s ? s.distance_m / 1000 : null,
              gaps: s?.gap_count ?? 0,
              title: r.pending_title,
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
        if (alive) setRows(merged);
      };
      load();
      syncPendingRides().finally(load);
      if (session) {
        listBikes(session.user.id)
          .then((bs) => alive && setBikes(new Map(bs.map((b) => [b.id, b]))))
          .catch(() => {});
      }
      const t = setInterval(load, 4000);
      return () => {
        alive = false;
        clearInterval(t);
      };
    }, [session])
  );

  return (
    <View>
      <Pressable onPress={() => router.push('/ride/manual')} style={st.addManual}>
        <Text style={st.addManualText}>+ BY HAND</Text>
      </Pressable>
      {rows.length === 0 ? (
        <Text style={st.empty}>Record your first ride and it lands here.</Text>
      ) : (
        rows.map((row) => {
          const bike = row.bikeId ? bikes.get(row.bikeId) ?? null : null;
          const date = new Date(row.startedAt);
          return (
            <Pressable key={row.id} onPress={() => router.push(`/ride/${row.id}`)}>
              {({ pressed }) => (
                <View style={[st.row, pressed && { backgroundColor: color.slate }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.rowTitle}>
                      {row.title ??
                        `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                    </Text>
                    <Text style={st.rowSub} allowFontScaling={false}>
                      {row.km != null ? `${row.km.toFixed(1)} km` : '—'}
                      {bike ? ` · ${bikeTitle(bike)}` : ''}
                      {row.manual ? ' · by hand' : ''}
                      {row.gaps > 0 ? ` · ${row.gaps} gap${row.gaps > 1 ? 's' : ''}` : ''}
                    </Text>
                  </View>
                  {row.sync !== 'server' && <SyncChip state={row.sync} />}
                </View>
              )}
            </Pressable>
          );
        })
      )}
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
  return <Text style={[st.chip, { color: m.tint }]}>{m.label}</Text>;
}

const st = StyleSheet.create({
  addManual: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 4, marginBottom: 4 },
  addManualText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.steel },
  empty: { fontFamily: font.body, color: color.steel, fontSize: 13, lineHeight: 19 },
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
    borderColor: color.hair,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 3.5,
  },
});
