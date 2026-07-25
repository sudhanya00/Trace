/**
 * When a ride is.
 *
 * Two rules live here, and both were being got wrong by hand at each call
 * site:
 *
 * 1. "Today" is a calendar day, not a 24-hour subtraction. At 21:30, a ride
 *    tomorrow at 06:00 is 8 hours away — divide by 86400000 and floor it and
 *    you get 0, and the card confidently says TODAY for a ride that is not
 *    today. That is the bug riders were seeing.
 *
 * 2. You cannot plan a ride into the past. Not "not much into the past" —
 *    the picker is built from the list of times that are still ahead, so a
 *    past time is not a thing a rider can land on.
 */

/** Times are offered on a five-minute grid. Nobody meets at 06:07. */
export const SLOT_MINUTES = 5;

/** How far ahead you can plan. Four months covers a Himalayan season. */
export const HORIZON_DAYS = 120;

export type Period = 'AM' | 'PM';

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Calendar days from `a` to `b`, local time. Midnight to midnight. */
export function daysBetween(a: Date, b: Date): number {
  const ms = +startOfDay(b) - +startOfDay(a);
  // Not a plain division: DST days are 23 or 25 hours long, and rounding is
  // what keeps those days one day apart.
  return Math.round(ms / 86400000);
}

const dayName = (d: Date, now: Date) =>
  d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });

/** "Today", "Tomorrow", "Yesterday", or a dated weekday. */
export function dayLabel(d: Date, now: Date = new Date()): string {
  const n = daysBetween(now, d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return dayName(d, now);
}

export function timeLabel(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** The whole thing, as a card or a header says it. */
export function whenLabel(d: Date | string, now: Date = new Date()): string {
  const when = typeof d === 'string' ? new Date(d) : d;
  return `${dayLabel(when, now)} · ${timeLabel(when)}`;
}

// ---------------------------------------------------------------------------
// What a rider is allowed to pick.
// ---------------------------------------------------------------------------

/** Minute-of-day, split the way a wheel shows it. */
export function to12(minuteOfDay: number): { period: Period; hour: number; minute: number } {
  const h24 = Math.floor(minuteOfDay / 60);
  return {
    period: h24 < 12 ? 'AM' : 'PM',
    hour: h24 % 12 === 0 ? 12 : h24 % 12,
    minute: minuteOfDay % 60,
  };
}

export function from12(period: Period, hour: number, minute: number): number {
  return ((hour % 12) + (period === 'PM' ? 12 : 0)) * 60 + minute;
}

/**
 * Every slot still ahead on `day`. Empty once the day is spent, which is what
 * takes today off the list late at night.
 */
export function slotsOn(day: Date, now: Date = new Date()): number[] {
  const behind = daysBetween(now, day);
  if (behind < 0) return [];
  // The first slot today is the next one that hasn't started. `+ 1` is what
  // stops the picker offering the minute you are currently standing in.
  const first =
    behind === 0
      ? Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / SLOT_MINUTES) * SLOT_MINUTES
      : 0;
  const out: number[] = [];
  for (let m = first; m < 24 * 60; m += SLOT_MINUTES) out.push(m);
  return out;
}

/** The days with any ride left in them: today (if there is), then onwards. */
export function pickableDays(now: Date = new Date(), horizon = HORIZON_DAYS): Date[] {
  const out: Date[] = [];
  // Only today can be spent — every later day is whole, so it never needs
  // asking.
  const from = slotsOn(startOfDay(now), now).length > 0 ? 0 : 1;
  for (let i = from; i <= horizon; i++) {
    const d = startOfDay(now);
    d.setDate(d.getDate() + i);
    out.push(d);
  }
  return out;
}

export function periodsOn(day: Date, now: Date = new Date()): Period[] {
  const seen = new Set(slotsOn(day, now).map((m) => to12(m).period));
  return (['AM', 'PM'] as const).filter((p) => seen.has(p));
}

export function hoursOn(day: Date, now: Date, period: Period): number[] {
  const seen = new Set(
    slotsOn(day, now)
      .map(to12)
      .filter((s) => s.period === period)
      .map((s) => s.hour)
  );
  // 12 leads the hour wheel the way a clock face reads: 12, 1, 2 … 11.
  return [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((h) => seen.has(h));
}

export function minutesOn(day: Date, now: Date, period: Period, hour: number): number[] {
  return slotsOn(day, now)
    .map(to12)
    .filter((s) => s.period === period && s.hour === hour)
    .map((s) => s.minute);
}

/** A day and a time on the wheels, back into an instant. */
export function compose(day: Date, period: Period, hour: number, minute: number): Date {
  const out = startOfDay(day);
  out.setMinutes(from12(period, hour, minute));
  return out;
}

/** The nearest pickable slot at or after `d` — used to seed the picker. */
export function snapToSlot(d: Date, now: Date = new Date()): Date {
  const days = pickableDays(now);
  // The first offered day that isn't before the one asked for.
  const day = days.find((p) => daysBetween(d, p) >= 0) ?? days[days.length - 1];
  const want = d.getHours() * 60 + d.getMinutes();
  const slots = slotsOn(day, now);
  const m = slots.find((s) => s >= want) ?? slots[slots.length - 1];
  const { period, hour, minute } = to12(m);
  return compose(day, period, hour, minute);
}
