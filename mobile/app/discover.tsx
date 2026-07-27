import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DiscoverCard } from '../src/components/DiscoverCard';
import { WhenPicker } from '../src/components/WhenPicker';
import { Field, MonoLabel } from '../src/components/ui';
import { useAuth } from '../src/lib/auth';
import { DiscoveredRoute, discoverRoutes } from '../src/lib/db';
import { color, font, layout } from '../src/theme/tokens';

/**
 * Where to ride.
 *
 * Ranked entirely server-side, against roads other riders have actually
 * ridden and against what this rider has actually done. No model is involved
 * yet, and the list has to be worth reading without one — if it isn't, a chat
 * layer on top would be decorating a hole.
 *
 * The date matters and is not decoration: season is one of the things the
 * ranker decides on, and a rider planning for June should not be told a pass
 * is shut because it happens to be February today.
 */
export default function Discover() {
  const { profile } = useAuth();
  const [region, setRegion] = useState('');
  const [when, setWhen] = useState<Date>(() => new Date(Date.now() + 86400e3));
  const [routes, setRoutes] = useState<DiscoveredRoute[] | null>(null);

  // Seed the box with where the rider says they are, so the first screen is
  // never blank for someone who has told us already.
  const scope = region.trim() || profile?.home_region || null;

  // Debounced: the region box is a text field, and a query per keystroke is a
  // query per keystroke. `alive` guards the out-of-order reply — a slow answer
  // for "Hima" must not overwrite a fast one for "Himachal".
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      discoverRoutes({ region: scope, when })
        .then((r) => alive && setRoutes(r))
        .catch(() => alive && setRoutes([]));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [scope, when]);

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
      <View style={st.head}>
        <View style={{ flex: 1 }}>
          <MonoLabel size={9.5} style={{ letterSpacing: 2.3 }}>
            Where to ride
          </MonoLabel>
          <Text style={st.h1}>Discover</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 8 }}>
          <Text style={st.back}>Back</Text>
        </Pressable>
      </View>

      <View style={st.controls}>
        <Field
          label="Where"
          value={region}
          onChangeText={setRegion}
          placeholder={profile?.home_region ?? 'Himachal, Ladakh, Coorg…'}
          autoCapitalize="words"
        />
        <View style={{ marginTop: 14 }}>
          <WhenPicker value={when} onChange={setWhen} label="When" />
        </View>
      </View>

      {routes === null ? null : routes.length === 0 ? (
        <Text style={st.empty}>
          {scope
            ? `Nobody has mapped a road in ${scope} yet. Ride one and share it, and it lands here for whoever asks next.`
            : 'Tell us where you are and we’ll tell you what’s there.'}
        </Text>
      ) : (
        <View style={{ marginTop: 22 }}>
          {routes.map((r) => (
            <DiscoverCard key={r.route_id} route={r} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 70, paddingBottom: 70 },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 6,
    lineHeight: 40,
  },
  back: { fontFamily: font.bodyMedium, fontSize: 14, color: color.steel },
  controls: { marginTop: 22 },
  empty: {
    fontFamily: font.body,
    fontSize: 13,
    color: color.steel,
    lineHeight: 20,
    marginTop: 26,
  },
});
