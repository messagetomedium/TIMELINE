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
  TimelineCommand,
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
    }
  | { readonly kind: "stage"; readonly id: StageMarkerId };
interface Gesture {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly camera: TimelineCamera;
  readonly document: ProjectDocument;
  readonly scrollTop: number;
  readonly operation: Operation | null;
  last: PreviewResult | null;
  command: TimelineCommand | null;
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
    | ((document: ProjectDocument, command: TimelineCommand) => PreviewResult)
    | undefined;
  readonly onCommand?:
    | ((command: TimelineCommand, expectedRevision: number) => void)
    | undefined;
  readonly onError: (message: string) => void;
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
  evaluate = applyTimelineCommand,
  onCommand,
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
    if (Math.abs(dx) < 3 && !current.last) return;
    const days = Math.round(dx / current.camera.pxPerDay);
    const operation = current.operation;
    let command: TimelineCommand;
    if (operation.kind === "stage") {
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
        command = {
          type: "move",
          target: operation.target,
          days: daysBetween(
            item.startDate,
            snapDate(addDays(item.startDate, days), step),
          ),
        };
      } else {
        const edge =
          operation.action === "start" ? item.startDate : item.endDateExclusive;
        command = {
          type: "resize",
          target: operation.target,
          edge: operation.action,
          date: snapDate(addDays(edge, days), step),
        };
      }
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
    invalid,
    onPointerMove,
    onPointerUp: finish,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    startBar: (
      event: PointerEvent,
      target: Selection,
      action: "move" | "start" | "end",
    ) => {
      begin(event, { kind: "bar", target, action });
    },
    startStage: (event: PointerEvent, id: StageMarkerId) => {
      begin(event, { kind: "stage", id });
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
