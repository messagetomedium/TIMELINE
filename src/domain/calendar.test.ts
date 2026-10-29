import { describe, expect, it } from 'vitest';
import { dateOnly, daysBetween } from './dates';
import { getCalendarCells, getCalendarGeometry, visibleYears } from './calendar';
import { cameraForFitRange, cameraForFocusDate, getVisibleDateRange, WORK_ZOOM, xForDate } from './timeline';
import type { GridStep } from './schema';

const range = { startDate: dateOnly('2026-10-29'), endDateExclusive: dateOnly('2026-12-04') };
const camera = { originDate: dateOnly('2026-09-01'), pxPerDay: WORK_ZOOM, panX: 0 };

describe('real calendar cells', () => {
  it.each<GridStep>(['1d', '2d', '3d', '1w', '2w', '1mo'])('%s covers the range with adjacent, actual calendar intervals', (step) => {
    const cells = getCalendarCells(range, step);
    const first = cells[0];
    const last = cells.at(-1);
    if (!first || !last) throw new Error('Missing calendar cells');
    expect(first.start <= range.startDate).toBe(true);
    expect(last.endExclusive >= range.endDateExclusive).toBe(true);
    cells.forEach((cell, index) => {
      expect(cell.start < cell.endExclusive).toBe(true);
      expect(cell.label).not.toBe('');
      if (index > 0) expect(cell.start).toBe(cells[index - 1]?.endExclusive);
    });
  });
  it('labels weeks across month and year boundaries and anchors on Mondays', () => {
    const first = getCalendarCells(range, '1w')[0];
    expect(first?.start).toBe('2026-10-26');
    expect(first?.endExclusive).toBe('2026-11-02');
    expect(first?.label).toBe('26 окт — 1 ноя');
    const year = getCalendarCells({ startDate: dateOnly('2026-12-30'), endDateExclusive: dateOnly('2027-01-04') }, '1w')[0];
    expect(year?.label).toBe('28 дек — 3 янв');
    expect(year?.start).toBe('2026-12-28');
  });
  it('keeps two-week anchors and 2/3-day intervals stable when the visible window changes', () => {
    for (const step of ['2d', '3d', '2w'] as const) {
      const first = getCalendarCells(range, step);
      const panned = getCalendarCells({ ...range, startDate: dateOnly('2026-11-03') }, step);
      expect(panned.every((cell) => first.some((other) => other.start === cell.start))).toBe(true);
      for (const cell of first) expect(daysBetween(cell.start, cell.endExclusive)).toBe(step === '2w' ? 14 : step === '2d' ? 2 : 3);
    }
  });
  it('uses true month lengths, including leap February', () => {
    const cells = getCalendarCells({ startDate: dateOnly('2024-01-15'), endDateExclusive: dateOnly('2024-04-01') }, '1mo');
    expect(cells.map((cell) => daysBetween(cell.start, cell.endExclusive))).toEqual([31, 29, 31]);
    expect(cells.map((cell) => cell.label)).toEqual(['Январь', 'Февраль', 'Март']);
  });
  it('generates the same grid intervals for all layers and correct weekends across a month', () => {
    const geometry = getCalendarGeometry({ startDate: dateOnly('2026-10-29'), endDateExclusive: dateOnly('2026-11-04') }, '1w');
    expect(geometry.weekends).toEqual(['2026-10-31', '2026-11-01']);
    expect(geometry.months.map((cell) => cell.start)).toEqual(['2026-10-01', '2026-11-01']);
  });
  it('derives visible years from the actual half-open range', () => {
    expect(visibleYears(range)).toBe('2026');
    expect(visibleYears({ startDate: dateOnly('2026-12-01'), endDateExclusive: dateOnly('2027-01-01') })).toBe('2026');
    expect(visibleYears({ startDate: dateOnly('2026-12-01'), endDateExclusive: dateOnly('2027-01-02') })).toBe('2026 — 2027');
  });
});

describe('work and overview cameras', () => {
  it('focuses a date in a measured time viewport at 14 px/day, independent of project length', () => {
    const focused = cameraForFocusDate(camera, dateOnly('2026-10-29'), 984, 0.32);
    expect(focused.pxPerDay).toBe(14);
    expect(xForDate(dateOnly('2026-10-29'), focused)).toBeCloseTo(984 * 0.32);
    expect(daysBetween(getVisibleDateRange(984, focused).startDate, getVisibleDateRange(984, focused).endDateExclusive)).toBeLessThan(80);
  });
  it('fits only on an explicit command, with padding in the time viewport', () => {
    const project = { startDate: dateOnly('2026-09-01'), endDateExclusive: dateOnly('2027-09-01') };
    const fit = cameraForFitRange(camera, project, 984);
    expect(fit.pxPerDay).toBeCloseTo(936 / 365);
    expect(xForDate(project.startDate, fit)).toBeCloseTo(24);
    expect(xForDate(project.endDateExclusive, fit)).toBeCloseTo(960);
    expect(camera.pxPerDay).toBe(14);
  });
});
