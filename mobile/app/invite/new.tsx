import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Feather } from '@expo/vector-icons';

import { LocationPicker, PickedPlace } from '../../src/components/LocationPicker';
import { PushButton } from '../../src/components/PushButton';
import { Sheet } from '../../src/components/Sheet';
import { ChipSelect, Field, MonoLabel, YesNo } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import {
  BikeType,
  createInvite,
  Crew,
  Difficulty,
  DIFFICULTY,
  Experience,
  listCrews,
  myCrewIds,
  pickableRoutes,
  Route,
} from '../../src/lib/db';
import { accent, color, font, layout } from '../../src/theme/tokens';

const BIKE_CHOICES: (BikeType | 'any')[] = [
  'any',
  'naked',
  'sport',
  'adv',
  'cruiser',
  'scrambler',
  'tourer',
];
const EXP_CHOICES: (Experience | 'any')[] = ['any', 'beginner', 'intermediate', 'advanced'];

/** Plan a ride: when, where, and who it suits — the last of which is what
 *  stops a first-week rider turning up to a 300km mountain run (item 7). */
export default function NewInvite() {
  const { crewId: presetCrew } = useLocalSearchParams<{ crewId?: string }>();
  const { session, profile } = useAuth();
  const [myCrews, setMyCrews] = useState<Crew[]>([]);
  const [scope, setScope] = useState<string | null>(presetCrew ?? null); // null = public board
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date(Date.now() + 86400e3).toISOString().slice(0, 10));
  const [time, setTime] = useState('06:00');
  const [meetup, setMeetup] = useState('');
  const [region, setRegion] = useState(profile?.home_region ?? '');
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [bike, setBike] = useState<BikeType | 'any' | null>(null);
  const [gear, setGear] = useState<boolean | null>(null);
  const [exp, setExp] = useState<Experience | 'any' | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickingRoute, setPickingRoute] = useState(false);
  const [pickingPlace, setPickingPlace] = useState(false);
  const [meetPoint, setMeetPoint] = useState<PickedPlace | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routes, setRoutes] = useState<{ mine: Route[]; curated: Route[] }>({
    mine: [],
    curated: [],
  });

  useEffect(() => {
    if (!session) return;
    Promise.all([listCrews(), myCrewIds(session.user.id)])
      .then(([all, mine]) => setMyCrews(all.filter((c) => mine.has(c.id))))
      .catch(() => {});
    pickableRoutes(session.user.id).then(setRoutes).catch(() => {});
  }, [session]);

  /** Picking a route names the ride for you — the title stays editable, since
   *  "Sach Pass with the Sunday crew" is a better ride name than the road's. */
  const selectRoute = (r: Route) => {
    setRoute(r);
    setPickingRoute(false);
    if (!title.trim()) setTitle(r.name);
  };

  const startsAt = new Date(`${date}T${time}:00`);
  const valid =
    title.trim().length >= 3 && !Number.isNaN(+startsAt) && +startsAt > Date.now() - 3600e3;

  const submit = async () => {
    if (!session || !valid) return;
    setBusy(true);
    try {
      await createInvite(session.user.id, {
        crew_id: scope,
        // A picked route is used as-is; otherwise createInvite makes the
        // adhoc route from what was typed here.
        route_id: route?.id ?? null,
        title: title.trim(),
        meetup: meetup.trim() || null,
        meetup_point: meetPoint
          ? { lat: meetPoint.lat, lng: meetPoint.lng, place_id: meetPoint.place_id }
          : null,
        region: route ? route.region : scope ? null : region.trim() || null,
        starts_at: startsAt,
        difficulty: route ? route.difficulty : difficulty,
        bike_category: bike,
        gear_required: gear,
        min_experience: exp,
      });
      router.back();
    } catch (e) {
      Alert.alert('Could not post', (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: color.void }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <MonoLabel size={9}>Who's in?</MonoLabel>
        <Text style={st.h1}>Plan a ride</Text>

        {/* The route comes first: a planned ride is a plan to ride something.
            Pick one, or just name it — either way it becomes a real Route. */}
        <MonoLabel size={8.5} style={{ marginTop: 24, marginBottom: 8 }}>
          Route
        </MonoLabel>
        <Pressable onPress={() => setPickingRoute(true)} style={st.picker}>
          <View style={{ flex: 1 }}>
            <Text style={st.pickerValue} numberOfLines={1}>
              {route ? route.name : 'Just naming it'}
            </Text>
            {route ? (
              <Text style={st.pickerSub} numberOfLines={1}>
                {[
                  route.source === 'curated' ? 'Curated' : 'Your route',
                  route.region,
                  route.distance_km ? `${Number(route.distance_km).toFixed(0)} km` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : (
              <Text style={st.pickerSub}>No map — just a name and a meeting point</Text>
            )}
          </View>
          <Feather name="chevron-down" size={16} color={color.steel} />
        </Pressable>

        <Field
          label="Ride"
          value={title}
          onChangeText={setTitle}
          placeholder="Dawn run to Sonamarg"
          autoCapitalize="sentences"
          style={{ marginTop: 16 }}
        />
        <View style={{ flexDirection: 'row', gap: 14, marginTop: 16 }}>
          <Field label="Date" value={date} onChangeText={setDate} placeholder="2026-07-20" style={{ flex: 1 }} />
          <Field label="Time" value={time} onChangeText={setTime} placeholder="06:00" style={{ flex: 1 }} />
        </View>
        {/* The words are still the words a rider reads — "kickstands up at
            six" isn't a coordinate. The point underneath is what makes it
            navigable. */}
        <Field
          label="Meetup"
          value={meetup}
          onChangeText={setMeetup}
          placeholder="Nishat gate, kickstands up at six"
          autoCapitalize="sentences"
          style={{ marginTop: 16 }}
        />
        <Pressable onPress={() => setPickingPlace(true)} style={st.placeRow}>
          <Feather name="map-pin" size={15} color={meetPoint ? accent.trace : color.steel} />
          <Text style={[st.placeText, meetPoint && { color: color.white }]} numberOfLines={1}>
            {meetPoint ? meetPoint.label : 'Pin it on the map'}
          </Text>
          {meetPoint ? (
            <Pressable onPress={() => setMeetPoint(null)} hitSlop={10}>
              <Feather name="x" size={15} color={color.steel} />
            </Pressable>
          ) : (
            <Feather name="chevron-right" size={15} color={color.dim} />
          )}
        </Pressable>

        {/* A chip row grows with the crew count and eats the screen at 50 of
            them. One row, one sheet, scrolls forever. */}
        <MonoLabel size={8.5} style={{ marginTop: 20, marginBottom: 8 }}>
          Posts to
        </MonoLabel>
        <Pressable onPress={() => setPicking(true)} style={st.picker}>
          <Text style={st.pickerValue} numberOfLines={1}>
            {scope === null ? 'Public board' : myCrews.find((c) => c.id === scope)?.name ?? 'Crew'}
          </Text>
          <Feather name="chevron-down" size={16} color={color.steel} />
        </Pressable>
        {/* Region and difficulty belong to the Route. With one picked they're
            read-only facts about that road; without, they're what defines the
            adhoc route this ride creates. */}
        {scope === null &&
          (route ? (
            <View style={{ marginTop: 16 }}>
              <MonoLabel size={8.5} style={{ marginBottom: 7 }}>
                Region
              </MonoLabel>
              <Text style={st.readonly}>{route.region ?? '—'}</Text>
            </View>
          ) : (
            <Field
              label="Region"
              value={region}
              onChangeText={setRegion}
              placeholder="Kashmir"
              autoCapitalize="words"
              style={{ marginTop: 16 }}
            />
          ))}

        {route ? (
          <View style={{ marginTop: 28 }}>
            <MonoLabel size={8.5} style={{ marginBottom: 7 }}>
              How hard is the route?
            </MonoLabel>
            <Text style={st.readonly}>
              {route.difficulty ? route.difficulty.toUpperCase() : 'NOT RATED'}
            </Text>
          </View>
        ) : (
          /* A property of the road, so it's stated, never asked back. */
          <ChipSelect
            label="How hard is the route?"
            options={DIFFICULTY}
            value={difficulty}
            onChange={setDifficulty}
            clearable
            style={{ marginTop: 28 }}
          />
        )}

        <View style={st.divider} />
        <MonoLabel size={9}>Who it suits</MonoLabel>
        <Text style={st.note}>
          Optional. Whatever you set here gets asked of everyone who joins — leave it blank and
          they're asked nothing.
        </Text>

        <ChipSelect
          label="Bike"
          options={BIKE_CHOICES}
          value={bike}
          onChange={setBike}
          clearable
          style={{ marginTop: 20 }}
        />
        <YesNo label="Full gear required" value={gear} onChange={setGear} clearable style={{ marginTop: 20 }} />
        <ChipSelect
          label="Riding experience"
          options={EXP_CHOICES}
          value={exp}
          onChange={setExp}
          clearable
          style={{ marginTop: 20 }}
        />

        <PushButton label="Post the ride" onPress={submit} disabled={busy || !valid} style={{ marginTop: 30 }} />
        <Pressable onPress={() => router.back()} style={st.cancel}>
          <Text style={st.cancelText}>Cancel</Text>
        </Pressable>
      </ScrollView>

      <LocationPicker
        visible={pickingPlace}
        onClose={() => setPickingPlace(false)}
        title="Where do you meet?"
        initial={meetPoint}
        onPick={(p) => {
          setMeetPoint(p);
          // A blank meetup line gets the place's name; anything the rider
          // already wrote is theirs and stays untouched.
          if (!meetup.trim()) setMeetup(p.label);
        }}
      />

      <Sheet
        visible={pickingRoute}
        onClose={() => setPickingRoute(false)}
        label="Route"
        title="What are you riding?"
      >
        <PickRow
          label="Just name it"
          sub="No map — a name and a meeting point is enough"
          on={route === null}
          onPress={() => {
            setRoute(null);
            setPickingRoute(false);
          }}
        />
        {/* The way out of "none of these": draw the road you mean. */}
        <PickRow
          label="Plan a new route"
          sub="Pick a start and end — and a via point to force a particular road"
          on={false}
          onPress={() => {
            setPickingRoute(false);
            router.push('/route/plan');
          }}
        />
        {routes.curated.length > 0 && (
          <MonoLabel size={8.5} style={{ marginTop: 18, marginBottom: 4 }}>
            Curated
          </MonoLabel>
        )}
        {routes.curated.map((r) => (
          <PickRow
            key={r.id}
            label={r.name}
            sub={[r.region, r.difficulty, r.distance_km ? `${Number(r.distance_km).toFixed(0)} km` : null]
              .filter(Boolean)
              .join(' · ')}
            on={route?.id === r.id}
            onPress={() => selectRoute(r)}
          />
        ))}
        {routes.mine.length > 0 && (
          <MonoLabel size={8.5} style={{ marginTop: 18, marginBottom: 4 }}>
            My routes
          </MonoLabel>
        )}
        {routes.mine.map((r) => (
          <PickRow
            key={r.id}
            label={r.name}
            sub={[r.region, r.difficulty, r.distance_km ? `${Number(r.distance_km).toFixed(0)} km` : null]
              .filter(Boolean)
              .join(' · ')}
            on={route?.id === r.id}
            onPress={() => selectRoute(r)}
          />
        ))}
        {routes.curated.length === 0 && routes.mine.length === 0 && (
          <Text style={st.note}>
            No saved routes yet — share a ride as a route and it shows up here.
          </Text>
        )}
      </Sheet>

      <Sheet visible={picking} onClose={() => setPicking(false)} label="Posts to" title="Where does it go?">
        <PickRow
          label="Public board"
          sub="Any signed-in rider can see it and join"
          on={scope === null}
          onPress={() => {
            setScope(null);
            setPicking(false);
          }}
        />
        {myCrews.map((c) => (
          <PickRow
            key={c.id}
            label={c.name}
            sub={[c.region, `${c.member_count ?? 0} riders`].filter(Boolean).join(' · ')}
            on={scope === c.id}
            onPress={() => {
              setScope(c.id);
              setPicking(false);
            }}
          />
        ))}
        {myCrews.length === 0 && (
          <Text style={st.note}>You&apos;re not in any crews yet — the board it is.</Text>
        )}
      </Sheet>
    </KeyboardAvoidingView>
  );
}

function PickRow({
  label,
  sub,
  on,
  onPress,
}: {
  label: string;
  sub: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={[st.pickRow, pressed && { backgroundColor: color.slate2 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[st.pickLabel, on && { color: color.white }]}>{label}</Text>
            {sub ? <Text style={st.pickSub}>{sub}</Text> : null}
          </View>
          {on && <Feather name="check" size={17} color={color.white} />}
        </View>
      )}
    </Pressable>
  );
}

const st = StyleSheet.create({
  content: { paddingHorizontal: layout.screenPadding, paddingTop: 84, paddingBottom: 60 },
  h1: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 8,
    lineHeight: 40,
  },
  divider: { height: 1, backgroundColor: color.hair, marginTop: 30, marginBottom: 22 },
  note: { fontFamily: font.body, fontSize: 12, color: color.dim, lineHeight: 18, marginTop: 8 },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: color.slate2,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  pickerValue: { fontFamily: font.body, fontSize: 15, color: color.white },
  pickerSub: { fontFamily: font.body, fontSize: 11.5, color: color.steel, marginTop: 3 },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    backgroundColor: color.slate,
  },
  placeText: { flex: 1, fontFamily: font.body, fontSize: 13.5, color: color.steel },
  readonly: {
    fontFamily: font.body,
    fontSize: 15,
    color: color.steel,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: color.slate,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
  },
  pickLabel: { fontFamily: font.bodySemi, fontSize: 15, color: color.white },
  pickSub: { fontFamily: font.body, fontSize: 11.5, color: color.steel, marginTop: 3 },
  cancel: { alignSelf: 'center', marginTop: 16, padding: 8 },
  cancelText: { fontFamily: font.bodyMedium, fontSize: 13, color: color.steel },
});
