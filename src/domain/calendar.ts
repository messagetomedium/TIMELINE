import { addDays, dateOnly, daysBetween } from './dates';
import type { DateInterval, DateOnly } from './dates';
import type { GridStep } from './schema';
import { isWeekend, nextGridDate, snapDate } from './timeline';

export interface CalendarCell {
  readonly start: DateOnly;
  readonly endExclusive: DateOnly;
  readonly label: string;
  readonly shortLabel: string;
  readonly secondaryLabel: string;
  readonly kind: 'day' | 'multi-day' | 'week' | 'month';
}
export interface CalendarGeometry {
  readonly range: DateInterval;
  readonly cells: readonly CalendarCell[];
  readonly months: readonly CalendarCell[];
  readonly weekends: readonly DateOnly[];
}
const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const shortMonths = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const weekdays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const dayNumber = (date: DateOnly) => String(Number(date.slice(8, 10)));
const shortDate = (date: DateOnly) => `${dayNumber(date)} ${shortMonths[Number(date.slice(5, 7)) - 1] ?? ''}`;

export function getCalendarCells(range: DateInterval, step: GridStep): readonly CalendarCell[] {
  const cells: CalendarCell[] = [];
  let start = snapDate(range.startDate, step, 'floor');
  while (start < range.endDateExclusive) {
    const endExclusive = nextGridDate(start, step);
    const last = addDays(endExclusive, -1);
    const kind = step === '1mo' ? 'month' : step.endsWith('w') ? 'week' : step === '1d' ? 'day' : 'multi-day';
    const month = months[Number(start.slice(5, 7)) - 1] ?? '';
    const rangeLabel = `${shortDate(start)} — ${shortDate(last)}`;
    cells.push({
      start, endExclusive, kind,
      label: kind === 'month' ? month : kind === 'day' ? dayNumber(start) : kind === 'week' || start.slice(0, 7) !== last.slice(0, 7) ? rangeLabel : `${dayNumber(start)}–${dayNumber(last)}`,
      shortLabel: kind === 'month' ? month.slice(0, 3) : kind === 'day' ? dayNumber(start) : `${dayNumber(start)}–${dayNumber(last)}`,
      secondaryLabel: kind === 'month' ? start.slice(0, 4) : kind === 'day' ? weekdays[((daysBetween(dateOnly('1970-01-05'), start) % 7) + 7) % 7] ?? '' : kind === 'week' ? step === '2w' ? 'Две недели' : 'пн — вс' : '',
    });
    start = endExclusive;
  }
  return cells;
}

/** One set of real intervals for header, stages, production and assignments. */
export function getCalendarGeometry(range: DateInterval, step: GridStep): CalendarGeometry {
  const weekends: DateOnly[] = [];
  for (let date = range.startDate; date < range.endDateExclusive; date = addDays(date, 1)) if (isWeekend(date)) weekends.push(date);
  return { range, cells: getCalendarCells(range, step), months: getCalendarCells(range, '1mo'), weekends };
}

export function visibleYears(range: DateInterval): string {
  const start = range.startDate.slice(0, 4);
  const end = addDays(range.endDateExclusive, -1).slice(0, 4);
  return start === end ? start : `${start} — ${end}`;
}
