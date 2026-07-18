import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RideInvite } from '../lib/db';
import { color, font } from '../theme/tokens';
import { Card, MonoLabel } from './ui';

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((+d - Date.now()) / 86400000);
  const day =
    days <= 0
      ? 'Today'
      : days === 1
        ? 'Tomorrow'
        : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** One planned ride, anywhere it appears: board or crew room. */
export function InviteCard({
  invite,
  onToggle,
}: {
  invite: RideInvite;
  onToggle: (going: boolean) => void;
}) {
  return (
    <Card active={invite.i_am_in} style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <MonoLabel size={8.5} style={{ letterSpacing: 1.4 }}>
            {fmtWhen(invite.starts_at).toUpperCase()}
            {invite.region ? ` — ${invite.region.toUpperCase()}` : ''}
          </MonoLabel>
          <Text style={st.title}>{invite.title}</Text>
          <Text style={st.sub}>
            @{invite.handle}
            {invite.meetup ? ` · ${invite.meetup}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Pressable
            onPress={() => onToggle(!invite.i_am_in)}
            style={[st.rsvpBtn, invite.i_am_in && st.rsvpBtnOn]}
          >
            <Text style={[st.rsvpText, invite.i_am_in && { color: color.signal }]}>
              {invite.i_am_in ? "I'M IN" : 'COUNT ME IN'}
            </Text>
          </Pressable>
          <Text style={st.count} allowFontScaling={false}>
            {invite.rsvp_count} going
          </Text>
        </View>
      </View>
    </Card>
  );
}

const st = StyleSheet.create({
  title: {
    fontFamily: font.display,
    fontSize: 19,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 21,
    marginTop: 6,
  },
  sub: { fontFamily: font.body, fontSize: 12, color: color.steel, marginTop: 5, lineHeight: 17 },
  rsvpBtn: {
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  rsvpBtnOn: { borderColor: 'rgba(255,214,10,.4)', backgroundColor: 'rgba(255,214,10,.10)' },
  rsvpText: { fontFamily: font.mono, fontSize: 8, letterSpacing: 1.2, color: color.steel },
  count: { fontFamily: font.mono, fontSize: 8.5, color: color.dim, fontVariant: ['tabular-nums'] },
});
