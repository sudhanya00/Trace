import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PushButton } from '../src/components/PushButton';
import { Card, MonoLabel } from '../src/components/ui';
import { OEM_COPY, oemFamily } from '../src/lib/oem';
import { supabase } from '../src/lib/supabase';
import { color, font, layout } from '../src/theme/tokens';

/** §9 Settings: permissions status, OEM whitelist re-run, sign out. */
export default function Settings() {
  const [fg, setFg] = useState<string>('…');
  const [bg, setBg] = useState<string>('…');
  const [notif, setNotif] = useState<string>('…');
  const family = oemFamily();

  useFocusEffect(
    useCallback(() => {
      Location.getForegroundPermissionsAsync().then((p) =>
        setFg(p.granted ? 'Allowed' : p.canAskAgain ? 'Not asked yet' : 'Denied')
      );
      Location.getBackgroundPermissionsAsync().then((p) =>
        setBg(p.granted ? 'All the time' : 'Off — tracks break on screen lock')
      );
      Notifications.getPermissionsAsync().then((p) =>
        setNotif(p.granted ? 'Allowed' : 'Off — ride stats hidden while recording')
      );
    }, [])
  );

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace('/');
  };

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content}>
      <Text style={st.h1}>Settings</Text>

      <MonoLabel size={9} style={{ marginTop: 26, marginBottom: 10 }}>
        Permissions
      </MonoLabel>
      <Card>
        <StatusRow label="Location" value={fg} warn={fg === 'Denied'} />
        <StatusRow label="Background location" value={bg} warn={!bg.startsWith('All')} divider />
        <StatusRow label="Notifications" value={notif} warn={!notif.startsWith('Allowed')} divider />
      </Card>

      <MonoLabel size={9} style={{ marginTop: 26, marginBottom: 10 }}>
        Battery
      </MonoLabel>
      <Card>
        <Text style={st.batteryText}>
          {family
            ? `${OEM_COPY[family].skin} is known to kill background recording. If a ride ever stops by itself, re-run the walkthrough.`
            : 'This phone runs close-to-stock Android — background recording should survive without special settings.'}
        </Text>
        {family && (
          <PushButton
            label="Re-run battery walkthrough"
            variant="slate"
            onPress={() => router.push('/oem-whitelist')}
            style={{ marginTop: 14 }}
          />
        )}
      </Card>

      <PushButton label="Sign out" variant="slate" onPress={signOut} style={{ marginTop: 34 }} />

      <Pressable onPress={() => router.back()} style={st.back}>
        <Text style={st.backText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

function StatusRow({
  label,
  value,
  warn = false,
  divider = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
  divider?: boolean;
}) {
  return (
    <View style={[st.row, divider && st.rowDivider]}>
      <Text style={st.rowLabel}>{label}</Text>
      <Text style={[st.rowValue, warn && { color: color.amber }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 84, paddingBottom: 60 },
  h1: {
    fontFamily: font.display,
    fontSize: 41,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 42,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, gap: 12 },
  rowDivider: { borderTopWidth: 1, borderTopColor: color.hair },
  rowLabel: { fontFamily: font.bodyMedium, fontSize: 13, color: color.white },
  rowValue: { fontFamily: font.mono, fontSize: 10, color: color.steel, flexShrink: 1, textAlign: 'right' },
  batteryText: { fontFamily: font.body, fontSize: 12.5, color: color.steel, lineHeight: 18 },
  back: { alignSelf: 'center', marginTop: 22, padding: 8 },
  backText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
