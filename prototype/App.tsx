import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import {
  activeSession,
  allSessions,
  endSession,
  deleteSession,
  logEvent,
  Session,
  sessionEvents,
  sessionFixes,
  sessionStats,
  SessionStats,
  startSession,
} from './src/db';
import { isRecording, startRecording, stopRecording } from './src/locationTask';

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [recording, setRecording] = useState(false);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [now, setNow] = useState(Date.now());
  const [staleSession, setStaleSession] = useState<Session | null>(null);

  const refresh = useCallback(async () => {
    const s = activeSession();
    const rec = await isRecording();
    setSession(s);
    setRecording(rec);
    setStats(s ? sessionStats(s.id) : null);
    setSessions(allSessions().filter((x) => x.ended_at !== null));
    setNow(Date.now());
    // Active session but no running task: the ride ended without a Stop —
    // reboot, or the OS killed the whole registration. Surface it, never lose it.
    setStaleSession(s && !rec ? s : null);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const onStart = useCallback(async () => {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) {
      Alert.alert('Location needed', 'The prototype cannot record without location access.');
      return;
    }
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) {
      Alert.alert(
        'Background access needed',
        'Choose "Allow all the time" in settings — the whole point of this test is recording with the screen off.'
      );
      return;
    }
    const s = startSession();
    logEvent('start', `${Device.manufacturer} ${Device.modelName} / ${Device.osName} ${Device.osVersion}`, s.id);
    await startRecording();
    refresh();
  }, [refresh]);

  const onStop = useCallback(async () => {
    await stopRecording();
    const s = activeSession();
    if (s) {
      logEvent('stop', undefined, s.id);
      endSession(s.id);
    }
    refresh();
  }, [refresh]);

  const onFinalizeStale = useCallback(() => {
    if (!staleSession) return;
    logEvent('finalized_after_interruption', undefined, staleSession.id);
    endSession(staleSession.id);
    refresh();
  }, [staleSession, refresh]);

  const onExport = useCallback(async (s: Session) => {
    const payload = {
      exportedAt: new Date().toISOString(),
      device: {
        manufacturer: Device.manufacturer,
        model: Device.modelName,
        os: Device.osName,
        osVersion: Device.osVersion,
      },
      session: s,
      stats: sessionStats(s.id),
      events: sessionEvents(s.id),
      fixes: sessionFixes(s.id),
    };
    const file = new File(Paths.cache, `trace-session-${s.id}.json`);
    if (file.exists) file.delete();
    file.create();
    file.write(JSON.stringify(payload));
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export session log' });
  }, []);

  const onDelete = useCallback(
    (s: Session) => {
      Alert.alert('Delete session?', 'The point log is gone for good.', [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { deleteSession(s.id); refresh(); } },
      ]);
    },
    [refresh]
  );

  const elapsed = session && recording ? fmtElapsed(now - session.started_at) : null;
  const batteryDelta =
    stats?.firstBattery != null && stats?.lastBattery != null
      ? Math.round((stats.firstBattery - stats.lastBattery) * 100)
      : null;

  return (
    <SafeAreaView style={st.root}>
      <StatusBar style="light" />
      <Text style={st.eyebrow}>TRACE — TASK 1</Text>
      <Text style={st.h1}>GPS calibration</Text>
      <Text style={st.sub}>
        {Device.manufacturer} {Device.modelName} · {Device.osName} {Device.osVersion}
      </Text>

      {staleSession && (
        <View style={st.stale}>
          <Text style={st.staleTitle}>Recording was interrupted</Text>
          <Text style={st.staleBody}>
            Session {staleSession.id} has no running recorder — reboot or the OS killed it. The points already
            written are safe.
          </Text>
          <Pressable style={st.staleBtn} onPress={onFinalizeStale}>
            <Text style={st.staleBtnText}>Finalize session</Text>
          </Pressable>
        </View>
      )}

      {recording && session && stats && (
        <View style={st.grid}>
          <Cell label="FIXES" value={String(stats.fixCount)} />
          <Cell label="ELAPSED" value={elapsed ?? '—'} />
          <Cell
            label="ACCURACY"
            value={stats.lastAccuracy != null ? `${Math.round(stats.lastAccuracy)} m` : '—'}
          />
          <Cell label="BATTERY USED" value={batteryDelta != null ? `${batteryDelta}%` : '—'} />
          <Cell label="GAPS >60S" value={String(stats.gapCount)} />
          <Cell label="LONGEST GAP" value={stats.longestGapS ? `${stats.longestGapS}s` : '—'} />
        </View>
      )}

      {recording ? (
        <Pressable style={[st.big, st.bigStop]} onPress={onStop}>
          <Text style={st.bigText}>Finish recording</Text>
        </Pressable>
      ) : (
        <Pressable style={st.big} onPress={onStart} disabled={!!staleSession}>
          <Text style={st.bigText}>Start recording</Text>
        </Pressable>
      )}

      <Text style={st.protocol}>
        Protocol: 3h+ real ride, phone in a bag, screen off. Ride through real dead zones — no airplane mode.
      </Text>

      <Text style={st.listHead}>SESSIONS</Text>
      <FlatList
        data={sessions}
        keyExtractor={(s) => String(s.id)}
        ListEmptyComponent={<Text style={st.empty}>Finished sessions land here for export.</Text>}
        renderItem={({ item }) => {
          const s = sessionStats(item.id);
          return (
            <View style={st.row}>
              <View style={{ flex: 1 }}>
                <Text style={st.rowTitle}>
                  #{item.id} · {fmtDate(item.started_at)}
                </Text>
                <Text style={st.rowSub}>
                  {s.fixCount} fixes · {s.gapCount} gaps · {item.ended_at ? fmtElapsed(item.ended_at - item.started_at) : '—'}
                </Text>
              </View>
              <Pressable style={st.smallBtn} onPress={() => onExport(item)}>
                <Text style={st.smallBtnText}>Export</Text>
              </Pressable>
              <Pressable style={[st.smallBtn, st.smallBtnGhost]} onPress={() => onDelete(item)}>
                <Text style={st.smallBtnText}>✕</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.cell}>
      <Text style={st.cellLabel}>{label}</Text>
      <Text style={st.cellValue}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0D0E', paddingHorizontal: 26, paddingTop: 60 },
  eyebrow: { color: '#8A9196', fontSize: 11, letterSpacing: 3 },
  h1: { color: '#E8EAEA', fontSize: 34, fontWeight: '700', marginTop: 4 },
  sub: { color: '#8A9196', fontSize: 12, marginTop: 4, marginBottom: 18 },

  stale: {
    backgroundColor: '#14181A',
    borderColor: '#F5A623',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  staleTitle: { color: '#F5A623', fontSize: 14, fontWeight: '600' },
  staleBody: { color: '#8A9196', fontSize: 12, marginTop: 6, lineHeight: 17 },
  staleBtn: { backgroundColor: '#1C2224', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  staleBtnText: { color: '#E8EAEA', fontSize: 14, fontWeight: '600' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderColor: 'rgba(232,234,234,.10)', marginBottom: 18 },
  cell: { width: '33.33%', paddingVertical: 12 },
  cellLabel: { color: '#8A9196', fontSize: 9, letterSpacing: 1.5 },
  cellValue: { color: '#E8EAEA', fontSize: 22, fontWeight: '600', marginTop: 4, fontVariant: ['tabular-nums'] },

  big: {
    height: 76,
    borderRadius: 16,
    backgroundColor: '#2E7DFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigStop: { backgroundColor: '#1C2224', borderWidth: 1, borderColor: 'rgba(232,234,234,.2)' },
  bigText: { color: '#F2F7FF', fontSize: 20, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },

  protocol: { color: '#5b6266', fontSize: 11, lineHeight: 16, marginTop: 14, marginBottom: 22 },

  listHead: { color: '#8A9196', fontSize: 10, letterSpacing: 2, marginBottom: 8 },
  empty: { color: '#5b6266', fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#14181A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(232,234,234,.10)',
    padding: 14,
    marginBottom: 8,
    gap: 8,
  },
  rowTitle: { color: '#E8EAEA', fontSize: 13, fontWeight: '600' },
  rowSub: { color: '#8A9196', fontSize: 11, marginTop: 3, fontVariant: ['tabular-nums'] },
  smallBtn: { backgroundColor: '#1C2224', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  smallBtnGhost: { backgroundColor: 'transparent' },
  smallBtnText: { color: '#E8EAEA', fontSize: 12, fontWeight: '600' },
});
