/** Proleptic Gregorian dates, years 0001–9999. Never a timestamp or local Date. */
declare const dateOnlyBrand: unique symbol;
export type DateOnly = string & { readonly [dateOnlyBrand]: true };

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function dateOnly(value: string): DateOnly {
  if (!isDateOnly(value)) throw new RangeError(`Invalid date-only value: ${value}`);
  return value;
}

function utcDate(value: DateOnly): Date {
  // setUTCFullYear avoids Date.UTC's special interpretation of years 00–99.
  const date = new Date(0);
  date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return date;
}

function fromUtcDate(value: Date): DateOnly {
  if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1 || value.getUTCFullYear() > 9999) {
    throw new RangeError('Date outside supported range 0001–9999');
  }
  return dateOnly(value.toISOString().slice(0, 10));
}

function assertInteger(value: number): void {
  if (!Number.isSafeInteger(value)) throw new RangeError('Calendar offset must be a safe integer');
}

export function addDays(value: DateOnly, days: number): DateOnly {
  assertInteger(days);
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtcDate(date);
}

/** Calendar months, clamping the day to the destination month's last day. */
export function addMonths(value: DateOnly, months: number): DateOnly {
  assertInteger(months);
  const date = utcDate(value);
  const originalDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(Math.min(originalDay, daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1)));
  return fromUtcDate(date);
}

/** Signed number of calendar days from start to end. UTC makes DST irrelevant. */
export function daysBetween(start: DateOnly, end: DateOnly): number {
  return (utcDate(end).getTime() - utcDate(start).getTime()) / 86_400_000;
}

export function startOfWeek(value: DateOnly): DateOnly {
  return addDays(value, -((utcDate(value).getUTCDay() + 6) % 7));
}

export interface DateInterval {
  readonly startDate: DateOnly;
  readonly endDateExclusive: DateOnly;
}

export function interval(startDate: DateOnly, endDateExclusive: DateOnly): DateInterval {
  if (startDate >= endDateExclusive) throw new RangeError('An interval must contain at least one day');
  return { startDate, endDateExclusive };
}

export function durationDays(value: DateInterval): number {
  return daysBetween(value.startDate, value.endDateExclusive);
}

export function containsDate(value: DateInterval, date: DateOnly): boolean {
  return value.startDate <= date && date < value.endDateExclusive;
}

export function containsInterval(parent: DateInterval, child: DateInterval): boolean {
  return parent.startDate <= child.startDate && child.endDateExclusive <= parent.endDateExclusive;
}

export function overlaps(left: DateInterval, right: DateInterval): boolean {
  return left.startDate < right.endDateExclusive && right.startDate < left.endDateExclusive;
}

export function shiftInterval(value: DateInterval, days: number): DateInterval {
  return interval(addDays(value.startDate, days), addDays(value.endDateExclusive, days));
}
