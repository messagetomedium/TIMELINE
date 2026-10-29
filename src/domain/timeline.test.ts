import { describe, expect, it } from 'vitest';
import { addDays, dateOnly, daysBetween } from './dates';
import { dateAtX, getVisibleDateRange, gridDates, isWeekend, snapDate, widthForInterval, xForDate, zoomCamera } from './timeline';

const camera = { originDate: dateOnly('2026-09-01'), pxPerDay: 4, panX: 176 };

describe('shared calendar transform', () => {
  it('round-trips every day before and after origin, with fractional pan/zoom', () => {
    for (let day = -365; day <= 730; day++) {
      const date = addDays(camera.originDate, day);
      expect(dateAtX(xForDate(date, camera), camera)).toBe(date);
    }
    const changed = { ...camera, pxPerDay: 2.75, panX: -120.25 };
    expect(dateAtX(xForDate(dateOnly('2027-02-01'), changed), changed)).toBe('2027-02-01');
    expect(dateAtX(camera.panX - 1, camera)).toBe('2026-08-31');
    const fitted = { ...camera, pxPerDay: 960 / 365, panX: -83.23 };
    for (let day = -365; day <= 730; day++) {
      const date = addDays(camera.originDate, day);
      expect(dateAtX(xForDate(date, fitted), fitted)).toBe(date);
    }
  });
  it('measures actual calendar months rather than 30-day widths', () => {
    expect(widthForInterval({ startDate: dateOnly('2024-02-01'), endDateExclusive: dateOnly('2024-03-01') }, camera)).toBe(29 * 4);
    expect(widthForInterval({ startDate: dateOnly('2026-01-01'), endDateExclusive: dateOnly('2026-02-01') }, camera)).toBe(31 * 4);
  });
  it('keeps the date under the zoom focus stationary and clamps zoom', () => {
    const date = dateOnly('2026-12-01');
    const focus = xForDate(date, camera);
    const zoomed = zoomCamera(camera, 1.25, focus);
    expect(xForDate(date, zoomed)).toBe(focus);
    expect(dateAtX(focus, zoomed)).toBe(date);
    expect(zoomCamera(camera, 100, 500).pxPerDay).toBe(48);
    expect(zoomCamera(camera, 0.0001, 500).pxPerDay).toBe(1.5);
  });
  it('changes only the visible range during pan', () => {
    const before = getVisibleDateRange(1000, camera);
    const after = getVisibleDateRange(1000, { ...camera, panX: camera.panX + 28 });
    expect(daysBetween(before.startDate, after.startDate)).toBe(-7);
  });
});

describe('stable snapping', () => {
  it('uses Monday boundaries and stable two-week anchors', () => {
    expect(snapDate(dateOnly('2026-10-29'), '1w', 'floor')).toBe('2026-10-26');
    expect(snapDate(dateOnly('2026-10-29'), '1w', 'ceil')).toBe('2026-11-02');
    const date = snapDate(dateOnly('2026-10-29'), '2w');
    expect(daysBetween(dateOnly('1970-01-05'), date) % 14).toBe(0);
  });
  it('uses real month starts, including leap February', () => {
    expect(snapDate(dateOnly('2024-02-15'), '1mo', 'floor')).toBe('2024-02-01');
    expect(snapDate(dateOnly('2024-02-15'), '1mo', 'ceil')).toBe('2024-03-01');
    expect(snapDate(dateOnly('2024-02-20'), '1mo')).toBe('2024-03-01');
    expect(snapDate(dateOnly('2026-12-31'), '1mo')).toBe('2027-01-01');
  });
  it('keeps 2/3-day anchors stable on either side of the epoch', () => {
    expect(snapDate(dateOnly('1969-12-31'), '2d', 'floor')).toBe('1969-12-30');
    expect(snapDate(dateOnly('1970-01-02'), '3d', 'floor')).toBe('1970-01-01');
    expect(snapDate(dateOnly('1970-01-03'), '3d')).toBe('1970-01-04');
  });
  it('draws the same boundaries after pan; distinguishes weekends', () => {
    const first = gridDates(1000, camera, '1w');
    const second = gridDates(1000, { ...camera, panX: 120 }, '1w');
    expect(second.filter((date) => first.includes(date)).length).toBeGreaterThan(20);
    expect(isWeekend(dateOnly('2026-10-31'))).toBe(true);
    expect(isWeekend(dateOnly('2026-11-01'))).toBe(true);
    expect(isWeekend(dateOnly('2026-11-02'))).toBe(false);
  });
});
