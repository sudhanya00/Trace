import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { RideMap } from '../../src/components/RideMap';
import { DataCell, MonoLabel } from '../../src/components/ui';
import { getRoute, Profile, publicRouteSegments, Route } from '../../src/lib/db';
import { supabase } from '../../src/lib/supabase';
import { googleMapsDirectionsUrl, toGpx } from '../../src/lib/gpx';
import { color, font, layout } from '../../src/theme/tokens';

/**
 * Route detail (§9): map, stats, author, and the Navigate handoff (§10).
 * Geometry is always the privacy-clipped public representation — the owner
 * sees their route exactly as other riders will.
 */
export default function RouteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [route, setRoute] = useState<Route | null>(null);
  const [segments, setSegments] = useState<[number, number][][] | null>(null);
  const [author, setAuthor] = useState<Profile | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      const r = await getRoute(id).catch(() => null);
      if (!r || !alive) return;
      setRoute(r);
      publicRouteSegments(r.id).then((s) => alive && setSegments(s)).catch(() => {});
      supabase
        .from('profiles')
        .select('*')
        .eq('id', r.profile_id)
        .maybeSingle()
        .then(({ data }) => alive && setAuthor(data));
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (!route) return <View style={st.root} />;

  const navigate = async () => {
    if (!segments?.length) return;
    try {
      const gpx = toGpx(route.name, segments);
      const file = new File(Paths.cache, `${route.name.replace(/[^\w\- ]/g, '').trim() || 'route'}.gpx`);
      if (file.exists) file.delete();
      file.create();
      file.write(gpx);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/gpx+xml',
        dialogTitle: 'Navigate with…',
      });
    } catch (e) {
      Alert.alert('Could not export', (e as Error).message);
    }
  };

  const openGoogleMaps = () => {
    if (!segments?.length) return;
    const url = googleMapsDirectionsUrl(segments);
    if (url) Linking.openURL(url);
  };

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content}>
      {route.photo_url && (
        <Image source={{ uri: route.photo_url }} style={st.photo} resizeMode="cover" />
      )}

      <MonoLabel size={9.5}>
        {author ? `@${author.handle.toUpperCase()}` : 'ROUTE'}
        {route.terrain_tags?.length ? ` — ${route.terrain_tags.join(' · ').toUpperCase()}` : ''}
      </MonoLabel>
      <Text style={st.h1}>{route.name}</Text>
      {route.description ? <Text style={st.desc}>{route.description}</Text> : null}

      {segments && segments.length > 0 && <RideMap segments={segments} style={{ marginTop: 20 }} />}

      <View style={st.strip}>
        <DataCell first label="Distance" value={Number(route.distance_km).toFixed(1)} unit="km" />
        <DataCell
          label="Shared"
          value={new Date(route.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        />
      </View>

      {/* §10: the handoff. We don't build turn-by-turn — that's the wedge. */}
      <PushButton
        label="Navigate"
        onPress={navigate}
        disabled={!segments?.length}
        height={64}
        style={{ marginTop: 26 }}
      />
      <Pressable onPress={openGoogleMaps} style={st.gmapsRow} disabled={!segments?.length}>
        <Text style={st.gmapsText}>Open waypoints in Google Maps →</Text>
      </Pressable>

      <Pressable onPress={() => router.back()} style={st.back}>
        <Text style={st.backText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 72, paddingBottom: 60 },
  photo: {
    width: '100%',
    height: 190,
    borderRadius: layout.cardRadius,
    marginBottom: 18,
    backgroundColor: color.slate,
  },
  h1: {
    fontFamily: font.display,
    fontSize: 34,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 36,
  },
  desc: { fontFamily: font.body, fontSize: 13.5, color: '#B9C0C3', lineHeight: 20, marginTop: 10 },
  strip: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.hair,
    marginTop: 20,
  },
  gmapsRow: { alignSelf: 'center', marginTop: 16, padding: 8 },
  gmapsText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
  back: { alignSelf: 'center', marginTop: 14, padding: 8 },
  backText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
