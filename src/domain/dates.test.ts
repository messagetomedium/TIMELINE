import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { addDays, addMonths, containsDate, containsInterval, dateOnly, daysBetween, durationDays, interval, overlaps, shiftInterval, startOfWeek } from './dates';

describe('date-only parsing', () => {
  it.each(['0001-01-01', '0099-12-31', '2000-02-29', '2024-02-29', '9999-12-31'])('accepts %s without normalization', (value) => {
    expect(dateOnly(value)).toBe(value);
  });
  it.each(['', '2026-2-01', '2026-02-30', '1900-02-29', '2026-13-01', '2026-00-01', '2026-01-00', '0000-01-01', '2026-01-01T00:00:00Z', ' 2026-01-01'])('rejects invalid input %s', (value) => {
    expect(() => dateOnly(value)).toThrow(RangeError);
  });
});

describe('calendar arithmetic', () => {
  it('crosses leap days, month ends and years in both directions', () => {
    expect(addDays(dateOnly('2024-02-28'), 2)).toBe('2024-03-01');
    expect(addDays(dateOnly('2024-03-01'), -1)).toBe('2024-02-29');
    expect(addDays(dateOnly('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(dateOnly('2027-01-01'), -1)).toBe('2026-12-31');
    expect(addDays(dateOnly('0099-12-31'), 1)).toBe('0100-01-01');
    expect(daysBetween(dateOnly('0001-01-01'), dateOnly('0001-01-02'))).toBe(1);
  });
  it.each(['UTC', 'Europe/Moscow', 'America/New_York', 'Pacific/Auckland'])('is independent of DST and timezone: %s', (timezone) => {
    const original = process.env.TZ;
    try {
      process.env.TZ = timezone;
      expect(addDays(dateOnly('2026-03-07'), 2)).toBe('2026-03-09');
      expect(daysBetween(dateOnly('2026-03-07'), dateOnly('2026-03-09'))).toBe(2);
      expect(addDays(dateOnly('2026-11-02'), -2)).toBe('2026-10-31');
      expect(daysBetween(dateOnly('2026-11-02'), dateOnly('2026-10-31'))).toBe(-2);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
  it('uses real calendar months, clamping only the destination day', () => {
    expect(addMonths(dateOnly('2024-01-31'), 1)).toBe('2024-02-29');
    expect(addMonths(dateOnly('2026-01-31'), 1)).toBe('2026-02-28');
    expect(addMonths(dateOnly('2026-03-31'), -1)).toBe('2026-02-28');
    expect(addMonths(dateOnly('2026-01-31'), 2)).toBe('2026-03-31');
    expect(addMonths(dateOnly('2024-02-29'), 12)).toBe('2025-02-28');
    expect(addMonths(dateOnly('0099-12-15'), 1)).toBe('0100-01-15');
  });
  it('anchors weeks on Monday, including across year boundaries', () => {
    expect(startOfWeek(dateOnly('2026-10-26'))).toBe('2026-10-26');
    expect(startOfWeek(dateOnly('2026-11-01'))).toBe('2026-10-26');
    expect(startOfWeek(dateOnly('2027-01-01'))).toBe('2026-12-28');
  });
  it.each([0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects non-calendar offset %s', (offset) => {
    expect(() => addDays(dateOnly('2026-10-01'), offset)).toThrow(RangeError);
    expect(() => addMonths(dateOnly('2026-10-01'), offset)).toThrow(RangeError);
  });
  it('rejects underflow and overflow instead of silently wrapping', () => {
    expect(() => addDays(dateOnly('0001-01-01'), -1)).toThrow(RangeError);
    expect(() => addDays(dateOnly('9999-12-31'), 1)).toThrow(RangeError);
    expect(() => addMonths(dateOnly('0001-01-01'), -1)).toThrow(RangeError);
    expect(() => addMonths(dateOnly('9999-12-31'), 1)).toThrow(RangeError);
  });
});

describe('half-open intervals', () => {
  const value = interval(dateOnly('2026-10-01'), dateOnly('2026-10-04'));
  it('has an exclusive end and duration of three days', () => {
    expect(durationDays(value)).toBe(3);
    expect(containsDate(value, dateOnly('2026-10-01'))).toBe(true);
    expect(containsDate(value, dateOnly('2026-10-03'))).toBe(true);
    expect(containsDate(value, dateOnly('2026-10-04'))).toBe(false);
  });
  it('allows one day, rejects empty and reversed intervals', () => {
    expect(durationDays(interval(dateOnly('2026-10-01'), dateOnly('2026-10-02')))).toBe(1);
    expect(() => interval(dateOnly('2026-10-01'), dateOnly('2026-10-01'))).toThrow(RangeError);
    expect(() => interval(dateOnly('2026-10-02'), dateOnly('2026-10-01'))).toThrow(RangeError);
  });
  it('distinguishes overlap from adjacency', () => {
    expect(overlaps(value, interval(dateOnly('2026-10-04'), dateOnly('2026-10-05')))).toBe(false);
    expect(overlaps(value, interval(dateOnly('2026-10-03'), dateOnly('2026-10-05')))).toBe(true);
    expect(overlaps(value, value)).toBe(true);
  });
  it('accepts matching parent boundaries, rejects children outside either edge', () => {
    expect(containsInterval(value, value)).toBe(true);
    expect(containsInterval(value, interval(dateOnly('2026-09-30'), dateOnly('2026-10-02')))).toBe(false);
    expect(containsInterval(value, interval(dateOnly('2026-10-03'), dateOnly('2026-10-05')))).toBe(false);
  });
  it('shifts both boundaries equally and leaves the original unchanged', () => {
    const shifted = shiftInterval(value, -3);
    expect(shifted).toEqual({ startDate: '2026-09-28', endDateExclusive: '2026-10-01' });
    expect(durationDays(shifted)).toBe(durationDays(value));
    expect(shiftInterval(shifted, 3)).toEqual(value);
    expect(value.startDate).toBe('2026-10-01');
  });
});
