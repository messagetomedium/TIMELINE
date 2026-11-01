import type { DateInterval } from "./dates";
import type { TimelineCamera } from "./timeline";
import { xAfter, xBefore } from "./SegmentAxis";
export interface SceneBar extends DateInterval {
  id: string;
  y: number;
}
/** Insets are pixels only. Dates and hit-test coordinates continue to use the calendar axis. */
export function barGeometry(
  item: SceneBar,
  scene: readonly SceneBar[],
  camera: TimelineCamera,
) {
  const start = xAfter(item.startDate, camera),
    end = xBefore(item.endDateExclusive, camera),
    half = Math.min(
      4,
      camera.pxPerDay * 0.225,
      Math.max(0, (end - start) * 0.18),
    );
  const touches = (other: SceneBar, edge: "start" | "end") =>
    other.id !== item.id &&
    other.y === item.y &&
    (edge === "start"
      ? other.endDateExclusive === item.startDate &&
        Math.abs(xBefore(other.endDateExclusive, camera) - start) < 0.01
      : other.startDate === item.endDateExclusive &&
        Math.abs(xAfter(other.startDate, camera) - end) < 0.01);
  const left = scene.some((x) => touches(x, "start")) ? half : 0,
    right = scene.some((x) => touches(x, "end")) ? half : 0;
  return {
    left: start + left,
    width: Math.max(0.1, end - start - left - right),
    timeStart: start,
    timeEnd: end,
    startInset: left,
    endInset: right,
  };
}
