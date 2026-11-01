import type { Snapshot } from "./model";
import { checkpointDate } from "./model";
import { addDays } from "../dates";
import { xBefore } from "../SegmentAxis";
import type { TimelineCamera } from "../timeline";
/** Labels reserve independent rows when their screen rectangles intersect. */
export function checkpointScene(
  d: Snapshot,
  camera: TimelineCamera,
  width: number,
) {
  const rows: { left: number; right: number }[][] = [];
  const labels = [...d.checkpoints]
    .sort(
      (a, b) =>
        checkpointDate(d, a).localeCompare(checkpointDate(d, b)) ||
        a.id.localeCompare(b.id),
    )
    .map((c) => {
      const x = xBefore(addDays(checkpointDate(d, c), 1), camera),
        left = Math.max(4, Math.min(x + 10, Math.max(4, width - 190))),
        labelWidth = Math.min(190, Math.max(80, c.title.length * 6 + 76));
      let lane = rows.findIndex((xs) =>
        xs.every(
          (old) => left + labelWidth + 8 <= old.left || left >= old.right + 8,
        ),
      );
      if (lane < 0) {
        lane = rows.length;
        rows.push([]);
      }
      rows[lane]?.push({ left, right: left + labelWidth });
      return { checkpoint: c, x, left, y: lane * 25, labelWidth };
    });
  return { labels, height: labels.length ? rows.length * 25 + 6 : 0 };
}
