import type { StackDrop } from "./groupDrop";
import type { GroupMove } from "../../domain/v2/work";
import type { GestureCommand } from "../../domain/v2/gesture";
import { positionAtX, anchorPosition } from "../../domain/SegmentAxis";
import type { DateOnly } from "../../domain";
import type { Snapshot } from "../../domain/v2/model";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, PointerEvent, RefObject, SetStateAction } from "react";
import { addDays, daysBetween } from "../../domain";
import type { GridStep, ProjectDocument, StageMarkerId } from "../../domain";
import { snapDate } from "../../domain/timeline";
import type { TimelineCamera } from "../../domain/timeline";
import { applyTimelineCommand } from "../../application/timelineCommands";
import type {
  CommandResult,
  Selection,
} from "../../application/timelineCommands";

export type PreviewResult = CommandResult & {
  snapshot?: Snapshot;
  affectedIds?: readonly string[];
};
type Operation =
  | {
      readonly kind: "bar";
      readonly target: Selection;
      readonly action: "move" | "start" | "end";
      readonly ids: readonly string[];
      readonly rows: readonly { sourceLaneId: string; laneId: string }[];
    }
  | { readonly kind: "stage"; readonly id: StageMarkerId }
  | {
      readonly kind: "checkpoint";
      readonly id: string;
      readonly date: DateOnly;
    };
interface Gesture {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly camera: TimelineCamera;
  readonly document: ProjectDocument;
  readonly scrollTop: number;
  readonly operation: Operation | null;
  last: PreviewResult | null;
  command: GestureCommand | null;
  direction: "horizontal" | "vertical" | null;
}
interface Props {
  readonly document: ProjectDocument;
  readonly camera: TimelineCamera;
  readonly step: GridStep;
  readonly surface: RefObject<HTMLDivElement | null>;
  readonly body: RefObject<HTMLDivElement | null>;
  readonly setCamera: Dispatch<SetStateAction<TimelineCamera>>;
  readonly onCommit: (document: ProjectDocument) => void;
  readonly evaluate?:
    | ((document: ProjectDocument, command: GestureCommand) => PreviewResult)
    | undefined;
  readonly onCommand?:
    | ((command: GestureCommand, expectedRevision: number) => void)
    | undefined;
  readonly onError: (message: string) => void;
  readonly stack?:
    | ((document: ProjectDocument, drop: StackDrop) => GroupMove)
    | undefined;
  readonly onStageClick: (id: StageMarkerId) => void;
}

