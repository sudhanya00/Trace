import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { tick } from '../lib/haptics';
import {
  compose,
  dayLabel,
  hoursOn,
  minutesOn,
  Period,
  periodsOn,
  pickableDays,
  snapToSlot,
  startOfDay,
  timeLabel,
} from '../lib/when';
import { color, font } from '../theme/tokens';
import { PushButton } from './PushButton';
import { Sheet } from './Sheet';
import { MonoLabel } from './ui';

const ITEM_H = 42;
const VISIBLE = 5; // two above, the live one, two below

/**
 * One spinning column.
 *
 * Everything is driven off the scroll offset with the native driver, so the
 * rows either side fade as they pass rather than snapping between two states
 * a frame after your thumb leaves the glass.
 */
function Wheel<T extends string | number>({
  options,
  value,
  onChange,
  format,
  width,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
  width?: number;
}) {
  const ref = useRef<ScrollView>(null);
  const y = useRef(new Animated.Value(0)).current;
  const dragging = useRef(false);
  const index = Math.max(0, options.indexOf(value));

  // The options change under the wheel whenever the day does — scroll onto
  // today and the hours before now simply stop existing. Re-seat the column
  // so it can never be left resting on a row that is no longer there.
  useEffect(() => {
    if (dragging.current) return;
    ref.current?.scrollTo({ y: index * ITEM_H, animated: false });
  }, [index, options.length]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    dragging.current = false;
    const i = Math.min(
      options.length - 1,
      Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ITEM_H))
    );
    if (options[i] !== undefined && options[i] !== value) {
      tick();
      onChange(options[i]);
    }
  };

  return (
    <View style={{ width, flex: width ? undefined : 1, height: ITEM_H * VISIBLE }}>
      <Animated.ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y } } }], {
          useNativeDriver: true,
        })}
        onScrollBeginDrag={() => {
          dragging.current = true;
        }}
        onScrollEndDrag={settle}
        onMomentumScrollEnd={settle}
        contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
      >
        {options.map((o, i) => (
          <Animated.View
            key={String(o)}
            style={{
              height: ITEM_H,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: y.interpolate({
                inputRange: [
                  (i - 2) * ITEM_H,
                  (i - 1) * ITEM_H,
                  i * ITEM_H,
                  (i + 1) * ITEM_H,
                  (i + 2) * ITEM_H,
                ],
                outputRange: [0.16, 0.42, 1, 0.42, 0.16],
                extrapolate: 'clamp',
              }),
            }}
          >
            <Text style={st.item} numberOfLines={1} allowFontScaling={false}>
              {format ? format(o) : String(o)}
            </Text>
          </Animated.View>
        ))}
      </Animated.ScrollView>
    </View>
  );
}

/**
 * When is the ride?
 *
 * Typing "2026-07-20" and "06:00" into two text boxes is not a thing anyone
 * should be asked to do on a phone, so this is the wheel every phone already
 * taught its owner: spin the day, spin the time, done.
 *
 * The wheels are built from the times that are still ahead, which is also how
 * a ride in the past stops being possible: at 21:30 today has only 21:35
 * onwards in it, and once today is spent it drops off the day column
 * altogether. There is no invalid state to validate.
 */
export function WhenPicker({
  value,
  onChange,
  label = 'When',
}: {
  value: Date;
  onChange: (d: Date) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  // Frozen while the sheet is up: options must not shift under a moving thumb
  // just because a minute ticked over.
  const [now, setNow] = useState(() => new Date());
  const [draft, setDraft] = useState(value);

  const days = useMemo(() => pickableDays(now), [now]);

  // Each column is derived from the one before it and then clamped, so a
  // selection that the day change invalidated resolves to the nearest thing
  // that does exist rather than to nothing.
  const dayKey = useMemo(() => {
    const want = +startOfDay(draft);
    return days.some((d) => +d === want) ? want : +days[0];
  }, [draft, days]);
  const day = useMemo(() => new Date(dayKey), [dayKey]);

  const periods = useMemo(() => periodsOn(day, now), [day, now]);
  const period: Period = periods.includes(draft.getHours() < 12 ? 'AM' : 'PM')
    ? draft.getHours() < 12
      ? 'AM'
      : 'PM'
    : periods[0];

  const hours = useMemo(() => hoursOn(day, now, period), [day, now, period]);
  const wantHour = draft.getHours() % 12 === 0 ? 12 : draft.getHours() % 12;
  const hour = hours.includes(wantHour) ? wantHour : hours[0];

  const minutes = useMemo(() => minutesOn(day, now, period, hour), [day, now, period, hour]);
  const minute = minutes.includes(draft.getMinutes()) ? draft.getMinutes() : minutes[0];

  const picked = useMemo(() => compose(day, period, hour, minute), [day, period, hour, minute]);

  const start = () => {
    const fresh = new Date();
    setNow(fresh);
    setDraft(snapToSlot(value, fresh));
    setOpen(true);
  };

  return (
    <View>
      <MonoLabel style={{ marginBottom: 7 }}>{label}</MonoLabel>
      <Pressable onPress={start} style={st.row}>
        <View style={{ flex: 1 }}>
          {/* The row reads off the live clock; only the wheels freeze it. */}
          <Text style={st.rowValue}>{dayLabel(value)}</Text>
          <Text style={st.rowSub}>{timeLabel(value)}</Text>
        </View>
        <Feather name="clock" size={16} color={color.steel} />
      </Pressable>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        scroll={false}
        label="When"
        title={dayLabel(picked, now) + ' · ' + timeLabel(picked)}
      >
        <View style={st.wheels}>
          {/* The band the live row sits in — one for the whole row, so the
              four columns read as a single line. */}
          <View pointerEvents="none" style={st.band} />
          <Wheel
            options={days.map((d) => +d)}
            value={dayKey}
            onChange={(k) => setDraft(compose(new Date(k), period, hour, minute))}
            format={(k) => dayLabel(new Date(k), now)}
          />
          <Wheel
            options={hours}
            value={hour}
            onChange={(h) => setDraft(compose(day, period, h, minute))}
            width={54}
          />
          <Wheel
            options={minutes}
            value={minute}
            onChange={(m) => setDraft(compose(day, period, hour, m))}
            format={(m) => String(m).padStart(2, '0')}
            width={54}
          />
          <Wheel
            options={periods}
            value={period}
            onChange={(p) => setDraft(compose(day, p, hour, minute))}
            width={58}
          />
        </View>

        <PushButton
          label="Set the time"
          onPress={() => {
            onChange(picked);
            setOpen(false);
          }}
          style={{ marginTop: 18, marginBottom: 8 }}
        />
      </Sheet>
    </View>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: color.slate2,
    borderWidth: 1,
    borderColor: color.hair,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  rowValue: { fontFamily: font.body, fontSize: 15, color: color.white },
  rowSub: {
    fontFamily: font.mono,
    fontSize: 10,
    color: color.steel,
    marginTop: 4,
    letterSpacing: 1,
  },
  wheels: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  band: {
    position: 'absolute',
    top: ITEM_H * 2,
    left: -6,
    right: -6,
    height: ITEM_H,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.hair,
    backgroundColor: color.slate,
    borderRadius: 8,
  },
  item: {
    fontFamily: font.displaySemi,
    fontSize: 21,
    color: color.white,
    fontVariant: ['tabular-nums'],
  },
});
