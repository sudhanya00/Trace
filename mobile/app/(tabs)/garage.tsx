import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PushButton } from '../../src/components/PushButton';
import { Card, MonoLabel } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { Bike, listBikes, rideCountsByBike } from '../../src/lib/db';
import { color, font, layout } from '../../src/theme/tokens';

const fmtKm = (n: number) => Math.round(n).toLocaleString('en-IN');

export default function Garage() {
  const { profile } = useAuth();
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [rideCounts, setRideCounts] = useState<Map<string, number>>(new Map());

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      Promise.all([listBikes(), rideCountsByBike()])
        .then(([b, c]) => {
          if (alive) {
            setBikes(b);
            setRideCounts(c);
          }
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [])
  );

  const activeBikes = bikes.filter((b) => b.is_active);
  const lifetimeKm = bikes.reduce((s, b) => s + Number(b.current_odometer_km), 0);
  const totalRides = [...rideCounts.values()].reduce((s, n) => s + n, 0);
  // The bike the next ride defaults to: newest active. Carries the signal edge.
  const currentBikeId = activeBikes.length
    ? activeBikes[activeBikes.length - 1].id
    : null;

  const eyebrow = [profile?.handle, profile?.home_region]
    .filter(Boolean)
    .join(' — ')
    .toUpperCase();

  return (
    <View style={st.root}>
      <View style={st.head}>
        {eyebrow ? <MonoLabel size={9.5}>{eyebrow}</MonoLabel> : null}
        <Text style={st.h1}>Garage</Text>
        <View style={st.totals}>
          <Total label="Lifetime" value={fmtKm(lifetimeKm)} unit="km" />
          <Total label="Rides" value={String(totalRides)} />
          <Total label="Bikes" value={String(bikes.length)} />
        </View>
      </View>

      <FlatList
        data={bikes}
        keyExtractor={(b) => b.id}
        contentContainerStyle={st.list}
        renderItem={({ item }) => (
          <BikeCard
            bike={item}
            rides={rideCounts.get(item.id) ?? 0}
            isCurrent={item.id === currentBikeId}
          />
        )}
        ListFooterComponent={
          <PushButton
            label="Add a bike"
            variant="slate"
            onPress={() => router.push('/bike/new')}
            style={{ marginTop: 6 }}
          />
        }
      />
    </View>
  );
}

function Total({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={{ marginRight: 26 }}>
      <MonoLabel size={8.5}>{label}</MonoLabel>
      <Text style={st.totalValue} allowFontScaling={false}>
        {value}
        {unit ? <Text style={st.totalUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

function BikeCard({ bike, rides, isCurrent }: { bike: Bike; rides: number; isCurrent: boolean }) {
  const sub = [bike.year, bike.mods].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={() => router.push(`/bike/${bike.id}`)}>
      {({ pressed }) => (
      <Card active={isCurrent} pressed={pressed} style={{ marginBottom: 12 }}>
        <View style={st.bikeTop}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={st.bikeName}>
              {bike.make} {bike.model}
            </Text>
            {sub ? <MonoLabel size={9.5} style={{ marginTop: 5, letterSpacing: 1 }}>{sub}</MonoLabel> : null}
          </View>
          <Tag kind={bike.is_active ? (isCurrent ? 'active' : 'resting') : 'retired'} />
        </View>
        <View style={st.bikeStats}>
          <Stat label="Odometer" value={fmtKm(Number(bike.current_odometer_km))} unit="km" />
          <Stat label="Rides" value={String(rides)} />
        </View>
      </Card>
      )}
    </Pressable>
  );
}

function Tag({ kind }: { kind: 'active' | 'resting' | 'retired' }) {
  const isActive = kind === 'active';
  return (
    <View style={[st.tag, isActive ? st.tagActive : st.tagRest]}>
      <Text style={[st.tagText, { color: isActive ? color.signal : '#8FA3BC' }]}>
        {kind.toUpperCase()}
      </Text>
    </View>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={{ marginRight: 22 }}>
      <MonoLabel size={8}>{label}</MonoLabel>
      <Text style={st.statValue} allowFontScaling={false}>
        {value}
        {unit ? <Text style={st.statUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  head: { paddingHorizontal: layout.screenPadding, paddingTop: 64 },
  h1: {
    fontFamily: font.display,
    fontSize: 41,
    color: color.white,
    textTransform: 'uppercase',
    marginTop: 7,
    lineHeight: 42,
  },
  totals: {
    flexDirection: 'row',
    marginTop: 16,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: color.hair,
  },
  totalValue: {
    fontFamily: font.display,
    fontSize: 23,
    color: color.white,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
    lineHeight: 24,
  },
  totalUnit: { fontSize: 11, color: color.steel, fontFamily: font.displayMedium },

  list: { padding: layout.screenPadding, paddingTop: 18, paddingBottom: 110 },
  bikeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  bikeName: {
    fontFamily: font.display,
    fontSize: 23,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 25,
  },
  tag: { paddingHorizontal: 7, paddingVertical: 3.5, borderRadius: 3, borderWidth: 1 },
  tagActive: { backgroundColor: 'rgba(46,125,255,.14)', borderColor: 'rgba(46,125,255,.3)' },
  tagRest: { backgroundColor: 'rgba(63,85,112,.2)', borderColor: 'rgba(63,85,112,.42)' },
  tagText: { fontFamily: font.mono, fontSize: 8, letterSpacing: 1.2 },

  bikeStats: { flexDirection: 'row' },
  statValue: {
    fontFamily: font.displaySemi,
    fontSize: 17,
    color: color.white,
    fontVariant: ['tabular-nums'],
    marginTop: 3,
    lineHeight: 18,
  },
  statUnit: { fontSize: 9.5, color: color.steel },
});
