import { addDays, dateOnly, daysBetween } from "./dates";
import type { DateOnly } from "./dates";
export interface RangeSelection {
  start: DateOnly | null;
  end: DateOnly | null;
}
export function formatDate(value: DateOnly) {
  return value.split("-").reverse().join(".");
}
export function parseDate(value: string): DateOnly {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!match) throw Error("Введите дату в формате ДД.ММ.ГГГГ");
  try {
    return dateOnly(`${match[3] ?? ""}-${match[2] ?? ""}-${match[1] ?? ""}`);
  } catch {
    throw Error("Такой календарной даты нет");
  }
}
export function chooseRangeDate(
  current: RangeSelection,
  date: DateOnly,
): RangeSelection {
  if (current.start === date) return { ...current, start: null };
  if (current.end === date) return { ...current, end: null };
  if (current.start && current.end) return { start: date, end: null };
  const next = !current.start
    ? { ...current, start: date }
    : { ...current, end: date };
  return next.start && next.end && next.start > next.end
    ? { start: next.end, end: next.start }
    : next;
}
export function monthCells(month: DateOnly): readonly (DateOnly | null)[] {
  const weekday = ((daysBetween(dateOnly("1970-01-05"), month) % 7) + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    try {
      return addDays(month, i - weekday);
    } catch {
      return null;
    }
  });
}
