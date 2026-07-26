import { Camera, Map as MapLibreMap } from '@maplibre/maplibre-react-native';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PlaceResult, searchPlaces } from '../lib/geo-api';
import { GoogleAttribution } from './GoogleAttribution';
import { accent, color, font, layout, radius, surface } from '../theme/tokens';
import { PushButton } from './PushButton';
import { Sheet } from './Sheet';
import { MonoLabel } from './ui';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

export type PickedPlace = {
  lat: number;
  lng: number;
  label: string;
  place_id: string | null;
};

/**
 * Pick a place: search for it, or drop it on the map.
 *
 * Both halves matter. Search is how a rider says "city chowk jammu" without
 * knowing where that is on a map; the map is how they say "here, this
 * turning", which no search index contains. The crosshair pattern is the same
 * one the privacy-zone editor uses — the point is wherever the map is centred.
 *
 * A searched place keeps its Google place_id (the one field their terms let us
 * store); a dropped pin has none, because it is the rider's own coordinate.
 */
export function LocationPicker({
  visible,
  onClose,
  onPick,
  title = 'Where?',
  initial,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (place: PickedPlace) => void;
  title?: string;
  initial?: { lat: number; lng: number } | null;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'search' | 'map'>('search');
  const [centre, setCentre] = useState<[number, number] | null>(
    initial ? [initial.lng, initial.lat] : null
  );
  const [label, setLabel] = useState('');
  const near = useRef<{ lat: number; lng: number } | undefined>(undefined);

  // Bias results to the rider's own region — a coarse fix is plenty, and this
  // never blocks the picker if permission is denied.
  useEffect(() => {
    if (!visible) return;
    Location.getLastKnownPositionAsync()
      .then((p) => {
        if (!p) return;
        near.current = { lat: p.coords.latitude, lng: p.coords.longitude };
        if (!centre) setCentre([p.coords.longitude, p.coords.latitude]);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    setError(null);
    const t = setTimeout(() => {
      searchPlaces(query.trim(), near.current)
        .then(setResults)
        .catch((e) => setError((e as Error).message))
        .finally(() => setSearching(false));
    }, 350); // debounce: every keystroke is a billed request otherwise
    return () => clearTimeout(t);
  }, [query]);

  const choose = (p: PlaceResult) => {
    onPick({ lat: p.lat, lng: p.lng, label: p.name, place_id: p.place_id });
    reset();
  };

  const confirmPin = () => {
    if (!centre) return;
    onPick({
      lng: centre[0],
      lat: centre[1],
      label: label.trim() || 'Dropped pin',
      place_id: null,
    });
    reset();
  };

  const reset = () => {
    setQuery('');
    setResults([]);
    setLabel('');
    setMode('search');
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={reset} label="Meeting point" title={title}>
      <View style={st.toggle}>
        {(['search', 'map'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={[st.toggleBtn, mode === m && st.toggleOn]}
          >
            <Text style={[st.toggleText, mode === m && { color: color.white }]}>
              {m === 'search' ? 'SEARCH' : 'DROP A PIN'}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode === 'search' ? (
        <View style={{ marginTop: 16 }}>
          <View style={st.searchRow}>
            <Feather name="search" size={16} color={color.steel} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="City Chowk, Jammu"
              placeholderTextColor={color.dim}
              style={st.searchInput}
              autoFocus
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color={color.steel} />}
          </View>

          {error ? <Text style={st.error}>{error}</Text> : null}

          {results.map((r) => (
            <Pressable key={r.place_id} onPress={() => choose(r)}>
              {({ pressed }) => (
                <View style={[st.result, pressed && { backgroundColor: color.slate2 }]}>
                  <Feather name="map-pin" size={15} color={accent.trace} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.resultName}>{r.name}</Text>
                    <Text style={st.resultAddr} numberOfLines={1}>
                      {r.address}
                    </Text>
                  </View>
                </View>
              )}
            </Pressable>
          ))}

          {!searching && !error && query.trim().length >= 2 && results.length === 0 && (
            <Text style={st.empty}>
              Nothing by that name. Try the map instead — some turnings have no address.
            </Text>
          )}

          {/* These results are Google's; say so wherever they appear. */}
          {results.length > 0 && <GoogleAttribution />}
        </View>
      ) : (
        <View style={{ marginTop: 16 }}>
          <View style={st.mapWrap}>
            <MapLibreMap
              logo={false}
              attributionPosition={{ bottom: 8, right: 8 }}
              style={{ flex: 1 }}
              mapStyle={STYLE_URL}
              touchPitch={false}
              touchRotate={false}
              compass={false}
              scaleBar={false}
              onRegionDidChange={(e) => {
                const c = e.nativeEvent.center;
                if (c) setCentre([c[0], c[1]]);
              }}
            >
              <Camera
                initialViewState={{ center: centre ?? [77.57, 32.24], zoom: 13 }}
              />
            </MapLibreMap>
            <View pointerEvents="none" style={st.crosshair}>
              <View style={st.crossDot} />
            </View>
          </View>

          <MonoLabel size={8.5} style={{ marginTop: 14, marginBottom: 7 }}>
            Call it something
          </MonoLabel>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder="The dhaba past the bridge"
            placeholderTextColor={color.dim}
            style={st.labelInput}
          />

          <PushButton
            label="Use this point"
            onPress={confirmPin}
            disabled={!centre}
            style={{ marginTop: 16, marginBottom: 8 }}
          />
        </View>
      )}
    </Sheet>
  );
}

const st = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: surface.raised,
    borderWidth: 1,
    borderColor: surface.stroke,
    borderRadius: radius.chip,
    padding: 4,
  },
  toggleBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 7 },
  toggleOn: { backgroundColor: surface.overlay },
  toggleText: { fontFamily: font.mono, fontSize: 8.5, letterSpacing: 1.3, color: color.dim },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: color.slate2,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  searchInput: { flex: 1, fontFamily: font.body, fontSize: 15, color: color.white },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
  },
  resultName: { fontFamily: font.bodySemi, fontSize: 14, color: color.white },
  resultAddr: { fontFamily: font.body, fontSize: 11.5, color: color.steel, marginTop: 3 },
  empty: { fontFamily: font.body, fontSize: 12.5, color: color.dim, marginTop: 16, lineHeight: 18 },
  error: { fontFamily: font.body, fontSize: 12.5, color: color.amber, marginTop: 14, lineHeight: 18 },
  mapWrap: {
    height: 240,
    borderRadius: layout.cardRadius,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.hair,
  },
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
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: accent.trace,
    borderWidth: 2,
    borderColor: color.void,
  },
  labelInput: {
    backgroundColor: color.slate2,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: color.white,
    fontFamily: font.body,
    fontSize: 15,
  },
});
