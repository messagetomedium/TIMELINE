import { expect, it } from "vitest";
import { wheelNavigation, zoomAtPointer } from "./useCanvasNavigation";
import { dateOnly } from "../../domain";
import { positionAtX, xAfter, xBefore } from "../../domain/SegmentAxis";

it("normalizes pixels/lines/pages and Shift wheel, without unbounded or invalid deltas", () => {
  const event = { deltaX: 2.5, deltaY: 3, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false };
  expect(wheelNavigation(event, 500)).toEqual({ x: 2.5, y: 3, scale: 1 });
  expect(wheelNavigation({ ...event, deltaMode: 1 }, 500)).toEqual({ x: 40, y: 48, scale: 1 });
  expect(wheelNavigation({ ...event, deltaX: 0, deltaY: 1, deltaMode: 2 }, 500)).toEqual({ x: 0, y: 500, scale: 1 });
  expect(wheelNavigation({ ...event, deltaX: 0, shiftKey: true }, 500)).toEqual({ x: 3, y: 0, scale: 1 });
  expect(wheelNavigation({ ...event, deltaX: 4, shiftKey: true }, 500)).toEqual({ x: 4, y: 0, scale: 1 });
  expect(wheelNavigation({ ...event, deltaX: Infinity, deltaY: 1e10 }, 500)).toEqual({ x: 0, y: 2000, scale: 1 });
});
it("uses reciprocal pinch scales for Ctrl/Meta and the existing camera zoom limits", () => {
  const event = { deltaX: 0, deltaY: -12, deltaMode: 0, ctrlKey: true, metaKey: false, shiftKey: false };
  const a = wheelNavigation(event, 500), b = wheelNavigation({ ...event, deltaY: 12, ctrlKey: false, metaKey: true }, 500);
  expect(a.scale).toBeGreaterThan(1); expect(a.scale * b.scale).toBeCloseTo(1, 12);
  const camera = { originDate: dateOnly("2026-11-02"), pxPerDay: 14, panX: 48 };
  expect(zoomAtPointer(camera, 1e10, 230).pxPerDay).toBe(48);
  expect(zoomAtPointer(camera, 1e-10, 230).pxPerDay).toBe(1.5);
});
it("keeps fractional dates and result-gap anchors stable through pinch and reverse, without drift", () => {
  const boundary = dateOnly("2026-11-16"), camera = { originDate: dateOnly("2026-11-02"), pxPerDay: 14, panX: -17,
    gaps: [{ stageId: "stage", boundary, width: 260 }] };
  for (const x of [33.75, xAfter(boundary, camera) + 21.5, xBefore(boundary, camera) + 130]) {
    const before = positionAtX(x, camera), zoomed = zoomAtPointer(camera, 1.3, x);
    const after = positionAtX(x, zoomed);
    expect(after.kind).toBe(before.kind);
    if (after.kind === "time" && before.kind === "time") expect(after.datePosition).toBeCloseTo(before.datePosition, 10);
    if (after.kind === "resultGap" && before.kind === "resultGap") expect(after.fraction).toBeCloseTo(before.fraction, 10);
    const restored = zoomAtPointer(zoomed, 1 / 1.3, x);
    expect(restored.pxPerDay).toBeCloseTo(camera.pxPerDay, 10); expect(restored.panX).toBeCloseTo(camera.panX, 10);
  }
});
