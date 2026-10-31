import type { CSSProperties } from "react";
import type { Snapshot } from "../../domain/v2/model";
import { displayDocument } from "../../domain/v2/model";
import type { CatalogData } from "../../domain/v2/peopleModel";
import { occupancy } from "../../domain/v2/occupancy";
import type { TimelineCamera } from "../../domain/timeline";
import type { CalendarGeometry } from "../../domain/calendar";
import type { DateOnly } from "../../domain";
import { checkpointDate } from "../../domain/v2/model";
import { timeFragments } from "../../domain/SegmentAxis";
import { DateLines, TimeGrid } from "./CalendarLayers";
import { CheckpointLines } from "./CheckpointLayer";
export interface PeopleTimelineProps {
  camera: TimelineCamera;
  width: number;
  calendar: CalendarGeometry;
  weekends: boolean;
  today: DateOnly;
  hovered: string | null;
  onHover: (id: string | null) => void;
}
export function PeopleTimeline({
  snapshot,
  catalog,
  camera,
  width,
  calendar,
  weekends,
  today,
  hovered,
  onHover,
}: PeopleTimelineProps & { snapshot: Snapshot; catalog: CatalogData }) {
  const rows = occupancy(snapshot, catalog),
    height = Math.max(44, rows.length * 28 + 12);
  const related = new Set([
    hovered,
    ...snapshot.tasks.filter((t) => t.processId === hovered).map((t) => t.id),
  ]);
  return (
    <section className="performers-section" aria-label="Занятость исполнителей">
      <header className="performers-heading">
        <h2>Исполнители</h2>
        <span>
          Занятость · {rows.filter((r) => !r.id.startsWith("role:")).length}{" "}
          человек <i /> Общая ось времени · только просмотр
        </span>
      </header>
      <div className="performers-scroll">
        <div className="performers-canvas" style={{ height }}>
          <div className="performers-time-background">
            <TimeGrid
              camera={camera}
              width={width}
              height={height}
              calendar={calendar}
              weekends={weekends}
              area={{
                project: snapshot.project,
                checkpoints: snapshot.checkpoints.map((c) =>
                  checkpointDate(snapshot, c),
                ),
              }}
            />
            <DateLines
              document={displayDocument(snapshot)}
              camera={camera}
              today={today}
              height={height}
              showTodayLabel={false}
            />
            <CheckpointLines snapshot={snapshot} camera={camera} />
          </div>
          {!rows.length && (
            <p className="people-empty">
              Назначьте руководителя процесса или исполнителя задачи в
              инспекторе.
            </p>
          )}
          {rows.map((row, index) => (
            <div
              key={row.id}
              data-person-id={row.id}
              data-highlighted={row.items.some((w) => related.has(w.id))}
              className={`performer-row ${row.items.some((w) => related.has(w.id)) ? "highlighted" : ""}`}
              style={{ top: 6 + index * 28 }}
            >
              <span
                className="performer-name"
                title={`${row.role} · ${row.name}`}
              >
                <strong>{row.role}</strong> · {row.name}
              </span>
              <div className="performer-track">
                {row.segments.flatMap((segment) =>
                  timeFragments(segment, camera).map((f) => (
                    <div
                      key={`${segment.startDate}:${f.startDate}`}
                      data-interactive
                      data-target-ids={segment.targetIds.join(",")}
                      data-overlap={segment.targetIds.length > 1}
                      className={`performer-segment ${segment.targetIds.some((id) => related.has(id)) ? "linked" : ""}`}
                      style={
                        {
                          left: f.x,
                          width: f.width,
                          "--bar-color": segment.colors[0],
                          background:
                            segment.colors.length > 1
                              ? `repeating-linear-gradient(135deg,${segment.colors.flatMap((c, i) => [`${c} ${String(i * 7)}px`, `${c} ${String((i + 1) * 7)}px`]).join(",")})`
                              : segment.colors[0],
                        } as CSSProperties
                      }
                      title={segment.title}
                      onMouseEnter={() => {
                        onHover(segment.targetIds[0] ?? null);
                      }}
                      onMouseLeave={() => {
                        onHover(null);
                      }}
                    />
                  )),
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
