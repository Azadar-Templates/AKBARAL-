import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cronNextAfter, epochForWall, isValidCron, isValidTimezone, parseCron, wallPartsInZone } from './cron';

/**
 * Timezone-safe cron engine tests (Automation milestone).
 *
 * Karachi (UTC+5, no DST) is the primary timezone; America/New_York covers
 * both DST transitions. Fixed dates are UTC-anchored so the suite is
 * deterministic regardless of the host timezone.
 */

describe('automation cron engine', () => {
  it('validates expressions strictly (no ranges, lists or names)', () => {
    assert.equal(isValidCron('*/15 * * * *'), true);
    assert.equal(isValidCron('0 9 * * 1'), true);
    assert.equal(isValidCron('30 2 31 1 *'), true);
    assert.equal(isValidCron('1-5 * * * *'), false, 'ranges rejected');
    assert.equal(isValidCron('1,2 * * * *'), false, 'lists rejected');
    assert.equal(isValidCron('0 9 * * mon'), false, 'named days rejected');
    assert.equal(isValidCron('* * * *'), false, 'four fields rejected');
    assert.equal(isValidCron('60 * * * *'), false, 'out of range rejected');
    assert.equal(isValidCron('*/0 * * * *'), false, 'zero step rejected');
    assert.throws(() => parseCron('nonsense'));
  });

  it('validates timezones', () => {
    assert.equal(isValidTimezone('Asia/Karachi'), true);
    assert.equal(isValidTimezone('America/New_York'), true);
    assert.equal(isValidTimezone('Not/AZone'), false);
  });

  it('computes step schedules in Karachi time', () => {
    const next = cronNextAfter(Date.parse('2026-09-10T10:07:00Z'), '*/15 * * * *', 'Asia/Karachi');
    assert.equal(next, Date.parse('2026-09-10T10:15:00.000Z'));
  });

  it('computes weekly schedules across a DST shift (NY EDT -> EST)', () => {
    // Monday 09:00 America/New_York. Before the Nov 1 2026 fall-back, 9am EDT
    // is 13:00Z; after it, 9am EST is 14:00Z.
    const before = cronNextAfter(Date.parse('2026-10-26T12:00:00Z'), '0 9 * * 1', 'America/New_York');
    assert.equal(before, Date.parse('2026-10-26T13:00:00.000Z'), 'Mon Oct 26 9am EDT = 13:00Z');
    const after = cronNextAfter(Date.parse('2026-10-31T12:00:00Z'), '0 9 * * 1', 'America/New_York');
    assert.equal(after, Date.parse('2026-11-02T14:00:00.000Z'), 'Mon Nov 2 9am EST = 14:00Z');
  });

  it('skips nonexistent local times in the spring-forward gap (Vixie semantics)', () => {
    // 02:30 does not exist on 2026-03-08 in New York; the occurrence is
    // skipped and the next real one is Mar 9 02:30 EDT = 06:30Z.
    assert.equal(epochForWall({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York'), null);
    const next = cronNextAfter(Date.parse('2026-03-07T12:00:00Z'), '30 2 * * *', 'America/New_York');
    assert.equal(next, Date.parse('2026-03-09T06:30:00.000Z'));
  });

  it('resolves ambiguous fall-back times to the first occurrence', () => {
    // 01:30 occurs twice on 2026-11-01 in New York; the first (EDT) is 05:30Z.
    const next = cronNextAfter(Date.parse('2026-10-31T12:00:00Z'), '30 1 * * *', 'America/New_York');
    assert.equal(next, Date.parse('2026-11-01T05:30:00.000Z'));
    const wall = wallPartsInZone(next as number, 'America/New_York');
    assert.equal(wall.hour, 1);
    assert.equal(wall.minute, 30);
  });

  it('skips months without day 31', () => {
    const next = cronNextAfter(Date.parse('2026-01-31T12:00:00Z'), '0 0 31 * *', 'UTC');
    assert.equal(next, Date.parse('2026-03-31T00:00:00.000Z'));
  });

  it('never matches-never expressions return null', () => {
    // February 30th never exists.
    assert.equal(cronNextAfter(Date.now(), '0 0 30 2 *', 'UTC'), null);
  });

  it('steps anchor at the field base (hour steps, minute steps)', () => {
    const hourly = cronNextAfter(Date.parse('2026-09-10T10:07:00Z'), '0 */3 * * *', 'UTC');
    assert.equal(hourly, Date.parse('2026-09-10T12:00:00.000Z'), 'next 3-hour boundary after 10:07');
    const sundays = cronNextAfter(Date.parse('2026-09-10T00:00:00Z'), '0 0 * * 0', 'UTC');
    assert.equal(new Date(sundays as number).getUTCDay(), 0, 'lands on a Sunday');
  });

  it('wall parts convert correctly in Karachi', () => {
    const wall = wallPartsInZone(Date.parse('2026-09-10T12:34:00Z'), 'Asia/Karachi');
    assert.deepEqual({ ...wall }, { year: 2026, month: 9, day: 10, hour: 17, minute: 34, weekday: 4 });
  });

  it('round-trips local times through the Karachi timezone', () => {
    const epoch = epochForWall({ year: 2026, month: 9, day: 10, hour: 9, minute: 0 }, 'Asia/Karachi');
    assert.equal(epoch, Date.parse('2026-09-10T04:00:00.000Z'), '9am PKT = 04:00Z');
    const wall = wallPartsInZone(epoch as number, 'Asia/Karachi');
    assert.equal(wall.hour, 9);
    assert.equal(wall.minute, 0);
  });
});
