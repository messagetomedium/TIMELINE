import { describe, expect, it } from "vitest";
import { dateOnly, addDays, daysBetween } from "./dates";
import {
  xBefore,
  xAfter,
  positionAtX,
  timeFragments,
  withGaps,
  anchorPosition,
} from "./SegmentAxis";
import type { AxisCamera } from "./SegmentAxis";
import { widthForInterval, zoomCamera, cameraForFitRange, getVisibleDateRange } from "./timeline";
const origin = dateOnly("2024-02-26"),
  boundary = dateOnly("2024-03-01");
const c: AxisCamera = {
  originDate: origin,
  pxPerDay: 14,
  panX: -17,
  gaps: [
    { stageId: "a", boundary, width: 260 },
    { stageId: "b", boundary: dateOnly("2024-03-08"), width: 260 },
  ],
};
describe("segmented calendar", () => {
  it("round-trips real days before/after multiple gaps, including leap day and negative pan", () => {
    for (let n = -15; n < 30; n++) {
      const date = addDays(origin, n);
      expect(positionAtX(xAfter(date, c) + 3, c)).toEqual({
        kind: "time",
        datePosition: n + 3 / 14,
      });
    }
  });
  it("has two sides of exactly one date and returns no invented date inside a column", () => {
    expect(xAfter(boundary, c) - xBefore(boundary, c)).toBe(260);
    expect(positionAtX(xBefore(boundary, c) + 130, c)).toEqual({
      kind: "resultGap",
      stageId: "a",
      boundary,
      fraction: 0.5,
    });
    expect(
      widthForInterval({ startDate: origin, endDateExclusive: boundary }, c),
    ).toBe(4 * 14);
    expect(positionAtX(xAfter(boundary, c), c)).toEqual({
      kind: "time",
      datePosition: 4,
    });
  });
  it("splits month/week/occupancy geometry without painting gaps or adding duration", () => {
    const interval = {
      startDate: origin,
      endDateExclusive: dateOnly("2024-03-11"),
    };
    const fragments = timeFragments(interval, c);
    expect(fragments).toHaveLength(3);
    expect(fragments.reduce((n, f) => n + f.width, 0)).toBe(
      daysBetween(interval.startDate, interval.endDateExclusive) * 14,
    );
    for (const f of fragments)
      expect(positionAtX(f.x + f.width / 2, c).kind).toBe("time");
  });
  it("keeps fractional calendar anchors during zoom and show/hide", () => {
    const focus = xAfter(dateOnly("2024-03-05"), c) + 6;
    const zoom = zoomCamera(c, 1.25, focus);
    expect(anchorPosition(focus, zoom)).toBeCloseTo(anchorPosition(focus, c));
    const hidden = withGaps(c, [], focus);
    expect(anchorPosition(focus, hidden)).toBeCloseTo(anchorPosition(focus, c));
    expect(withGaps(hidden, c.gaps ?? [], focus).panX).toBeCloseTo(c.panX);
  });
  it("chooses a deterministic gap boundary for a zoom anchor and fits fixed widths separately", () => {
    const x = xBefore(boundary, c) + 60,
      zoom = zoomCamera(c, 1.5, x);
    expect(xAfter(boundary, zoom)).toBeCloseTo(x);
    const fit = cameraForFitRange(
      c,
      { startDate: origin, endDateExclusive: dateOnly("2024-03-08") },
      1000,
    );
    expect(xBefore(dateOnly("2024-03-08"), fit) + 260).toBeCloseTo(976);
  });
  it('keeps a usable calendar when fixed columns alone exceed the viewport',()=>{
    const range={startDate:origin,endDateExclusive:dateOnly('2024-03-08')};
    const fit=cameraForFitRange(c,range,200);
    expect(fit.pxPerDay).toBe(1.5);
    expect(daysBetween(getVisibleDateRange(200,fit).startDate,origin)).toBeLessThan(20);
  });

});
