import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/ui';
import { listRiderRoutes, Route } from '../lib/db';
import { color, font } from '../theme/tokens';

/**
 * The roads a rider has saved, as a profile section. Strava and AllTrails put
 * a rider's routes on their profile and let a shared one travel to the feed;
 * this is that half — the profile half.
 */
export function RoutesSection({ profileId, own = false }: { profileId: string; own?: boolean }) {
  const [routes, setRoutes] = useState<Route[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      listRiderRoutes(profileId).then((r) => alive && setRoutes(r)).catch(() => {});
      return () => {
        alive = false;
      };
    }, [profileId])
  );

  return (
    <View>
      {own && (
        <Pressable onPress={() => router.push('/route/plan')} style={st.plan}>
          <Text style={st.planText}>+ PLAN A ROUTE</Text>
        </Pressable>
      )}
      {routes.length === 0 ? (
        <Text style={st.empty}>
          {own
            ? 'Plan a road or save one from a ride, and it lands here.'
            : 'No routes saved yet.'}
        </Text>
      ) : (
        routes.map((r) => (
          <Pressable key={r.id} onPress={() => router.push(`/route/${r.id}`)}>
            {({ pressed }) => (
              <Card pressed={pressed} style={{ marginBottom: 10 }}>
                {r.photo_url && (
                  <Image source={{ uri: r.photo_url }} style={st.photo} resizeMode="cover" />
                )}
                <Text style={st.name}>{r.name}</Text>
                <Text style={st.sub} allowFontScaling={false}>
                  {[
                    r.distance_km ? `${Number(r.distance_km).toFixed(1)} km` : null,
                    r.region,
                    r.difficulty,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Card>
            )}
          </Pressable>
        ))
      )}
    </View>
  );
}

const st = StyleSheet.create({
  plan: { alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 4, marginBottom: 4 },
  planText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1.4, color: color.steel },
  empty: { fontFamily: font.body, color: color.steel, fontSize: 13, lineHeight: 19 },
  photo: { width: '100%', height: 120, borderRadius: 8, marginBottom: 12 },
  name: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  sub: {
    fontFamily: font.mono,
    fontSize: 10,
    color: color.steel,
    marginTop: 5,
    fontVariant: ['tabular-nums'],
  },
});
