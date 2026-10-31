import { useRef, useState } from "react";
import { addDays, dateOnlySchema } from "../../domain";
import { displayDocument, checkpointDate } from "../../domain/v2/model";
import type { Snapshot } from "../../domain/v2/model";
import { RESULT_COLUMN_WIDTH, xBefore } from "../../domain/SegmentAxis";
import { resultLayout } from "../../domain/v2/results";
import { ResultFields, ResultColumns } from "./ResultUI";
import { CommitText } from "./CommitText";
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

type Special = {
  kind: "stage" | "checkpoint" | "project" | "result";
  id: string;
};
function processPositions(
  scene: Snapshot,
  layout: ReturnType<typeof layoutTimeline>,
) {
  return new Map(
    scene.processes.map((p) => [
      p.id,
      layout.rows.find((r) => r.kind === "process" && r.id === p.laneId)?.y ??
        18,
    ]),
  );
}
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
              const plan = planCommand(
                snapshot,
                command.type === "checkpoint"
                  ? {
                      type: "SetCheckpointTiming",
                      id: command.id,
                      timing: { anchor: "free", date: command.date },
                    }
                  : { type: "Timeline", command },
              );
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
            void onCommand(
              command.type === "checkpoint"
                ? {
                    type: "SetCheckpointTiming",
                    id: command.id,
                    timing: { anchor: "free", date: command.date },
                  }
                : { type: "Timeline", command },
              revision,
            );
          },
          gaps: (scene) =>
            (scene ?? snapshot).stages.map((s) => ({
              stageId: s.id,
              boundary: s.endDateExclusive,
              width: RESULT_COLUMN_WIDTH,
            })),
          resultsHeight: (scene, layout) =>
            Math.max(
              0,
              ...resultLayout(
                scene ?? snapshot,
                processPositions(scene ?? snapshot, layout),
              ).map((t) => t.y + t.height + 24),
            ),
          results: (camera, scene, layout) => (
            <ResultColumns
              snapshot={scene ?? snapshot}
              camera={camera}
              processY={processPositions(scene ?? snapshot, layout)}
              onSelect={(id) => {
                setSpecial({ kind: "result", id });
              }}
              onCommand={onCommand}
            />
          ),
          onRename: (target, title) => {
            void onCommand({
              type: "Rename",
              kind: target.kind,
              id: target.id,
              value: title,
            });
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
          checkpoints: (camera, preview, start) => {
            const scene = preview ?? snapshot;
            return scene.checkpoints.map((c) => (
              <button
                data-interactive
                key={c.id}
                className="checkpoint-line"
                data-checkpoint-id={c.id}
                data-date={checkpointDate(scene, c)}
                style={{
                  left: xBefore(addDays(checkpointDate(scene, c), 1), camera),
                }}
                aria-label={`Чекпойнт: ${c.title}`}
                title={
                  c.timing.anchor === "project_end"
                    ? "Привязан к окончанию проекта. Для ручного переноса снимите привязку в свойствах."
                    : "Перетащите для изменения даты. Esc — отмена."
                }
                onPointerDown={(e) => {
                  if (c.timing.anchor === "free") {
                    start(e, c.id, checkpointDate(scene, c));
                    setSpecial({ kind: "checkpoint", id: c.id });
                  }
                }}
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
              key={currentSpecial?.id ?? selection?.id ?? "none"}
              snapshot={preview ?? snapshot}
              target={currentSpecial ?? selection}
              onCommand={onCommand}
              onResultSelect={(id) => {
                setSpecial({ kind: "result", id });
              }}
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
  onResultSelect,
}: {
  snapshot: Snapshot;
  target: Special | Selection | null;
  onCommand: SendCommand;
  onResultSelect: (id: string) => void;
}) {
  const checkpoint =
    target?.kind === "checkpoint"
      ? snapshot.checkpoints.find((c) => c.id === target.id)
      : undefined;
  const result =
    target?.kind === "result"
      ? snapshot.results.find((r) => r.id === target.id)
      : undefined;
  const item =
    target?.kind === "project"
      ? snapshot.project
      : target?.kind === "stage"
        ? snapshot.stages.find((s) => s.id === target.id)
        : target?.kind === "process"
          ? snapshot.processes.find((p) => p.id === target.id)
          : target?.kind === "task"
            ? snapshot.tasks.find((t) => t.id === target.id)
            : undefined;
  if (!target || (!item && !checkpoint && !result))
    return (
      <aside className="details-inspector" aria-label="Свойства элемента">
        Выберите элемент
      </aside>
    );
  const labels = {
    project: "Проект",
    stage: "Этап",
    process: "Процесс",
    task: "Задача",
    checkpoint: "Чекпойнт",
    result: "Результат",
  };
  const title =
    checkpoint?.title ??
    (item && "name" in item
      ? item.name
      : item && "title" in item
        ? item.title
        : "");
  const description =
    checkpoint?.note ??
    (item && "description" in item
      ? item.description
      : item && "details" in item
        ? item.details
        : "") ??
    "";
  return (
    <aside
      className="details-inspector"
      aria-label="Свойства элемента"
      data-selected-id={target.id}
    >
      <div className="inspector-top">
        <p className="inspector-kicker">СВОЙСТВА</p>
        <span className="inspector-type">{labels[target.kind]}</span>
      </div>
      {target.kind !== "result" && (
        <>
          <label className="inspector-label" htmlFor="v2-title">
            Название
          </label>
          <CommitText
            key={`title:${title}`}
            id="v2-title"
            value={title}
            onCommit={(value) => {
              if (target.kind !== "result")
                void onCommand({
                  type: "Rename",
                  kind: target.kind,
                  id: target.id,
                  value,
                });
            }}
          />
          <label className="inspector-label" htmlFor="v2-description">
            {checkpoint ? "Заметка" : "Описание"}
          </label>
          <CommitText
            key={`description:${description}`}
            id="v2-description"
            value={description}
            multiline
            onCommit={(value) => {
              if (target.kind !== "result")
                void onCommand({
                  type: "Describe",
                  kind: target.kind,
                  id: target.id,
                  value,
                });
            }}
          />
        </>
      )}
      {checkpoint && (
        <CheckpointTiming
          key={JSON.stringify(checkpoint.timing)}
          snapshot={snapshot}
          checkpoint={checkpoint}
          onCommand={onCommand}
        />
      )}
      {item && "startDate" in item && (
        <div className="inspector-section">
          <span className="inspector-label">Даты</span>
          <p>
            {item.startDate} — {addDays(item.endDateExclusive, -1)}
          </p>
        </div>
      )}
      {target.kind === "process" && item && "stageId" in item && (
        <>
          <p>
            Этап: {snapshot.stages.find((s) => s.id === item.stageId)?.title}
          </p>
          <ResultFields
            snapshot={snapshot}
            result={snapshot.results.find((r) => r.processId === item.id)}
            processId={item.id}
            stageId={item.stageId}
            onCommand={onCommand}
          />
        </>
      )}
      {result && (
        <ResultFields
          snapshot={snapshot}
          result={result}
          processId={result.processId}
          stageId={result.stageId}
          onCommand={onCommand}
        />
      )}
      {target.kind === "stage" && (
        <>
          <StageActions
            snapshot={snapshot}
            id={target.id}
            onCommand={onCommand}
          />
          <section className="result-fields">
            <h3>Результаты этапа</h3>
            <button
              className="quiet-button"
              onClick={() => {
                const id = crypto.randomUUID();
                void onCommand({
                  type: "CreateStandaloneResult",
                  id,
                  stageId: target.id,
                  title: "Новый результат",
                }).then((ok) => {
                  if (ok) onResultSelect(id);
                });
              }}
            >
              Добавить самостоятельный результат
            </button>
            {snapshot.results
              .filter((r) => r.stageId === target.id)
              .map((r) => (
                <button
                  className="quiet-button"
                  key={r.id}
                  onClick={() => {
                    onResultSelect(r.id);
                  }}
                >
                  {r.title || "Без названия"}
                  {snapshot.resultPlacements.find((p) => p.resultId === r.id)
                    ?.hiddenByUser
                    ? " · скрыт"
                    : ""}
                </button>
              ))}
          </section>
        </>
      )}
      {target.kind === "project" && (
        <section className="stage-actions">
          <h3>Границы проекта</h3>
          <DateCommandField
            key={`start:${snapshot.project.startDate}`}
            label="Начало проекта"
            value={snapshot.project.startDate}
            apply={(date) =>
              onCommand({ type: "ResizeProject", edge: "start", date })
            }
          />
          <DateCommandField
            key={`end:${snapshot.project.endDateExclusive}`}
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
        Работы толкают соседей в своей строке. Один жест — одна отмена.
      </p>
      <p className="memory-notice">
        Сохранено локально в этом браузере. История Undo/Redo сохраняется после
        перезагрузки и отдельно для каждого проекта.
      </p>
    </aside>
  );
}
function CheckpointTiming({
  snapshot,
  checkpoint,
  onCommand,
}: {
  snapshot: Snapshot;
  checkpoint: Snapshot["checkpoints"][number];
  onCommand: SendCommand;
}) {
  const [date, setDate] = useState<string>(
      checkpointDate(snapshot, checkpoint),
    ),
    [anchor, setAnchor] = useState(checkpoint.timing.anchor === "project_end");
  const original = JSON.stringify(checkpoint.timing),
    submitted = useRef(original);
  const timing = anchor
    ? { anchor: "project_end" as const }
    : { anchor: "free" as const, date: dateOnlySchema.safeParse(date).data };
  const next = JSON.stringify(timing);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (
          next === original ||
          next === submitted.current ||
          (!anchor && !timing.date)
        )
          return;
        submitted.current = next;
        void onCommand({
          type: "SetCheckpointTiming",
          id: checkpoint.id,
          timing: anchor
            ? { anchor: "project_end" }
            : { anchor: "free", date: dateOnlySchema.parse(date) },
        }).then((ok) => {
          if (!ok) submitted.current = original;
        });
      }}
    >
      <label className="inspector-label" htmlFor="checkpoint-date">
        Дата чекпойнта
      </label>
      <input
        id="checkpoint-date"
        type="date"
        min="0001-01-01"
        max="9999-12-31"
        disabled={anchor}
        value={anchor ? addDays(snapshot.project.endDateExclusive, -1) : date}
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
        При привязке ручной перенос недоступен. Снимите флажок, чтобы перемещать
        чекпойнт мышью.
      </p>
      <button
        className="primary-button"
        disabled={
          next === original ||
          (!anchor && !dateOnlySchema.safeParse(date).success)
        }
      >
        Сохранить чекпойнт
      </button>
    </form>
  );
}
