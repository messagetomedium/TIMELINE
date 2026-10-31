import { useState } from "react";
import { addDays, dateOnlySchema } from "../../domain";
import { displayDocument, checkpointDate } from "../../domain/v2/model";
import type { Snapshot } from "../../domain/v2/model";
import { planCommand } from "../../domain/v2/commands";
import type { Selection } from "../../application/timelineCommands";
import type { ViewPreferences, ProjectId, StageMarkerId } from "../../domain";
import { stageMarkerIdSchema } from "../../domain";
import {
  InsertStageDialog,
  StageActions,
  DateCommandField,
} from "./StageControls";
import type { StageBoundary, SendCommand } from "./StageControls";
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
  onCommand: SendCommand;
  onUndo: () => void;
  onRedo: () => void;
  history: { canUndo: boolean; canRedo: boolean };
  view: ViewPreferences | undefined;
  onView: (id: ProjectId, v: ViewPreferences) => void;
}) {
  const [special, setSpecial] = useState<Special | null>(null);
  const document = displayDocument(snapshot);
  const [inserting, setInserting] = useState<StageBoundary | null>(null);
  const stageIds = new Set(snapshot.stages.map((s) => s.id));
  const currentSpecial =
    special?.kind === "stage" && !stageIds.has(special.id)
      ? { kind: "project" as const, id: snapshot.project.id }
      : special;
  return (
    <>
      {" "}
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
                  snapshot.processes.find((x) => x.id === p.id)?.stageId ===
                  s.id,
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
              const plan = planCommand(snapshot, { type: "Timeline", command });
              return {
                ok: true,
                document: displayDocument(plan.document),
                snapshot: plan.document,
                affectedIds: plan.affectedIds,
              };
            } catch (e) {
              return {
                ok: false,
                error: e instanceof Error ? e.message : "Изменение отклонено",
              };
            }
          },
          onCommand: (command, revision) => {
            void onCommand({ type: "Timeline", command }, revision);
          },
          onStageSelect: (id: StageMarkerId) => {
            setSpecial({ kind: "stage", id });
          },
          onSelect: () => {
            setSpecial(null);
          },
          stages: (camera, width, preview, start) => {
            const scene = preview ?? snapshot,
              stages = [...scene.stages].sort(
                (a, b) => a.sortIndex - b.sortIndex,
              );
            return (
              <div
                className="stage-band foundation-stage-band"
                aria-label="Этапы производства"
              >
                {stages.map((s, i) => {
                  const left = xForDate(s.startDate, camera);
                  const affected =
                    snapshot.stages.find((x) => x.id === s.id)?.revision !==
                    s.revision;
                  return (
                    <div
                      key={s.id}
                      className={`stage-region stage-color-${String(i % 4)} ${affected ? "stage-affected" : ""}`}
                      style={{ left, width: widthForInterval(s, camera) }}
                    >
                      <button
                        data-interactive
                        className="stage-label-content stage-select"
                        aria-label={`Этап: ${s.title}`}
                        style={{ left: Math.max(12, -left), maxWidth: width }}
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
                {stages.map((s) => (
                  <button
                    data-interactive
                    className="stage-grip"
                    data-stage-id={s.id}
                    data-date={s.startDate}
                    key={`grip:${s.id}`}
                    style={{ left: xForDate(s.startDate, camera) }}
                    aria-label={`Перенести границу: ${s.title}`}
                    onPointerDown={(e) => {
                      start(e, stageMarkerIdSchema.parse(s.id));
                    }}
                  />
                ))}
                {[
                  ...stages.map((s, i) => ({
                    date: s.startDate,
                    leftStageId: stages[i - 1]?.id ?? null,
                    rightStageId: s.id,
                  })),
                  {
                    date: scene.project.endDateExclusive,
                    leftStageId: stages.at(-1)?.id ?? null,
                    rightStageId: null,
                  },
                ].map((b) => (
                  <button
                    data-interactive
                    className="insert-stage-button"
                    key={b.rightStageId ?? "end"}
                    style={{ left: xForDate(b.date, camera) }}
                    aria-label={
                      b.rightStageId
                        ? `Вставить этап перед: ${stages.find((s) => s.id === b.rightStageId)?.title ?? ""}`
                        : "Вставить этап в конец"
                    }
                    onClick={() => {
                      setInserting({
                        leftStageId: b.leftStageId,
                        rightStageId: b.rightStageId,
                      });
                    }}
                  >
                    +
                  </button>
                ))}
              </div>
            );
          },
          checkpoints: (camera, preview) => {
            const scene = preview ?? snapshot;
            return scene.checkpoints.map((c) => (
              <button
                data-interactive
                key={c.id}
                className="checkpoint-line"
                data-checkpoint-id={c.id}
                data-date={checkpointDate(scene, c)}
                style={{
                  left:
                    xForDate(checkpointDate(scene, c), camera) +
                    camera.pxPerDay,
                }}
                aria-label={`Чекпойнт: ${c.title}`}
                onClick={() => {
                  setSpecial({ kind: "checkpoint", id: c.id });
                }}
              >
                <span>
                  ● {c.title}
                  <small>{checkpointDate(scene, c)}</small>
                </span>
              </button>
            ));
          },
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
          inspector: (selection, preview) => (
            <FoundationInspector
              key={`${currentSpecial?.id ?? selection?.id ?? "none"}:${String(snapshot.project.revision)}`}
              snapshot={preview ?? snapshot}
              target={currentSpecial ?? selection}
              onCommand={onCommand}
            />
          ),
        }}
      />
      {inserting && (
        <InsertStageDialog
          boundary={inserting}
          onCommand={onCommand}
          onClose={() => {
            setInserting(null);
          }}
        />
      )}
    </>
  );
}
function FoundationInspector({
  snapshot,
  target,
  onCommand,
}: {
  snapshot: Snapshot;
  target: Special | Selection | null;
  onCommand: SendCommand;
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
            disabled={
              !title.trim() ||
              (!anchor && !dateOnlySchema.safeParse(date).success)
            }
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
      {kind === "stage" && (
        <StageActions
          snapshot={snapshot}
          id={target.id}
          onCommand={onCommand}
        />
      )}
      {kind === "project" && (
        <section className="stage-actions">
          <h3>Границы проекта</h3>
          <DateCommandField
            label="Начало проекта"
            value={snapshot.project.startDate}
            apply={(date) =>
              onCommand({ type: "ResizeProject", edge: "start", date })
            }
          />
          <DateCommandField
            label="Окончание проекта включительно"
            value={addDays(snapshot.project.endDateExclusive, -1)}
            apply={(date) =>
              onCommand({
                type: "ResizeProject",
                edge: "end",
                date: addDays(date, 1),
              })
            }
          />
          <p className="inspector-note">
            Изменение границ не переносит работы. Перенос целого проекта — за
            ручку в портфеле.
          </p>
        </section>
      )}
      <p className="inspector-note">
        Работы толкают соседей в своей строке. Родители расширяются при
        необходимости; один жест — одна отмена.
      </p>
      <p className="memory-notice">
        Сохранено локально в этом браузере. История отмены действует в текущем
        сеансе.
      </p>
    </aside>
  );
}
