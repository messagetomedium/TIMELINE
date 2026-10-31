import { checkpointScene } from "../../domain/v2/checkpointLayout";
import type { PointerEvent } from "react";
import type { Snapshot } from "../../domain/v2/model";
import { checkpointDate } from "../../domain/v2/model";
import { addDays } from "../../domain";
import { xBefore } from "../../domain/SegmentAxis";
import type { TimelineCamera } from "../../domain/timeline";
export function CheckpointHeaders({
  snapshot,
  camera,
  width,
  onSelect,
  onStart,
}: {
  snapshot: Snapshot;
  camera: TimelineCamera;
  width: number;
  onSelect: (id: string) => void;
  onStart: (
    e: PointerEvent,
    id: string,
    date: import("../../domain").DateOnly,
  ) => void;
}) {
  return (
    <div className="checkpoint-headers">
      {checkpointScene(snapshot, camera, width).labels.map(
        ({ checkpoint: c, x, left, y, labelWidth }) => (
          <div key={c.id}>
            <div
              className="checkpoint-header-line"
              style={{ left: x, top: y + 9 }}
            />
            <button
              data-interactive
              className="checkpoint-grip"
              data-checkpoint-id={c.id}
              data-date={checkpointDate(snapshot, c)}
              style={{ left: x, top: y + 4 }}
              aria-label={`Чекпойнт: ${c.title}`}
              title={
                c.timing.anchor === "project_end"
                  ? "Привязан к окончанию проекта. Для ручного переноса снимите привязку в свойствах."
                  : "Перетащите круг для изменения даты. Esc — отмена."
              }
              onPointerDown={(e) => {
                if (c.timing.anchor === "free") {
                  onStart(e, c.id, checkpointDate(snapshot, c));
                  onSelect(c.id);
                }
              }}
              onClick={() => {
                onSelect(c.id);
              }}
            />
            <button
              className="checkpoint-header-label"
              data-interactive
              style={{ left, top: y, width: labelWidth }}
              title={c.title}
              onClick={() => {
                onSelect(c.id);
              }}
            >
              <strong>{c.title}</strong>
              <small>
                {checkpointDate(snapshot, c).split("-").reverse().join(".")}
              </small>
            </button>
          </div>
        ),
      )}
    </div>
  );
}
export function CheckpointLines({
  snapshot,
  camera,
  onSelect,
}: {
  snapshot: Snapshot;
  camera: TimelineCamera;
  onSelect?: ((id: string) => void) | undefined;
}) {
  return (
    <div className="checkpoint-lines" aria-hidden={onSelect ? undefined : true}>
      {snapshot.checkpoints.map((c) => {
        const props = {
          "data-checkpoint-id": c.id,
          "data-date": checkpointDate(snapshot, c),
          style: {
            left: xBefore(addDays(checkpointDate(snapshot, c), 1), camera),
          },
        };
        return onSelect ? (
          <button
            key={c.id}
            {...props}
            data-interactive
            className="checkpoint-line checkpoint-select-line"
            aria-label={`Свойства чекпойнта: ${c.title}`}
            onClick={() => {
              onSelect(c.id);
            }}
          />
        ) : (
          <div key={c.id} {...props} className="checkpoint-line" />
        );
      })}
    </div>
  );
}
