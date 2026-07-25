import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
} from '@maplibre/maplibre-react-native';
import { showAlert } from '../../src/components/Dialog';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { createPrivacyZone } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const RADII = [250, 500, 1000, 2000] as const;
// Fallback center: middle of the first cohort's world, not a Silicon Valley default.
const FALLBACK: [number, number] = [77.17, 31.1]; // Himachal

function circle(center: [number, number], radiusM: number): GeoJSON.GeoJSON {
  const [lng, lat] = center;
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const coords: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

/**
 * Zone editor: drag the map, the circle stays pinned to the center —
 * glove-friendly, no polygon vertex fiddling. Saved as a polygon; clipping
 * takes effect immediately, past rides included.
 */
export default function NewZone() {
  const { session } = useAuth();
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [start, setStart] = useState<[number, number] | null>(null);
  const [radius, setRadius] = useState<(typeof RADII)[number]>(500);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.granted) {
        const pos =
          (await Location.getLastKnownPositionAsync()) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null));
        if (pos) {
          const c: [number, number] = [pos.coords.longitude, pos.coords.latitude];
          setStart(c);
          setCenter(c);
          return;
        }
      }
      setStart(FALLBACK);
      setCenter(FALLBACK);
    })();
  }, []);

  const save = async () => {
    if (!session || !center) return;
    setBusy(true);
    try {
      await createPrivacyZone(session.user.id, label.trim() || null, center[0], center[1], radius);
      router.back();
    } catch (e) {
      showAlert('Could not save zone', (e as Error).message);
      setBusy(false);
    }
  };

  if (!start) return <View style={st.root} />;

  return (
    <View style={st.root}>
      <View style={st.mapWrap}>
        <MapLibreMap
          logo={false}
          attributionPosition={{ top: 110, right: 10 }}
          style={{ flex: 1 }}
          mapStyle={STYLE_URL}
          touchPitch={false}
          touchRotate={false}
          compass={false}
          scaleBar={false}
          onRegionDidChange={(e) => {
            const c = e.nativeEvent.center;
            if (c) setCenter([c[0], c[1]]);
          }}
        >
          <Camera initialViewState={{ center: start, zoom: 13 }} />
          {center && (
            <GeoJSONSource id="zone" data={circle(center, radius)}>
              <Layer
                type="fill"
                id="zone-fill"
                source="zone"
                paint={{ 'fill-color': color.amber, 'fill-opacity': 0.12 }}
              />
              <Layer
                type="line"
                id="zone-line"
                source="zone"
                paint={{ 'line-color': color.amber, 'line-width': 1.5, 'line-dasharray': [2, 2] }}
              />
            </GeoJSONSource>
          )}
        </MapLibreMap>
        {/* crosshair — the zone follows the map center */}
        <View pointerEvents="none" style={st.crosshair}>
          <View style={st.crossDot} />
        </View>
      </View>

      <View style={st.panel}>
        <MonoLabel size={8.5} style={{ marginBottom: 8 }}>
          Radius
        </MonoLabel>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {RADII.map((r) => (
            <Pressable
              key={r}
              onPress={() => setRadius(r)}
              style={[st.chip, r === radius && st.chipOn]}
            >
              <Text style={[st.chipText, r === radius && { color: color.white }]}>
                {r < 1000 ? `${r} M` : `${r / 1000} KM`}
              </Text>
            </Pressable>
          ))}
        </View>

        <Field
          label="Label (just for you)"
          value={label}
          onChangeText={setLabel}
          placeholder="Home"
          autoCapitalize="words"
          style={{ marginTop: 16 }}
        />

        <PushButton label="Save zone" onPress={save} disabled={busy || !center} style={{ marginTop: 20 }} />
        <Pressable onPress={() => router.back()} style={st.cancel}>
          <Text style={st.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  mapWrap: { flex: 1 },
  crosshair: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crossDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.signal,
    borderWidth: 2,
    borderColor: color.void,
  },
  panel: {
    padding: layout.screenPadding,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderTopColor: color.hair,
    backgroundColor: color.void,
  },
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
  cancel: { alignSelf: 'center', marginTop: 14, padding: 8 },
  cancelText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
