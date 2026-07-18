import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PushButton } from '../components/PushButton';
import { Card, MonoLabel } from '../components/ui';
import { useAuth } from '../lib/auth';
import { Bike, bikeSubtitle, bikeTitle, listBikes, rideCountsByBike } from '../lib/db';
import { color, font } from '../theme/tokens';

const fmtKm = (n: number) => Math.round(n).toLocaleString('en-IN');

/** The garage, as a profile section. Own-garage only — visitors see bikes
 *  through the rider page's own rendering. */
export function GarageSection() {
  const { session } = useAuth();
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [rideCounts, setRideCounts] = useState<Map<string, number>>(new Map());

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let alive = true;
      Promise.all([listBikes(session.user.id), rideCountsByBike(session.user.id)])
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
    }, [session])
  );

  const activeBikes = bikes.filter((b) => b.is_active);
  const lifetimeKm = bikes.reduce((s, b) => s + Number(b.current_odometer_km), 0);
  const totalRides = [...rideCounts.values()].reduce((s, n) => s + n, 0);
  const currentBikeId = activeBikes.length ? activeBikes[activeBikes.length - 1].id : null;

  return (
    <View>
      <View style={st.totals}>
        <Total label="Lifetime" value={fmtKm(lifetimeKm)} unit="km" />
        <Total label="Rides" value={String(totalRides)} />
        <Total label="Bikes" value={String(bikes.length)} />
      </View>

      {bikes.map((item) => (
        <BikeCard
          key={item.id}
          bike={item}
          rides={rideCounts.get(item.id) ?? 0}
          isCurrent={item.id === currentBikeId}
        />
      ))}
      <PushButton
        label="Add a bike"
        variant="slate"
        onPress={() => router.push('/bike/new')}
        style={{ marginTop: 6 }}
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
  const sub = [bikeSubtitle(bike), bike.mods].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={() => router.push(`/bike/${bike.id}`)}>
      {({ pressed }) => (
        <Card active={isCurrent} pressed={pressed} style={{ marginBottom: 12 }}>
          <View style={st.bikeTop}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={st.bikeName}>{bikeTitle(bike)}</Text>
              {sub ? (
                <MonoLabel size={9.5} style={{ marginTop: 5, letterSpacing: 1 }}>
                  {sub}
                </MonoLabel>
              ) : null}
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
  totals: {
    flexDirection: 'row',
    marginBottom: 18,
    paddingBottom: 16,
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
  bikeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  bikeName: {
    fontFamily: font.display,
    fontSize: 23,
    color: color.white,
    textTransform: 'uppercase',
    lineHeight: 25,
  },
  tag: { paddingHorizontal: 7, paddingVertical: 3.5, borderRadius: 3, borderWidth: 1 },
  tagActive: { backgroundColor: 'rgba(255,214,10,.14)', borderColor: 'rgba(255,214,10,.3)' },
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
