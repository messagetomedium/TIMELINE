import type { DateInterval, DateOnly } from "../../domain";
import { addDays } from "../../domain";
import { timeFragments } from "../../domain/SegmentAxis";
import type { TimelineCamera } from "../../domain/timeline";
export interface CalendarArea {
  project: DateInterval;
  checkpoints: readonly DateOnly[];
}
export function CalendarShading({
  area,
  camera,
  height,
}: {
  area: CalendarArea | undefined;
  camera: TimelineCamera;
  height: number | string;
}) {
  if (!area) return null;
  return (
    <svg
      className="calendar-shading"
      width="100%"
      height={height}
      aria-hidden="true"
    >
      {timeFragments(area.project, camera).map((f) => (
        <rect
          key={f.startDate}
          className="project-range-shade"
          data-start={f.startDate}
          data-end={f.endDateExclusive}
          x={f.x}
          y="0"
          width={f.width}
          height="100%"
        />
      ))}
      {[...new Set(area.checkpoints)].flatMap((day) =>
        timeFragments(
          { startDate: day, endDateExclusive: addDays(day, 1) },
          camera,
        ).map((f) => (
          <rect
            key={`${day}:${f.startDate}`}
            className="checkpoint-day-shade"
            data-date={day}
            x={f.x}
            y="0"
            width={f.width}
            height="100%"
          />
        )),
      )}
    </svg>
  );
}
