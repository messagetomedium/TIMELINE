import { addDays, daysBetween } from "./dates";
import type { DateOnly, DateInterval } from "./dates";

export const RESULT_COLUMN_WIDTH = 260;
export interface ResultGap {
  readonly stageId: string;
  readonly boundary: DateOnly;
  readonly width: number;
}
export interface AxisCamera {
  readonly originDate: DateOnly;
  readonly pxPerDay: number;
  readonly panX: number;
  readonly gaps?: readonly ResultGap[];
}
export type AxisHit =
  | { kind: "time"; datePosition: number }
  | {
      kind: "resultGap";
      stageId: string;
      boundary: DateOnly;
      fraction: number;
    };
export function xBefore(date: DateOnly, c: AxisCamera) {
  return (
    c.panX +
    daysBetween(c.originDate, date) * c.pxPerDay +
    (c.gaps ?? []).reduce((n, g) => n + (g.boundary < date ? g.width : 0), 0)
  );
}
export function xAfter(date: DateOnly, c: AxisCamera) {
  return (
    xBefore(date, c) +
    (c.gaps ?? []).reduce((n, g) => n + (g.boundary === date ? g.width : 0), 0)
  );
}
export function positionAtX(x: number, c: AxisCamera): AxisHit {
  let extra = 0;
  for (const g of [...(c.gaps ?? [])].sort((a, b) =>
    a.boundary.localeCompare(b.boundary),
  )) {
    const start =
      c.panX + daysBetween(c.originDate, g.boundary) * c.pxPerDay + extra;
    if (x >= start && x < start + g.width)
      return {
        kind: "resultGap",
        stageId: g.stageId,
        boundary: g.boundary,
        fraction: (x - start) / g.width,
      };
    if (x < start) break;
    extra += g.width;
  }
  return { kind: "time", datePosition: (x - c.panX - extra) / c.pxPerDay };
}
/** Calendar position of an anchor. A point inside a column deterministically uses its boundary. */
export function anchorPosition(x: number, c: AxisCamera) {
  const hit = positionAtX(x, c);
  return hit.kind === "time"
    ? hit.datePosition
    : daysBetween(c.originDate, hit.boundary);
}
export function xForPosition(position: number, c: AxisCamera) {
  return (
    c.panX +
    position * c.pxPerDay +
    (c.gaps ?? []).reduce(
      (n, g) =>
        n +
        (daysBetween(c.originDate, g.boundary) <= position + 1e-9
          ? g.width
          : 0),
      0,
    )
  );
}
export function withGaps(
  c: AxisCamera,
  gaps: readonly ResultGap[],
  focusX: number,
): AxisCamera {
  const position = anchorPosition(focusX, c),
    next = { ...c, gaps };
  return { ...next, panX: next.panX + focusX - xForPosition(position, next) };
}
export function timeFragments(value: DateInterval, c: AxisCamera) {
  const cuts = [
    value.startDate,
    ...new Set(
      (c.gaps ?? [])
        .map((g) => g.boundary)
        .filter((b) => b > value.startDate && b < value.endDateExclusive),
    ),
    value.endDateExclusive,
  ].sort();
  return cuts.slice(0, -1).map((startDate, i) => {
    const endDateExclusive = cuts[i + 1] ?? value.endDateExclusive;
    return {
      startDate,
      endDateExclusive,
      x: xAfter(startDate, c),
      width: xBefore(endDateExclusive, c) - xAfter(startDate, c),
    };
  });
}
export function calendarDateAtX(x: number, c: AxisCamera) {
  const h = positionAtX(x, c);
  return h.kind === "resultGap"
    ? h.boundary
    : addDays(c.originDate, Math.floor(h.datePosition + 1e-9));
}
