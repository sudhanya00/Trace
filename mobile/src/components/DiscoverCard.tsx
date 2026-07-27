import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DiscoveredRoute, RouteWarning } from '../lib/db';
import { daysBetween } from '../lib/when';
import { color, font, status } from '../theme/tokens';
import { Card } from './ui';

/**
 * The copy for every warning the ranker can raise.
 *
 * It lives here and not in SQL on purpose. §8 owns the voice — sentence case,
 * plain verbs, state what happened and what it costs, never apologise — and a
 * sentence written inside a migration is a sentence nobody reviews as copy.
 *
 * A code with no entry renders nothing. A rule can ship ahead of its words;
 * what it must not do is show a rider `above_your_altitude` on a card.
 */
const WARNING_COPY: Record<RouteWarning, string> = {
  high_pass: 'High pass — thin air, and cold once the sun drops',
  out_of_season: 'Usually shut this time of year',
  seasonal_gate: 'Gated seasonally — check before you commit to the day',
  no_signal: 'No signal for most of it',
  above_your_altitude: 'Higher than anything you’ve ridden',
  beyond_your_longest: 'Longer than your longest day so far',
};

/**
 * Provenance, and only when there is some.
 *
 * The instinct is to caption the unverified rows — *nobody has ridden this* —
 * and it is wrong in a way this codebase has already been bitten by. A caption
 * on every row carries no information, and people stop reading it exactly
 * before the row where it mattered.
 *
 * So: mark what is verified, say nothing otherwise. At launch almost nothing
 * has a badge and the list simply reads as a list. As riders arrive the badges
 * appear, and they become the thing people look for — a reward for
 * contributing rather than a scolding for its absence. Same discipline as the
 * accent rule in §8: mark the exception, never the default.
 */
function Provenance({ route }: { route: DiscoveredRoute }) {
  if (route.riders_count < 1) return null;

  const riders = `${route.riders_count} ${route.riders_count === 1 ? 'rider' : 'riders'}`;
  const report =
    route.last_condition && route.last_condition_at
      ? `${route.last_condition}, ${sinceLabel(route.last_condition_at)}`
      : null;

  return (
    <View style={st.badge}>
      <Feather name="check" size={11} color={color.trace} />
      <Text style={st.badgeText} allowFontScaling={false}>
        {[riders, report].filter(Boolean).join(' · ')}
      </Text>
    </View>
  );
}

/** "today", "yesterday", "12 days ago" — the age of a condition report. */
function sinceLabel(iso: string): string {
  const days = daysBetween(new Date(iso), new Date());
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * One road, as the discovery list shows it.
 *
 * Warnings are amber and never the accent — a caution on an instrument cluster
 * is never the illumination colour, and yellow here belongs to the one primary
 * action on a screen.
 */
export function DiscoverCard({ route }: { route: DiscoveredRoute }) {
  const meta = [
    route.distance_km ? `${Number(route.distance_km).toFixed(0)} km` : null,
    route.difficulty,
    route.max_altitude_m ? `${route.max_altitude_m} m` : null,
    route.est_duration_minutes ? `${Math.round(route.est_duration_minutes / 60)} h` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const warnings = route.warnings.filter((w) => w in WARNING_COPY);

  return (
    <Pressable onPress={() => router.push(`/route/${route.route_id}`)}>
      {({ pressed }) => (
        <Card pressed={pressed} style={{ marginBottom: 10 }}>
          <View style={st.head}>
            <Text style={st.name} numberOfLines={1}>
              {route.name}
            </Text>
            <Provenance route={route} />
          </View>

          {meta ? (
            <Text style={st.meta} allowFontScaling={false}>
              {meta}
            </Text>
          ) : null}

          {route.description ? (
            <Text style={st.description} numberOfLines={2}>
              {route.description}
            </Text>
          ) : null}

          {warnings.length > 0 && (
            <View style={st.warnings}>
              {warnings.map((w) => (
                <View key={w} style={st.warnRow}>
                  <View style={st.warnDash} />
                  <Text style={st.warnText}>{WARNING_COPY[w]}</Text>
                </View>
              ))}
            </View>
          )}

          {/*
            The tap that turns a suggestion into something real, and the whole
            reason discovery is worth building: a road that gets planned gets
            ridden, and a road that gets ridden comes back as a route with a
            condition report on it. The next rider who asks about this place
            sees a badge where this card had none.

            Deliberately quiet — a mono link, not a filled button. §8 keeps the
            accent for the one primary action on a screen, and a list of eight
            cards would otherwise be eight of them.
          */}
          <Pressable
            onPress={() =>
              router.push({ pathname: '/invite/new', params: { routeId: route.route_id } })
            }
            hitSlop={8}
            style={st.plan}
          >
            <Text style={st.planText}>PLAN THIS RIDE</Text>
            <Feather name="arrow-right" size={12} color={color.steel} />
          </Pressable>
        </Card>
      )}
    </Pressable>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  name: { flex: 1, fontFamily: font.bodySemi, fontSize: 15, color: color.white },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 1 },
  badgeText: {
    fontFamily: font.mono,
    fontSize: 9,
    letterSpacing: 0.8,
    color: color.trace,
    textTransform: 'uppercase',
  },
  meta: {
    fontFamily: font.mono,
    fontSize: 10,
    color: color.steel,
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  description: {
    fontFamily: font.body,
    fontSize: 12.5,
    color: color.steel,
    lineHeight: 18,
    marginTop: 8,
  },
  // A footnote, not an alarm — the same shape the gap notice uses on the
  // record screen: a short dashed rule, then plain text.
  warnings: { marginTop: 10, gap: 5 },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  warnDash: {
    width: 14,
    borderTopWidth: 1.5,
    borderTopColor: status.warning,
    borderStyle: 'dashed',
    opacity: 0.8,
  },
  warnText: { flex: 1, fontFamily: font.body, fontSize: 11.5, color: status.warning },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 14,
    paddingVertical: 4,
  },
  planText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.steel },
});
