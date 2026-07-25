import * as ImageManipulator from 'expo-image-manipulator';
import { showAlert } from '../../src/components/Dialog';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import {
  createRoute,
  getRide,
  ownTrackSegments,
  Ride,
  updateRoutePhoto,
  uploadRoutePhoto,
} from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

const TERRAIN = ['tarmac', 'broken', 'unpaved', 'snow'] as const;

/**
 * The lowest-friction screen in the app (§9): one photo, one line, stats
 * pre-filled. Every field beyond that costs contributions — this is the
 * core loop.
 */
export default function ShareRoute() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const { session } = useAuth();
  const [ride, setRide] = useState<Ride | null>(null);
  const [segments, setSegments] = useState<[number, number][][] | null>(null);
  const [name, setName] = useState('');
  const [line, setLine] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!rideId) return;
    getRide(rideId)
      .then((r) => {
        setRide(r);
        if (r?.title) setName(r.title);
      })
      .catch(() => {});
    ownTrackSegments(rideId).then(setSegments).catch(() => setSegments(null));
  }, [rideId]);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 1,
      allowsMultipleSelection: false,
    });
    if (!res.canceled && res.assets[0]) setPhotoUri(res.assets[0].uri);
  };

  const share = async () => {
    if (!session || !ride || !segments) return;
    setBusy(true);
    try {
      const route = await createRoute(session.user.id, {
        source_ride_id: ride.id,
        name: name.trim(),
        description: line.trim() || null,
        terrain_tags: tags,
        distance_km: Number(ride.distance_km),
        segments,
      });
      if (photoUri) {
        // One photo, resized client-side to the agreed ceiling (1600px / 85%).
        const resized = await ImageManipulator.manipulateAsync(
          photoUri,
          [{ resize: { width: 1600 } }],
          { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
        );
        const bytes = await new File(resized.uri).arrayBuffer();
        const url = await uploadRoutePhoto(session.user.id, route.id, bytes);
        await updateRoutePhoto(route.id, url);
      }
      router.replace(`/route/${route.id}`);
    } catch (e) {
      showAlert('Could not share', (e as Error).message);
      setBusy(false);
    }
  };

  const km = ride ? Number(ride.distance_km).toFixed(1) : '—';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <MonoLabel size={9}>
          {km} KM · PRE-FILLED FROM YOUR RIDE
        </MonoLabel>
        <Text style={st.h1}>Share as route</Text>

        <Pressable onPress={pickPhoto} style={st.photoBox}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={st.photo} resizeMode="cover" />
          ) : (
            <View style={st.photoEmpty}>
              <MonoLabel size={9}>Add one photo</MonoLabel>
              <Text style={st.photoHint}>The view from the road sells the road.</Text>
            </View>
          )}
        </Pressable>

        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Sangla–Chitkul road"
          autoCapitalize="sentences"
          style={{ marginTop: 20 }}
        />
        <Field
          label="One line for the next rider"
          value={line}
          onChangeText={setLine}
          placeholder="Broken patches after the bridge, worth it for the last 10 km."
          autoCapitalize="sentences"
          style={{ marginTop: 16 }}
        />

        <MonoLabel size={8.5} style={{ marginTop: 20, marginBottom: 8 }}>
          Terrain
        </MonoLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TERRAIN.map((t) => {
            const on = tags.includes(t);
            return (
              <Pressable
                key={t}
                onPress={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
                style={[st.chip, on && st.chipOn]}
              >
                <Text style={[st.chipText, on && { color: color.white }]}>{t.toUpperCase()}</Text>
              </Pressable>
            );
          })}
        </View>

        <PushButton
          label="Share route"
          onPress={share}
          disabled={busy || !name.trim() || !segments || segments.flat().length < 2}
          style={{ marginTop: 30 }}
        />
        {segments !== null && segments.flat().length < 2 && (
          <Text style={st.noTrack}>This ride has no track — routes need a recorded line.</Text>
        )}

        <Pressable onPress={() => router.back()} style={st.back}>
          <Text style={st.backText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 72, paddingBottom: 60 },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 40,
  },
  photoBox: {
    marginTop: 22,
    height: 180,
    borderRadius: layout.cardRadius,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
  },
  photo: { width: '100%', height: '100%' },
  photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoHint: { fontFamily: font.body, fontSize: 12, color: color.dim },
  chip: {
    borderWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipOn: { borderColor: color.disabled, backgroundColor: color.slate2 },
  chipText: { fontFamily: font.mono, fontSize: 9, letterSpacing: 1, color: color.steel },
  noTrack: { fontFamily: font.body, fontSize: 12, color: color.amber, marginTop: 12 },
  back: { alignSelf: 'center', marginTop: 20, padding: 8 },
  backText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
