import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compose,
  dayLabel,
  daysBetween,
  hoursOn,
  minutesOn,
  periodsOn,
  pickableDays,
  slotsOn,
  snapToSlot,
  startOfDay,
  whenLabel,
} from '../src/lib/when.ts';

/** Local time, so the tests read the way a rider's phone does. */
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

describe('calendar days, not 24-hour subtraction', () => {
  it('calls tomorrow morning TOMORROW, late at night', () => {
    // The reported bug: 21:30 on the 25th, a ride at 06:00 on the 26th is
    // 8.5 hours away, and (diff / 86400000) floors to 0.
    const now = at(2026, 7, 25, 21, 30);
    assert.equal(dayLabel(at(2026, 7, 26, 6, 0), now), 'Tomorrow');
    assert.equal(whenLabel(at(2026, 7, 26, 6, 0), now).startsWith('Tomorrow'), true);
  });

  it('calls tonight TODAY even when it is minutes away', () => {
    const now = at(2026, 7, 25, 21, 30);
    assert.equal(dayLabel(at(2026, 7, 25, 23, 45), now), 'Today');
  });

  it('names the day once it is further out', () => {
    const now = at(2026, 7, 25, 21, 30);
    assert.equal(dayLabel(at(2026, 7, 28), now), dayLabel(at(2026, 7, 28), now));
    assert.ok(!['Today', 'Tomorrow', 'Yesterday'].includes(dayLabel(at(2026, 7, 28), now)));
  });

  it('counts days from midnight to midnight', () => {
    assert.equal(daysBetween(at(2026, 7, 25, 23, 59), at(2026, 7, 26, 0, 1)), 1);
    assert.equal(daysBetween(at(2026, 7, 25, 0, 1), at(2026, 7, 25, 23, 59)), 0);
  });
});

describe('a ride cannot be planned into the past', () => {
  it('offers only the rest of today, on today', () => {
    const now = at(2026, 7, 25, 21, 30);
    const slots = slotsOn(startOfDay(now), now);
    assert.equal(slots[0], 21 * 60 + 35, 'the next five-minute slot, not the current minute');
    assert.equal(slots[slots.length - 1], 23 * 60 + 55);
    assert.ok(!slots.includes(6 * 60), '06:00 today is gone and is not on offer');
  });

  it('drops today off the day list once it is spent', () => {
    const now = at(2026, 7, 25, 23, 58);
    assert.equal(slotsOn(startOfDay(now), now).length, 0);
    const days = pickableDays(now, 3);
    assert.equal(dayLabel(days[0], now), 'Tomorrow', 'today is no longer pickable');
  });

  it('keeps every slot on a day that has not started', () => {
    const now = at(2026, 7, 25, 21, 30);
    assert.equal(slotsOn(at(2026, 7, 26), now).length, (24 * 60) / 5);
  });

  it('hides the AM half of today once it is afternoon', () => {
    const now = at(2026, 7, 25, 21, 30);
    const today = startOfDay(now);
    assert.deepEqual(periodsOn(today, now), ['PM']);
    assert.deepEqual(hoursOn(today, now, 'PM'), [9, 10, 11], 'only the hours still ahead');
    assert.deepEqual(minutesOn(today, now, 'PM', 9), [35, 40, 45, 50, 55]);
    // Tomorrow is untouched by any of it.
    assert.deepEqual(periodsOn(at(2026, 7, 26), now), ['AM', 'PM']);
    assert.equal(hoursOn(at(2026, 7, 26), now, 'AM').length, 12);
  });

  it('every offered combination composes to a future instant', () => {
    const now = at(2026, 7, 25, 21, 30);
    const today = startOfDay(now);
    for (const period of periodsOn(today, now)) {
      for (const hour of hoursOn(today, now, period)) {
        for (const minute of minutesOn(today, now, period, hour)) {
          assert.ok(
            +compose(today, period, hour, minute) > +now,
            `${hour}:${minute} ${period} is not ahead of 21:30`
          );
        }
      }
    }
  });
});

describe('seeding the picker', () => {
  it('keeps a future default exactly where it is', () => {
    const now = at(2026, 7, 25, 21, 30);
    const want = at(2026, 7, 26, 6, 0);
    assert.equal(+snapToSlot(want, now), +want);
  });

  it('pulls a past default forward to the next slot that exists', () => {
    const now = at(2026, 7, 25, 21, 30);
    const snapped = snapToSlot(at(2026, 7, 25, 6, 0), now);
    assert.ok(+snapped > +now);
    assert.equal(dayLabel(snapped, now), 'Today');
    assert.equal(snapped.getHours() * 60 + snapped.getMinutes(), 21 * 60 + 35);
  });

  it('rolls to the next day when the asked-for day is over', () => {
    const now = at(2026, 7, 25, 23, 58);
    const snapped = snapToSlot(at(2026, 7, 25, 6, 0), now);
    assert.equal(dayLabel(snapped, now), 'Tomorrow');
  });
});
