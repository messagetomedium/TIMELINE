import { useState } from "react";
import { addDays, dateOnlySchema } from "../../domain";
import { displayDocument, checkpointDate } from "../../domain/v2/model";
import type { Snapshot } from "../../domain/v2/model";
import { applyCommand } from "../../domain/v2/commands";
import type { ContentCommand } from "../../domain/v2/commands";
import type { Selection } from "../../application/timelineCommands";
import type { ViewPreferences, ProjectId } from "../../domain";
import { TimelineWorkspace } from "./TimelineWorkspace";
import { layoutTimeline } from "../../application/timelineLayout";
import { xForDate, widthForInterval } from "../../domain/timeline";

type Special = { kind: "stage" | "checkpoint" | "project"; id: string };
export function FoundationTimeline({
  snapshot,
  onCommand,
  onUndo,
  onRedo,
  history,
  view,
  onView,
}: {
  snapshot: Snapshot;
  onCommand: (c: ContentCommand) => Promise<boolean>;
  onUndo: () => void;
  onRedo: () => void;
  history: { canUndo: boolean; canRedo: boolean };
  view: ViewPreferences | undefined;
  onView: (id: ProjectId, v: ViewPreferences) => void;
}) {
  const [special, setSpecial] = useState<Special | null>(null);
  const document = displayDocument(snapshot);
  return (
    <TimelineWorkspace
      document={document}
      initialView={view}
      onViewChange={onView}
      onCommit={() => {
        throw Error("V2 requires a command");
      }}
      onCreateWork={() => Promise.resolve(null)}
      foundation={{
        layout: (d, expanded) => {
          const parts = snapshot.stages.map((s) => {
            const processes = d.processes.filter(
              (p) =>
                snapshot.processes.find((x) => x.id === p.id)?.stageId === s.id,
            );
            const ids = new Set(processes.map((p) => p.id));
            return layoutTimeline(
              {
                ...d,
                processes,
                lanes: d.lanes.filter((l) =>
                  l.kind === "process"
                    ? processes.some((p) => p.laneId === l.id)
                    : ids.has(l.processId),
                ),
              },
              expanded,
            );
          });
          return {
            rows: parts.flatMap((p) => p.rows),
            groups: parts.flatMap((p) => p.groups),
            height: Math.max(...parts.map((p) => p.height)),
          };
        },
        evaluate: (_, command) => {
          try {
            return {
              ok: true,
              document: displayDocument(
                applyCommand(snapshot, { type: "Timeline", command }),
              ),
            };
          } catch (e) {
            return {
              ok: false,
              error: e instanceof Error ? e.message : "Изменение отклонено",
            };
          }
        },
        onCommand: (command) => {
          void onCommand({ type: "Timeline", command });
        },
        onSelect: () => {
          setSpecial(null);
        },
        stages: (camera, width) => (
          <div className="stage-band" aria-label="Этапы производства">
            {snapshot.stages.map((s, i) => {
              const left = xForDate(s.startDate, camera);
              return (
                <div
                  className={`stage-region stage-color-${String(i % 4)}`}
                  key={s.id}
                  style={{ left, width: widthForInterval(s, camera) }}
                >
                  <button
                    data-interactive
                    className="stage-label-content stage-select"
                    aria-label={`Этап: ${s.title}`}
                    style={{ left: Math.max(0, -left), maxWidth: width }}
                    onClick={() => {
                      setSpecial({ kind: "stage", id: s.id });
                    }}
                  >
                    <span className="stage-name">{s.title}</span>
                    <span className="stage-date">
                      {s.startDate.split("-").reverse().join(".")}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ),
        checkpoints: (camera) =>
          snapshot.checkpoints.map((c) => (
            <button
              data-interactive
              key={c.id}
              className="checkpoint-line"
              data-checkpoint-id={c.id}
              data-date={checkpointDate(snapshot, c)}
              style={{
                left: xForDate(checkpointDate(snapshot, c), camera) + camera.pxPerDay,
              }}
              aria-label={`Чекпойнт: ${c.title}`}
              onClick={() => {
                setSpecial({ kind: "checkpoint", id: c.id });
              }}
            >
              <span>
                ● {c.title}
                <small>{checkpointDate(snapshot, c)}</small>
              </span>
            </button>
          )),
        toolbar: (
          <>
            <button
              aria-label="Отменить"
              disabled={!history.canUndo}
              onClick={onUndo}
            >
              ↶
            </button>
            <button
              aria-label="Повторить"
              disabled={!history.canRedo}
              onClick={onRedo}
            >
              ↷
            </button>
            <button
              className="navigation-button"
              onClick={() => {
                setSpecial({ kind: "project", id: snapshot.project.id });
              }}
            >
              Проект
            </button>
            <span className="toolbar-separator" />
          </>
        ),
        inspector: (selection) => (
          <FoundationInspector
            key={`${special?.id ?? selection?.id ?? "none"}:${String(snapshot.project.revision)}`}
            snapshot={snapshot}
            target={special ?? selection}
            onCommand={onCommand}
          />
        ),
      }}
    />
  );
}
function FoundationInspector({
  snapshot,
  target,
  onCommand,
}: {
  snapshot: Snapshot;
  target: Special | Selection | null;
  onCommand: (c: ContentCommand) => Promise<boolean>;
}) {
  const checkpoint =
    target?.kind === "checkpoint"
      ? snapshot.checkpoints.find((c) => c.id === target.id)
      : null;
  const item =
    target?.kind === "project"
      ? snapshot.project
      : target?.kind === "stage"
        ? snapshot.stages.find((s) => s.id === target.id)
        : target?.kind === "process"
          ? snapshot.processes.find((p) => p.id === target.id)
          : snapshot.tasks.find((t) => t.id === target?.id);
  const initialTitle =
    checkpoint?.title ??
    (item && "name" in item
      ? item.name
      : item && "title" in item
        ? item.title
        : "");
  const initialDescription =
    checkpoint?.note ??
    (item && "description" in item
      ? item.description
      : item && "details" in item
        ? item.details
        : "") ??
    "";
  const [title, setTitle] = useState(initialTitle),
    [description, setDescription] = useState(initialDescription);
  const [date, setDate] = useState(
    checkpoint ? checkpointDate(snapshot, checkpoint) : "",
  );
  const [anchor, setAnchor] = useState(
    checkpoint?.timing.anchor === "project_end",
  );
  if (!target)
    return (
      <aside className="details-inspector" aria-label="Свойства элемента">
        Выберите элемент
      </aside>
    );
  const kind = target.kind;
  const labels = {
    project: "Проект",
    stage: "Этап",
    process: "Процесс",
    task: "Задача",
    checkpoint: "Чекпойнт",
  };
  const saveTitle = () => {
    if (title !== initialTitle && kind !== "checkpoint")
      void onCommand({ type: "Rename", kind, id: target.id, value: title });
  };
  const saveDescription = () => {
    if (description !== initialDescription && kind !== "checkpoint")
      void onCommand({
        type: "Describe",
        kind,
        id: target.id,
        value: description,
      });
  };
  return (
    <aside
      className="details-inspector"
      aria-label="Свойства элемента"
      data-selected-id={target.id}
    >
      <div className="inspector-top">
        <p className="inspector-kicker">СВОЙСТВА</p>
        <span className="inspector-type">{labels[kind]}</span>
      </div>
      <label className="inspector-label" htmlFor="v2-title">
        Название
      </label>
      <textarea
        id="v2-title"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            setTitle(initialTitle);
            e.stopPropagation();
          }
        }}
      />
      <label className="inspector-label" htmlFor="v2-description">
        {checkpoint ? "Заметка" : "Описание"}
      </label>
      <textarea
        id="v2-description"
        rows={4}
        value={description}
        onChange={(e) => {
          setDescription(e.target.value);
        }}
        onBlur={saveDescription}
      />
      {checkpoint ? (
        <>
          <label className="inspector-label" htmlFor="checkpoint-date">
            Дата чекпойнта
          </label>
          <input
            id="checkpoint-date"
            type="date"
            disabled={anchor}
            value={
              anchor ? addDays(snapshot.project.endDateExclusive, -1) : date
            }
            onChange={(e) => {
              setDate(e.target.value);
            }}
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={anchor}
              onChange={(e) => {
                setAnchor(e.target.checked);
                if (!e.target.checked)
                  setDate(checkpointDate(snapshot, checkpoint));
              }}
            />
            Привязать к дате окончания проекта
          </label>
          <p className="inspector-note">
            При привязке дата следует за включительным окончанием проекта.
            Свободная дата сохраняется при изменении его длительности.
          </p>
          <button
            className="primary-button"
            disabled={!title.trim() || (!anchor && !dateOnlySchema.safeParse(date).success)}
            onClick={() => {
              void onCommand({
                type: "UpdateCheckpoint",
                id: checkpoint.id,
                title,
                note: description,
                timing: anchor
                  ? { anchor: "project_end" }
                  : { anchor: "free", date: dateOnlySchema.parse(date) },
              });
            }}
          >
            Сохранить чекпойнт
          </button>
        </>
      ) : item && "startDate" in item ? (
        <div className="inspector-section">
          <span className="inspector-label">Даты</span>
          <p>
            {item.startDate} — {addDays(item.endDateExclusive, -1)}
          </p>
        </div>
      ) : null}
      {kind === "process" && item && "stageId" in item && (
        <p>Этап: {snapshot.stages.find((s) => s.id === item.stageId)?.title}</p>
      )}
      <p className="inspector-note">
        Перенос и изменение длительности доступны внутри своего этапа. Изменение границ этапов и каскадные переносы пока недоступны.
      </p>
      <p className="memory-notice">
        Сохранено локально в этом браузере. История отмены действует в текущем
        сеансе.
      </p>
    </aside>
  );
}