export function useTimelineGesture({
  document,
  camera,
  step,
  surface,
  body,
  setCamera,
  onCommit,
  onError,
  onStageClick,
  evaluate = (d, c) =>
    c.type === "checkpoint" || c.type === "GroupMove"
      ? { ok: false, error: "Чекпойнты доступны в редакторе V2" }
      : applyTimelineCommand(d, c),
  onCommand,
  stack,
}: Props) {
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<ProjectDocument | null>(null);
  const [active, setActive] = useState<"pan" | "edit" | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [details, setDetails] = useState<PreviewResult | null>(null);

  const cancel = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.operation === null) {
      setCamera(current.camera);
      if (body.current) body.current.scrollTop = current.scrollTop;
    }
    setPreview(null);
    setDetails(null);
    setActive(null);
    setInvalid(false);
    if (current && surface.current?.hasPointerCapture(current.pointerId))
      surface.current.releasePointerCapture(current.pointerId);
  }, [body, setCamera, surface]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
    };
  }, [cancel]);

  const begin = (event: PointerEvent, operation: Operation | null) => {
    if (gesture.current || (operation && event.button !== 0)) return;
    if (
      window.document.activeElement instanceof HTMLInputElement ||
      window.document.activeElement instanceof HTMLTextAreaElement
    )
      window.document.activeElement.blur();
    event.preventDefault();
    event.stopPropagation();
    onError("");
    gesture.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      camera,
      document,
      scrollTop: body.current?.scrollTop ?? 0,
      operation,
      last: null,
      command: null,
      direction: null,
    };
    surface.current?.setPointerCapture(event.pointerId);
    setActive(operation ? "edit" : "pan");
  };

  const onPointerMove = (event: PointerEvent) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.document.project.revision !== document.project.revision) {
      cancel();
      onError("Проект изменился во время жеста. Повторите перенос.");
      return;
    }
    const dx = event.clientX - current.x;
    if (!current.operation) {
      setCamera({
        ...current.camera,
        panX: Math.max(-20000, Math.min(20000, current.camera.panX + dx)),
      });
      if (body.current)
        body.current.scrollTop =
          current.scrollTop - (event.clientY - current.y);
      return;
    }
    const dy = event.clientY - current.y;
    if (Math.hypot(dx, dy) < 6 && !current.last) return;
    current.direction ??=
      Math.abs(dy) > Math.abs(dx) ? "vertical" : "horizontal";
    const left =
      surface.current?.querySelector(".calendar-time")?.getBoundingClientRect()
        .left ?? 0;
    const hit = positionAtX(event.clientX - left, current.camera);
    if (hit.kind === "resultGap") {
      current.last = {
        ok: false,
        error:
          "Перенос внутри колонки результатов недоступен. Отпустите объект на календаре.",
      };
      setInvalid(true);
      onError(current.last.error);
      return;
    }
    let command: GestureCommand;
    try {
      const days = Math.round(
        hit.datePosition - anchorPosition(current.x - left, current.camera),
      );
      const operation = current.operation;
      if (operation.kind === "checkpoint") {
        command = {
          type: "checkpoint",
          id: operation.id,
          date: snapDate(addDays(operation.date, days), step),
        };
      } else if (operation.kind === "stage") {
        const stage = current.document.stageMarkers.find(
          (item) => item.id === operation.id,
        );
        if (!stage) return;
        command = {
          type: "stage",
          id: stage.id,
          date: snapDate(addDays(stage.date, days), step),
        };
      } else {
        const item =
          operation.target.kind === "process"
            ? current.document.processes.find(
                (item) => item.id === operation.target.id,
              )
            : current.document.tasks.find(
                (item) => item.id === operation.target.id,
              );
        if (!item) return;
        if (operation.action === "move") {
          const delta =
            stack && current.direction === "vertical" && Math.abs(dx) < 6
              ? 0
              : daysBetween(
                  item.startDate,
                  snapDate(addDays(item.startDate, days), step),
                );
          command = stack
            ? current.direction === "vertical"
              ? stack(current.document, {
                  kind: operation.target.kind,
                  ids: operation.ids,
                  days: delta,
                  date: addDays(
                    current.camera.originDate,
                    Math.floor(hit.datePosition + 1e-9),
                  ),
                  y:
                    event.clientY -
                    (body.current?.getBoundingClientRect().top ?? 0) +
                    (body.current?.scrollTop ?? 0),
                  rows: operation.rows,
                })
              : {
                  type: "GroupMove",
                  kind: operation.target.kind,
                  ids: [...operation.ids],
                  days: delta,
                }
            : {
                type: "move",
                target: operation.target,
                days: daysBetween(
                  item.startDate,
                  snapDate(addDays(item.startDate, days), step),
                ),
              };
        } else {
          const edge =
            operation.action === "start"
              ? item.startDate
              : item.endDateExclusive;
          command = {
            type: "resize",
            target: operation.target,
            edge: operation.action,
            date: snapDate(addDays(edge, days), step),
          };
        }
      }
    } catch (e) {
      current.last = {
        ok: false,
        error: e instanceof Error ? e.message : "Перенос недоступен",
      };
      setPreview(null);
      setDetails(null);
      setInvalid(true);
      onError(current.last.error);
      return;
    }
    current.command = command;
    current.last = evaluate(current.document, command);
    setPreview(current.last.ok ? current.last.document : null);
    setDetails(current.last.ok ? current.last : null);
    setInvalid(!current.last.ok);
    onError(current.last.ok ? "" : current.last.error);
  };

  const finish = (event: PointerEvent) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.document.project.revision !== document.project.revision) {
      cancel();
      onError("Проект изменился во время жеста. Повторите перенос.");
      return;
    }
    const left =
      surface.current?.querySelector(".calendar-time")?.getBoundingClientRect()
        .left ?? 0;
    if (
      current.operation &&
      current.last &&
      positionAtX(event.clientX - left, current.camera).kind === "resultGap"
    ) {
      cancel();
      onError(
        "Перенос внутри колонки результатов недоступен. Отпустите объект на календаре.",
      );
      return;
    }
    gesture.current = null;
    if (current.last?.ok) {
      if (onCommand && current.command)
        onCommand(current.command, current.document.project.revision);
      else onCommit(current.last.document);
    }
    if (!current.last && current.operation?.kind === "stage")
      onStageClick(current.operation.id);
    setPreview(null);
    setDetails(null);
    setActive(null);
    setInvalid(false);
    if (surface.current?.hasPointerCapture(event.pointerId))
      surface.current.releasePointerCapture(event.pointerId);
  };

  return {
    preview,
    snapshot: details?.snapshot,
    affectedIds: details?.affectedIds ?? [],
    active,
    command: gesture.current?.command ?? null,
    invalid,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    startBar: (
      event: PointerEvent,
      target: Selection,
      action: "move" | "start" | "end",
      ids: readonly string[] = [target.id],
    ) => {
      const items =
        target.kind === "process" ? document.processes : document.tasks;
      const rows = [
        ...new Set(
          items.filter((x) => ids.includes(x.id)).map((x) => x.laneId),
        ),
      ].map((sourceLaneId) => ({ sourceLaneId, laneId: crypto.randomUUID() }));
      begin(event, { kind: "bar", target, action, ids, rows });
    },
    startStage: (event: PointerEvent, id: StageMarkerId) => {
      begin(event, { kind: "stage", id });
    },
    startCheckpoint: (event: PointerEvent, id: string, date: DateOnly) => {
      begin(event, { kind: "checkpoint", id, date });
    },
    startPan: (event: PointerEvent) => {
      const target = event.target;
      if (
        event.button === 1 ||
        (event.button === 0 &&
          target instanceof Element &&
          !target.closest("[data-interactive]"))
      )
        begin(event, null);
    },
  };
}
