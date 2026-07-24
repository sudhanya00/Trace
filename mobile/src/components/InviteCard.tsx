import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  BIKE_TYPES,
  BikeType,
  EXPERIENCE,
  Experience,
  inviteAsks,
  multiLineCoords,
  RideInvite,
  RsvpAnswers,
} from '../lib/db';
import { TrackThumb } from './TrackThumb';
import { color, font } from '../theme/tokens';
import { PushButton } from './PushButton';
import { Sheet } from './Sheet';
import { Card, ChipSelect, MonoLabel, YesNo } from './ui';

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

/** The ride's shape, read back as a line of requirements. */
function requirements(i: RideInvite): string[] {
  const out: string[] = [];
  if (i.bike_category) out.push(i.bike_category === 'any' ? 'ANY BIKE' : i.bike_category.toUpperCase());
  if (i.gear_required) out.push('FULL GEAR');
  else if (i.gear_required === false) out.push('GEAR OPTIONAL');
  if (i.min_experience && i.min_experience !== 'any') out.push(`${i.min_experience.toUpperCase()}+`);
  if (i.difficulty) out.push(i.difficulty.toUpperCase());
  return out;
}

/** What this rider answered, read back so they can check and correct it. */
function myAnswers(i: RideInvite): string {
  const out: string[] = [];
  if (i.my_bike_category) out.push(i.my_bike_category);
  if (i.my_has_gear != null) out.push(i.my_has_gear ? 'has gear' : 'no gear');
  if (i.my_experience) out.push(i.my_experience);
  return out.join(' · ');
}

/**
 * One planned ride, anywhere it appears: board, crew room, or explore feed.
 * Joining asks whatever the creator asked (item 7, 2026-07-21) — and nothing
 * more, because a question the ride didn't pose is friction with no payoff.
 */
export function InviteCard({
  invite,
  onToggle,
}: {
  invite: RideInvite;
  onToggle: (going: boolean, answers?: RsvpAnswers) => void;
}) {
  const asks = inviteAsks(invite);
  const [sheet, setSheet] = useState(false);
  const [bike, setBike] = useState<BikeType | null>(invite.my_bike_category);
  const [gear, setGear] = useState<boolean | null>(invite.my_has_gear);
  const [exp, setExp] = useState<Experience | null>(invite.my_experience);

  const reqs = requirements(invite);
  const answered = myAnswers(invite);

  const press = () => {
    if (invite.i_am_in) return onToggle(false); // dropping out asks nothing
    if (asks.length === 0) return onToggle(true);
    setSheet(true);
  };

  // Every question the ride asked needs an answer before the RSVP counts.
  const complete =
    (!asks.includes('bike_category') || bike != null) &&
    (!asks.includes('has_gear') || gear != null) &&
    (!asks.includes('experience') || exp != null);

  const confirm = () => {
    setSheet(false);
    onToggle(true, {
      ...(asks.includes('bike_category') ? { bike_category: bike } : {}),
      ...(asks.includes('has_gear') ? { has_gear: gear } : {}),
      ...(asks.includes('experience') ? { experience: exp } : {}),
    });
  };

  return (
    <>
      <Card active={invite.i_am_in} style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          {/* A planned ride with a mapped route shows the road itself (§4.4) —
              a shape beats a title string. Adhoc routes have no geometry, so
              TrackThumb draws its ghosted placeholder instead. */}
          {invite.route_geom ? (
            <TrackThumb id={invite.route_id ?? undefined} segments={multiLineCoords(invite.route_geom)} />
          ) : null}
          <View style={{ flex: 1 }}>
            <MonoLabel size={8.5} style={{ letterSpacing: 1.4 }}>
              {fmtWhen(invite.starts_at).toUpperCase()}
              {invite.region ? ` — ${invite.region.toUpperCase()}` : ''}
            </MonoLabel>
            <Text style={st.title}>{invite.title}</Text>
            <Text style={st.sub}>
              @{invite.handle}
              {invite.meetup ? ` · ${invite.meetup}` : ''}
              {invite.route_distance_km
                ? ` · ${Number(invite.route_distance_km).toFixed(0)} km`
                : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Pressable onPress={press} style={[st.rsvpBtn, invite.i_am_in && st.rsvpBtnOn]}>
              <Text style={[st.rsvpText, invite.i_am_in && { color: color.white }]}>
                {invite.i_am_in ? "I'M IN" : 'COUNT ME IN'}
              </Text>
            </Pressable>
            <Text style={st.count} allowFontScaling={false}>
              {invite.rsvp_count} going
            </Text>
          </View>
        </View>

        {reqs.length > 0 && (
          <View style={st.reqRow}>
            {reqs.map((r) => (
              <Text key={r} style={st.req}>
                {r}
              </Text>
            ))}
          </View>
        )}

        {invite.i_am_in && answered ? (
          <Pressable onPress={() => setSheet(true)} hitSlop={6}>
            <Text style={st.mine}>You: {answered} — tap to change</Text>
          </Pressable>
        ) : null}
      </Card>

      <Sheet
        visible={sheet}
        onClose={() => setSheet(false)}
        label={invite.title}
        title="Before you join"
      >
        {asks.includes('bike_category') && (
          <ChipSelect
            label="What are you riding?"
            options={BIKE_TYPES}
            value={bike}
            onChange={setBike}
            style={{ marginBottom: 20 }}
          />
        )}
        {asks.includes('has_gear') && (
          <YesNo
            label={invite.gear_required ? 'Full gear is required — do you have it?' : 'Riding in full gear?'}
            value={gear}
            onChange={setGear}
            style={{ marginBottom: 20 }}
          />
        )}
        {asks.includes('experience') && (
          <ChipSelect
            label="How much riding have you done?"
            options={EXPERIENCE}
            value={exp}
            onChange={setExp}
            style={{ marginBottom: 20 }}
          />
        )}

        {/* An honest no is useful information, not a rejection. The ride's own
            requirements are on the card above; the rider decides. */}
        {invite.gear_required && gear === false && (
          <Text style={st.warn}>
            This ride asks for full gear. You can still join — the crew will know to expect you
            without it.
          </Text>
        )}

        <PushButton
          label={invite.i_am_in ? 'Save' : "I'm in"}
          onPress={confirm}
          disabled={!complete}
          style={{ marginTop: 4, marginBottom: 8 }}
        />
      </Sheet>
    </>
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
  rsvpBtnOn: { borderColor: color.disabled, backgroundColor: color.slate2 },
  rsvpText: { fontFamily: font.mono, fontSize: 8, letterSpacing: 1.2, color: color.steel },
  count: { fontFamily: font.mono, fontSize: 8.5, color: color.dim, fontVariant: ['tabular-nums'] },
  reqRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  req: {
    fontFamily: font.mono,
    fontSize: 7.5,
    letterSpacing: 1.2,
    color: color.steel,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 3.5,
  },
  mine: { fontFamily: font.body, fontSize: 11, color: color.dim, marginTop: 10 },
  warn: {
    fontFamily: font.body,
    fontSize: 12,
    color: color.amber,
    lineHeight: 18,
    marginBottom: 16,
  },
});
