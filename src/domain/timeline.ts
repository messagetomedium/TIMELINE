import { addDays, addMonths, dateOnly, daysBetween } from './dates';
import type { DateOnly, DateInterval } from './dates';
import type { GridStep } from './schema';

import { xAfter, xBefore, anchorPosition, xForPosition, calendarDateAtX } from './SegmentAxis';
import type { AxisCamera } from './SegmentAxis';
export type TimelineCamera = AxisCamera;

export const WORK_ZOOM = 14;

/** Coordinates are relative to the time viewport; the fixed gutter is never added. */
export function cameraForFocusDate(camera: TimelineCamera, date: DateOnly, viewportWidth: number, focusRatio = 0.5, zoom = camera.pxPerDay): TimelineCamera {
  return { ...camera, pxPerDay: zoom, panX: viewportWidth * focusRatio - xAfter(date, { ...camera, pxPerDay: zoom, panX: 0 }) };
}

/** Explicit overview only. Window resizing must not call this function. */
export function cameraForFitRange(camera: TimelineCamera, range: DateInterval, viewportWidth: number, padding = 24): TimelineCamera {
  const zoom = Math.max(Number.EPSILON, Math.min(48, (Math.max(1, viewportWidth - padding * 2 - (camera.gaps ?? []).filter(g => g.boundary >= range.startDate && g.boundary <= range.endDateExclusive).reduce((n,g) => n + g.width,0))) / daysBetween(range.startDate, range.endDateExclusive)));
  return { ...camera, pxPerDay: zoom, panX: padding - xAfter(range.startDate, {...camera, pxPerDay: zoom, panX:0}) };
}

export function nextGridDate(date: DateOnly, step: GridStep): DateOnly {
  return step === '1mo' ? addMonths(date, 1) : addDays(date, { '1d': 1, '2d': 2, '3d': 3, '1w': 7, '2w': 14 }[step]);
}

export function xForDate(date: DateOnly, camera: TimelineCamera): number {
  return xAfter(date, camera);
}

/** Returns the calendar day containing the pixel, including negative positions. */
export function dateAtX(x: number, camera: TimelineCamera): DateOnly {
  // Stabilize exact calendar boundaries against floating-point round-off.
  return calendarDateAtX(x, camera);
}

export function widthForInterval(value: DateInterval, camera: TimelineCamera): number {
  return xBefore(value.endDateExclusive, camera) - xAfter(value.startDate, camera);
}

export function zoomCamera(camera: TimelineCamera, scale: number, focusX: number): TimelineCamera {
  const pxPerDay = Math.max(1.5, Math.min(48, camera.pxPerDay * scale));
  const next = { ...camera, pxPerDay, panX: 0 };
  return { ...next, panX: focusX - xForPosition(anchorPosition(focusX,camera),next) };
}

export function getVisibleDateRange(width: number, camera: TimelineCamera): DateInterval {
  return { startDate: dateAtX(0, camera), endDateExclusive: addDays(dateAtX(width, camera), 1) };
}

/** Stable anchors: day steps 1970-01-01; week steps Monday 1970-01-05. */
export function snapDate(value: DateOnly, step: GridStep, mode: 'nearest' | 'floor' | 'ceil' = 'nearest'): DateOnly {
  let left: DateOnly;
  let right: DateOnly;
  if (step === '1mo') {
    left = dateOnly(`${value.slice(0, 7)}-01`);
    if (left === value) return value;
    right = addMonths(left, 1);
  } else {
    const days = { '1d': 1, '2d': 2, '3d': 3, '1w': 7, '2w': 14 }[step];
    const anchor = dateOnly(step.endsWith('w') ? '1970-01-05' : '1970-01-01');
    const distance = daysBetween(anchor, value);
    left = addDays(anchor, Math.floor(distance / days) * days);
    if (left === value) return value;
    right = addDays(left, days);
  }
  if (mode === 'floor') return left;
  if (mode === 'ceil') return right;
  return daysBetween(left, value) < daysBetween(value, right) ? left : right;
}

export function gridDates(width: number, camera: TimelineCamera, step: GridStep): readonly DateOnly[] {
  const range = getVisibleDateRange(width, camera);
  const result: DateOnly[] = [];
  let date = snapDate(range.startDate, step, 'floor');
  while (date <= range.endDateExclusive && result.length < 1500) {
    result.push(date);
    date = nextGridDate(date, step);
  }
  return result;
}

export function isWeekend(value: DateOnly): boolean {
  const day = ((daysBetween(dateOnly('1970-01-05'), value) % 7) + 7) % 7;
  return day === 5 || day === 6;
}
