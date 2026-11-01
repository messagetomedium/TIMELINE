import { occupancy } from "../../domain/v2/occupancy";
import { checkpointScene } from "../../domain/v2/checkpointLayout";
import { AssignmentControl } from "./PeopleUI";
import type { SendPeople } from "./PeopleUI";
import { PeopleTimeline } from "./PeopleTimeline";
import type { CatalogState } from "../../domain/v2/peopleModel";
import { statusSchema } from "../../domain/schema";
import { CheckpointHeaders, CheckpointLines } from "./CheckpointLayer";
import { CalendarShading } from "./CalendarShading";
import { DateRangeEditor } from "./DateRangeEditor";
import { WorkActions, CreateWorkForm } from "./WorkActions";
import type { WorkKind } from "../../domain/v2/work";
import { useEffect, useRef, useState } from "react";
import { addDays } from "../../domain";
import { displayDocument, checkpointDate } from "../../domain/v2/model";
import type { Snapshot } from "../../domain/v2/model";
import { RESULT_COLUMN_WIDTH } from "../../domain/SegmentAxis";
import { resultLayout } from "../../domain/v2/results";
import { ResultFields, ResultColumns } from "./ResultUI";
import { CommitText } from "./CommitText";
import { planCommand } from "../../domain/v2/commands";
import type { Selection } from "../../application/timelineCommands";
import type { ViewPreferences, ProjectId, StageMarkerId } from "../../domain";
import { stageMarkerIdSchema } from "../../domain";
import { DateCommandField, InsertStageDialog, StageActions } from "./StageControls";
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
  catalog,
  onPeople,
  onCommand,
  onUndo,
  onRedo,
  history,
  view,
  onView,
  inspectorCollapsed,
  onToggleInspector,
}: {
  inspectorCollapsed: boolean;
  onToggleInspector: () => void;
  snapshot: Snapshot;
  catalog: CatalogState;
  onPeople: SendPeople;
  onCommand: SendCommand;
  onUndo: () => void;
  onRedo: () => void;
  history: { canUndo: boolean; canRedo: boolean };
  view: ViewPreferences | undefined;
  onView: (id: ProjectId, v: ViewPreferences) => void;
}) {
  const [creating, setCreating] = useState<{
    kind: WorkKind;
    parentId: string;
  } | null>(null);
  const create = (kind: WorkKind, parent: string | null) => {
    const process = snapshot.processes.find((p) => p.id === parent);
    const parentId =
      kind === "task"
        ? process?.id
        : special?.kind === "stage"
          ? special.id
          : (process?.stageId ?? snapshot.stages[0]?.id);
    if (parentId) setCreating({ kind, parentId });
  };
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
          snapshot,
          hoverIds: (hovered) =>
            occupancy(snapshot, catalog)
              .find((row) => row.id === hovered)
              ?.items.map((w) => w.id) ?? [],
          people: (props, scene) => (
            <PeopleTimeline
              {...props}
              snapshot={scene ?? snapshot}
              catalog={catalog}
            />
          ),
          range: () => ({
            startDate: snapshot.checkpoints.reduce(
              (v, c) =>
                checkpointDate(snapshot, c) < v
                  ? checkpointDate(snapshot, c)
                  : v,
              snapshot.project.startDate,
            ),
            endDateExclusive: snapshot.checkpoints.reduce(
              (v, c) =>
                addDays(checkpointDate(snapshot, c), 1) > v
                  ? addDays(checkpointDate(snapshot, c), 1)
                  : v,
              snapshot.project.endDateExclusive,
            ),
          }),
          area: (scene) => ({
            project: (scene ?? snapshot).project,
            checkpoints: (scene ?? snapshot).checkpoints.map((c) =>
              checkpointDate(scene ?? snapshot, c),
            ),
          }),
          stageHeight: (camera, width, scene) =>
            68 + checkpointScene(scene ?? snapshot, camera, width).height,
          onCreate: create,
          inspectorCollapsed,
          onToggleInspector,
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
                command.type === "GroupMove"
                  ? command
                  : command.type === "checkpoint"
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
              command.type === "GroupMove"
                ? command
                : command.type === "checkpoint"
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
          stages: (camera, width, preview, start, checkpointStart) => {
            const scene = preview ?? snapshot,
              stages = [...scene.stages].sort(
                (a, b) => a.sortIndex - b.sortIndex,
              );
            return (
              <div
                style={
                  {
                    height: "100%",
                    "--checkpoint-header-height": `${String(checkpointScene(scene, camera, width).height)}px`,
                  } as import("react").CSSProperties
                }
                className="stage-band foundation-stage-band"
                aria-label="Этапы производства"
              >
                <CalendarShading
                  area={{
                    project: scene.project,
                    checkpoints: scene.checkpoints.map((c) =>
                      checkpointDate(scene, c),
                    ),
                  }}
                  camera={camera}
                  height="100%"
                />
                <CheckpointHeaders
                  snapshot={scene}
                  camera={camera}
                  width={width}
                  onSelect={(id) => {
                    setSpecial({ kind: "checkpoint", id });
                  }}
                  onStart={checkpointStart}
                />
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
          checkpoints: (camera, preview) => (
            <CheckpointLines
              snapshot={preview ?? snapshot}
              camera={camera}
              onSelect={(id) => {
                setSpecial({ kind: "checkpoint", id });
              }}
            />
          ),
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
              <button
                className="navigation-button"
                onClick={() => {
                  const id = crypto.randomUUID();
                  void onCommand({
                    type: "CreateCheckpoint",
                    id,
                    title: "Чекпойнт",
                  }).then((ok) => {
                    if (ok) setSpecial({ kind: "checkpoint", id });
                  });
                }}
              >
                + Чекпойнт
              </button>
              <span className="toolbar-separator" />
            </>
          ),
          inspector: (selection, preview, count) => (
            <FoundationInspector
              key={currentSpecial?.id ?? selection?.id ?? "none"}
              snapshot={preview ?? snapshot}
              catalog={catalog}
              onPeople={onPeople}
              target={currentSpecial ?? selection}
              onCommand={onCommand}
              count={count}
              onCreate={(kind, parent) => {
                create(kind, parent);
              }}
              onResultSelect={(id) => {
                setSpecial({ kind: "result", id });
              }}
            />
          ),
        }}
      />
      {creating && (
        <CreateWorkForm
          snapshot={snapshot}
          kind={creating.kind}
          parentId={creating.parentId}
          onCommand={onCommand}
          onClose={() => {
            setCreating(null);
          }}
        />
      )}
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
  catalog,
  onPeople,
  target,
  onCommand,
  onResultSelect,
  onCreate,
  count,
}: {
  snapshot: Snapshot;
  catalog: CatalogState;
  onPeople: SendPeople;
  target: Special | Selection | null;
  onCommand: SendCommand;
  onResultSelect: (id: string) => void;
  onCreate: (kind: WorkKind, parentId: string) => void;
  count: number;
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
      {count > 1 && (
        <p className="inspector-note">
          Выбрано работ: {count}. Групповая операция — перенос за ручку. Для
          удаления или копирования выберите одну работу.
        </p>
      )}
      {(target.kind === "process" || target.kind === "task") && count <= 1 && (
        <WorkActions
          snapshot={snapshot}
          kind={target.kind}
          id={target.id}
          onCommand={onCommand}
          onCreate={onCreate}
        />
      )}
      {(target.kind === "process" || target.kind === "task") &&
        item &&
        "status" in item && (
          <>
            <label className="inspector-label">
              Статус
              <select
                aria-label="Статус"
                value={item.status}
                onChange={(e) => {
                  void onCommand({
                    type: "SetWorkStatus",
                    kind: target.kind,
                    id: target.id,
                    status: statusSchema.parse(e.target.value),
                  });
                }}
              >
                {statusSchema.options.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <DateRangeEditor
              key={`work-range:${target.id}`}
              start={item.startDate}
              endExclusive={item.endDateExclusive}
              heading="Сроки работы"
              startLabel="Начало работы"
              endLabel="Конец работы"
              apply={(startDate, endDateExclusive) =>
                onCommand({
                  type: "ResizeWorkRange",
                  kind: target.kind,
                  id: target.id,
                  startDate,
                  endDateExclusive,
                })
              }
              validate={(startDate, endDateExclusive) => {
                try {
                  planCommand(snapshot, {
                    type: "ResizeWorkRange",
                    kind: target.kind,
                    id: target.id,
                    startDate,
                    endDateExclusive,
                  });
                  return null;
                } catch (e) {
                  return e instanceof Error ? e.message : "Проверьте сроки";
                }
              }}
            />
            {target.kind === "process" && "color" in item && (
              <ProcessColor
                key={item.color}
                value={item.color}
                onCommit={(color) =>
                  onCommand({ type: "SetProcessColor", id: target.id, color })
                }
              />
            )}
            <AssignmentControl
              key={`${target.id}:${snapshot.assignments.find((a) => a.targetId === target.id)?.id ?? "none"}`}
              snapshot={snapshot}
              catalog={catalog}
              target={{ kind: target.kind, targetId: target.id }}
              onCommand={onCommand}
              onPeople={onPeople}
            />
          </>
        )}
      {checkpoint && (
        <div className="stage-actions">
          <button
            className="quiet-button"
            onClick={() => {
              void onCommand({
                type: "DuplicateCheckpoint",
                id: checkpoint.id,
                newId: crypto.randomUUID(),
              });
            }}
          >
            Дублировать чекпойнт
          </button>
          <button
            className="danger-button"
            onClick={() => {
              void onCommand({ type: "DeleteCheckpoint", id: checkpoint.id });
            }}
          >
            Удалить чекпойнт
          </button>
        </div>
      )}
      {checkpoint && (
        <CheckpointTiming
          key={JSON.stringify(checkpoint.timing)}
          snapshot={snapshot}
          checkpoint={checkpoint}
          onCommand={onCommand}
        />
      )}
      {target.kind === "stage" && item && "startDate" in item && (
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
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={snapshot.project.isScheduled}
            onKeyDown={checkboxEnter}
            onChange={(e) => {
              void onCommand({
                type: "SetProjectScheduled",
                value: e.target.checked,
              });
            }}
          />
          Показывать даты в портфеле
        </label>
      )}
      {target.kind === "project" && (
        <DateRangeEditor
          key={`project-range:${target.id}`}
          start={snapshot.project.startDate}
          endExclusive={snapshot.project.endDateExclusive}
          apply={(startDate, endDateExclusive) =>
            onCommand({
              type: "ResizeProjectRange",
              startDate,
              endDateExclusive,
            })
          }
          validate={(startDate, endDateExclusive) => {
            try {
              planCommand(snapshot, {
                type: "ResizeProjectRange",
                startDate,
                endDateExclusive,
              });
              return null;
            } catch (e) {
              return e instanceof Error ? e.message : "Проверьте границы";
            }
          }}
        />
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
  const anchor = checkpoint.timing.anchor === "project_end";
  const [busy, setBusy] = useState(false), [error, setError] = useState(""),
    [checked, setChecked] = useState(anchor);
  const sending = useRef(false);
  return (
    <section>
      <DateCommandField
        key={checkpointDate(snapshot, checkpoint)}
        label="Дата чекпойнта"
        value={checkpointDate(snapshot, checkpoint)}
        disabled={anchor || busy}
        apply={(date) => onCommand({
          type: "SetCheckpointTiming", id: checkpoint.id,
          timing: { anchor: "free", date },
        })}
      />
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onKeyDown={checkboxEnter}
          onChange={(e) => {
            if (sending.current) return;
            const timing = e.target.checked
              ? { anchor: "project_end" as const }
              : { anchor: "free" as const, date: checkpointDate(snapshot, checkpoint) };
            sending.current = true;
            setChecked(e.target.checked);
            setBusy(true);
            setError("");
            void onCommand({ type: "SetCheckpointTiming", id: checkpoint.id, timing })
              .then((ok) => {
                if (!ok) { setChecked(anchor); setError("Привязка не сохранена. Повторите изменение."); }
              })
              .catch(() => { setChecked(anchor); setError("Привязка не сохранена. Повторите изменение."); })
              .finally(() => { sending.current = false; setBusy(false); });
          }}
        />
        Привязать к дате окончания проекта
      </label>
      {error && <p role="alert" className="field-error">{error}</p>}
      <p className="inspector-note">
        При привязке ручной перенос недоступен. Снимите флажок, чтобы перемещать
        чекпойнт мышью.
      </p>
    </section>
  );
}
function checkboxEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) e.currentTarget.click();
  }
}

function ProcessColor({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (color: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value),
    sent = useRef(value),
    cancelled = useRef(false);
  const node = useRef<HTMLInputElement>(null);
  const commit = (next = draft) => {
    if (!cancelled.current && next !== sent.current) {
      sent.current = next;
      void onCommit(next).then((ok) => {
        if (!ok) {
          sent.current = value;
          setDraft(value);
        }
      });
    }
  };
  useEffect(() => {
    const input = node.current;
    const change = () => { if (input) commit(input.value); };
    input?.addEventListener("change", change);
    return () => input?.removeEventListener("change", change);
  });
  return (
    <label className="inspector-label color-field">
      Цвет процесса
      <input
        ref={node}
        aria-label="Цвет процесса"
        type="color"
        value={draft}
        onChange={(e) => {
          cancelled.current = false;
          setDraft(e.target.value);
        }}
        onBlur={() => { commit(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            commit();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancelled.current = true;
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
      />
      <small>Enter или клик вне поля — применить; Esc — отменить</small>
    </label>
  );
}
