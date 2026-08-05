import { Camera, GeoJSONSource, Layer, Map as MapLibreMap } from '@maplibre/maplibre-react-native';
import { showAlert } from '../../src/components/Dialog';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GoogleAttribution } from '../../src/components/GoogleAttribution';
import { LocationPicker, PickedPlace } from '../../src/components/LocationPicker';
import { PushButton } from '../../src/components/PushButton';
import { ChipSelect, Field, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { createPlannedRoute, Difficulty, DIFFICULTY } from '../../src/lib/db';
import { HANDOFF, handOff } from '../../src/lib/handoff';
import { planRoute, RouteOption } from '../../src/lib/geo-api';
import { accent, color, font, layout, surface } from '../../src/theme/tokens';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/** A stop on the way. Start and end are just the first and last of these. */
type Stop = PickedPlace;

/**
 * Plan a route — the answer to "there are several ways from Jammu to Patnitop
 * and I want to say which one".
 *
 * Pick a start and an end and you get the ways the road network actually
 * offers. In the plains that's often two or three; in the hills it is
 * frequently one, because there IS one road. That's why via points matter
 * more here than alternatives do: adding a stop is how a rider forces the old
 * road when the router sees no reason to suggest it.
 *
 * What gets saved is the WAYPOINTS, never the computed line — Google's terms
 * restrict storing their geometry, and waypoints plus place IDs are permitted.
 * The line is redrawn from them whenever it's needed.
 */
export default function PlanRoute() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const { session } = useAuth();
  const [stops, setStops] = useState<(Stop | null)[]>([null, null]); // start, end
  const [picking, setPicking] = useState<number | null>(null);
  const [options, setOptions] = useState<RouteOption[]>([]);
  const [chosen, setChosen] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [saving, setSaving] = useState(false);

  const ready = stops.filter(Boolean).length >= 2 && stops[0] && stops[stops.length - 1];

  const fetchRoutes = useCallback(async () => {
    const set = stops.filter(Boolean) as Stop[];
    if (set.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const points = set.map((s) => [s.lng, s.lat] as [number, number]);
      const found = await planRoute(points);
      setOptions(found);
      setChosen(0);
      if (found.length === 0) setError('No road found between those points.');
    } catch (e) {
      setError((e as Error).message);
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, [stops]);

  // Any change to the stops invalidates the lines on screen.
  useEffect(() => {
    setOptions([]);
    if (ready) fetchRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(stops.map((s) => (s ? [s.lat, s.lng] : null)))]);

  const setStop = (i: number, place: PickedPlace) => {
    setStops((prev) => prev.map((s, idx) => (idx === i ? place : s)));
    // Name the route after its ends, once, and leave it editable.
    setName((cur) => {
      if (cur.trim()) return cur;
      const next = stops.map((s, idx) => (idx === i ? place : s));
      const a = next[0]?.label;
      const b = next[next.length - 1]?.label;
      return a && b ? `${a} to ${b}` : cur;
    });
  };

  const addVia = () => setStops((prev) => [...prev.slice(0, -1), null, prev[prev.length - 1]]);
  const removeStop = (i: number) => setStops((prev) => prev.filter((_, idx) => idx !== i));

  const active = options[chosen];

  const save = async () => {
    if (!session || !active || !ready) return;
    setSaving(true);
    try {
      const set = stops.filter(Boolean) as Stop[];
      const route = await createPlannedRoute(session.user.id, {
        name: name.trim() || 'Planned route',
        region: region.trim() || null,
        difficulty,
        waypoints: set.map((s) => ({
          lat: s.lat,
          lng: s.lng,
          place_id: s.place_id,
          label: s.label,
        })),
        distance_km: active.distance_km,
        crew_id: null,
      });

      // Where the rider came from decides where they go. Arriving here from the
      // ride form means this road was a detour inside planning a ride, not the
      // errand itself — so hand it back and return to the form they left, with
      // everything they had already typed still in it. Anywhere else, the route
      // IS the errand and its own screen is the right destination.
      if (returnTo === 'ride') {
        handOff(HANDOFF.plannedRoute, route);
        router.back();
      } else {
        router.replace(`/route/${route.id}`);
      }
    } catch (e) {
      showAlert('Could not save the route', (e as Error).message);
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <MonoLabel size={9}>Which way?</MonoLabel>
        <Text style={st.h1}>Plan a route</Text>

        {/* Stops, in order. First is the start, last is the end, anything
            between is a road the rider is insisting on. */}
        <View style={{ marginTop: 22 }}>
          {stops.map((s, i) => {
            const isFirst = i === 0;
            const isLast = i === stops.length - 1;
            return (
              <View key={i} style={st.stopRow}>
                <View style={st.stopMarkCol}>
                  <View style={[st.stopDot, isFirst && st.startDot, isLast && st.endDot]} />
                  {!isLast && <View style={st.stopLine} />}
                </View>
                <Pressable onPress={() => setPicking(i)} style={st.stopBtn}>
                  <View style={{ flex: 1 }}>
                    <MonoLabel size={8}>
                      {isFirst ? 'START' : isLast ? 'END' : 'VIA'}
                    </MonoLabel>
                    <Text style={[st.stopText, s && { color: color.white }]} numberOfLines={1}>
                      {s ? s.label : 'Search or drop a pin'}
                    </Text>
                  </View>
                  {!isFirst && !isLast && (
                    <Pressable onPress={() => removeStop(i)} hitSlop={10}>
                      <Feather name="x" size={16} color={color.steel} />
                    </Pressable>
                  )}
                </Pressable>
              </View>
            );
          })}

          <Pressable onPress={addVia} style={st.addVia}>
            <Feather name="plus" size={14} color={color.steel} />
            <Text style={st.addViaText}>Add a stop — force a particular road</Text>
          </Pressable>
        </View>

        {loading && (
          <View style={st.loadingRow}>
            <ActivityIndicator size="small" color={color.steel} />
            <Text style={st.loadingText}>Finding the ways there…</Text>
          </View>
        )}
        {error ? <Text style={st.error}>{error}</Text> : null}

        {active && (
          <>
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
              >
                {/* Keyed on the chosen line so switching options reframes the
                    map to that route rather than holding the old view. */}
                <Camera
                  key={`cam-${chosen}-${active.coordinates.length}`}
                  initialViewState={{ bounds: boundsOf(active.coordinates) }}
                />
                <GeoJSONSource
                  id="planned"
                  data={{
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'LineString', coordinates: active.coordinates },
                  }}
                >
                  <Layer
                    type="line"
                    id="planned-glow"
                    source="planned"
                    paint={{ 'line-color': accent.trace, 'line-width': 7, 'line-opacity': 0.2 }}
                  />
                  <Layer
                    type="line"
                    id="planned-line"
                    source="planned"
                    paint={{ 'line-color': accent.trace, 'line-width': 3 }}
                  />
                </GeoJSONSource>
              </MapLibreMap>
            </View>

            {/* The line is Google's, drawn on a MapLibre basemap — attribute it. */}
            <GoogleAttribution />

            {/* Where the network offers more than one road, the rider chooses.
                Where it offers one, this collapses to a single fact. */}
            {options.length > 1 ? (
              <View style={{ marginTop: 12, gap: 8 }}>
                {options.map((o, i) => (
                  <Pressable
                    key={o.index}
                    onPress={() => setChosen(i)}
                    style={[st.option, i === chosen && st.optionOn]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[st.optionKm, i === chosen && { color: color.white }]}>
                        {o.distance_km.toFixed(0)} km
                      </Text>
                      <Text style={st.optionTime}>{fmtDuration(o.duration_min)}</Text>
                    </View>
                    {i === chosen && <Feather name="check" size={16} color={accent.trace} />}
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={st.oneRoad}>
                {active.distance_km.toFixed(0)} km · {fmtDuration(active.duration_min)} — one road
                goes this way. Add a stop to send it another.
              </Text>
            )}

            <Field
              label="Name this route"
              value={name}
              onChangeText={setName}
              placeholder="Jammu to Patnitop, the old way"
              autoCapitalize="sentences"
              style={{ marginTop: 22 }}
            />
            <Field
              label="Region"
              value={region}
              onChangeText={setRegion}
              placeholder="Jammu & Kashmir"
              autoCapitalize="words"
              style={{ marginTop: 16 }}
            />
            <ChipSelect
              label="How hard is it?"
              options={DIFFICULTY}
              value={difficulty}
              onChange={setDifficulty}
              clearable
              style={{ marginTop: 20 }}
            />

            <PushButton
              label="Save this route"
              onPress={save}
              disabled={saving || !name.trim()}
              style={{ marginTop: 26 }}
            />
          </>
        )}

        <Pressable onPress={() => router.back()} style={st.cancel}>
          <Text style={st.cancelText}>Cancel</Text>
        </Pressable>
      </ScrollView>

      <LocationPicker
        visible={picking !== null}
        onClose={() => setPicking(null)}
        title={
          picking === 0
            ? 'Start where?'
            : picking === stops.length - 1
              ? 'End where?'
              : 'Go via where?'
        }
        initial={picking !== null ? stops[picking] : null}
        onPick={(p) => {
          if (picking !== null) setStop(picking, p);
          setPicking(null);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h ${min % 60}m` : `${min}m`;
}

/** [west, south, east, north] with a margin, so the whole route sits inside
 *  the frame rather than touching its edges. */
function boundsOf(coords: [number, number][]): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < w) w = lng;
    if (lng > e) e = lng;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  const padX = Math.max((e - w) * 0.15, 0.01);
  const padY = Math.max((n - s) * 0.15, 0.01);
  return [w - padX, s - padY, e + padX, n + padY];
}

const st = StyleSheet.create({
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 74, paddingBottom: 60 },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 8,
    lineHeight: 40,
  },
  stopRow: { flexDirection: 'row', gap: 12 },
  stopMarkCol: { width: 14, alignItems: 'center', paddingTop: 20 },
  stopDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: color.steel,
  },
  startDot: { borderColor: accent.trace },
  endDot: { backgroundColor: accent.trace, borderColor: accent.trace },
  stopLine: { flex: 1, width: 1, backgroundColor: color.hair, marginVertical: 4 },
  stopBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    backgroundColor: surface.raised,
  },
  stopText: { fontFamily: font.body, fontSize: 14.5, color: color.steel, marginTop: 4 },
  addVia: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginLeft: 26,
    paddingVertical: 8,
  },
  addViaText: { fontFamily: font.body, fontSize: 12.5, color: color.steel },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  loadingText: { fontFamily: font.body, fontSize: 12.5, color: color.steel },
  error: { fontFamily: font.body, fontSize: 12.5, color: color.amber, marginTop: 14, lineHeight: 18 },
  mapWrap: {
    height: 260,
    marginTop: 18,
    borderRadius: layout.cardRadius,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.hair,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    backgroundColor: surface.raised,
  },
  optionOn: { borderColor: color.disabled, backgroundColor: surface.overlay },
  optionKm: {
    fontFamily: font.displaySemi,
    fontSize: 18,
    color: color.steel,
    fontVariant: ['tabular-nums'],
  },
  optionTime: { fontFamily: font.body, fontSize: 12, color: color.dim, marginTop: 3 },
  oneRoad: {
    fontFamily: font.body,
    fontSize: 12.5,
    color: color.steel,
    marginTop: 12,
    lineHeight: 18,
  },
  cancel: { alignSelf: 'center', marginTop: 18, padding: 8 },
  cancelText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
