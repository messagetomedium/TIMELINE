import { useState } from "react";
import {
  addDays,
  dateOnlySchema,
  laneIdSchema,
  processIdSchema,
} from "../../domain";
import type { Snapshot } from "../../domain/v2/model";
import type { ContentCommand } from "../../domain/v2/commands";
export type SendCommand = (
  command: ContentCommand,
  revision?: number,
) => Promise<boolean>;
export interface StageBoundary {
  leftStageId: string | null;
  rightStageId: string | null;
}
export function InsertStageDialog({
  boundary,
  onCommand,
  onClose,
}: {
  boundary: StageBoundary;
  onCommand: SendCommand;
  onClose: () => void;
}) {
  const [id] = useState(() => crypto.randomUUID()),
    [title, setTitle] = useState("Новый этап"),
    [days, setDays] = useState("7"),
    [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" data-interactive>
      <form
        className="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Вставка этапа"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            onClose();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void onCommand({
            type: "InsertStage",
            id,
            ...boundary,
            title,
            durationDays: Number(days),
          })
            .then((ok) => {
              if (ok) onClose();
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <h2>Вставить этап</h2>
        <label>
          Название этапа
          <input
            autoFocus
            required
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </label>
        <label>
          Длительность, дней
          <input
            type="number"
            min="1"
            step="1"
            required
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
            }}
          />
        </label>
        <p className="dialog-note">
          Следующие этапы и их работы сдвинутся на указанное число дней.
          Свободные чекпойнты останутся на своих датах.
        </p>
        <div className="dialog-footer">
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button className="primary-button" disabled={busy || !title.trim()}>
            Вставить этап
          </button>
        </div>
      </form>
    </div>
  );
}
export function DateCommandField({
  label,
  value,
  apply,
}: {
  label: string;
  value: string;
  apply: (value: ReturnType<typeof dateOnlySchema.parse>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value),
    [error, setError] = useState("");
  return (
    <form
      className="date-command-field"
      onSubmit={(e) => {
        e.preventDefault();
        const date = dateOnlySchema.safeParse(draft);
        if (date.success) {
          setError("");
          void Promise.resolve()
            .then(() => apply(date.data))
            .catch(() => {
              setError("Дата выходит за поддерживаемый календарный диапазон.");
            });
        }
      }}
    >
      <label>
        {label}
        <input
          type="date"
          required
          min="0001-01-01"
          max="9999-12-31"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
        />
      </label>
      <button
        type="submit"
        className="quiet-button"
        disabled={!dateOnlySchema.safeParse(draft).success || draft === value}
      >
        Применить
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export function StageActions({
  snapshot,
  id,
  onCommand,
}: {
  snapshot: Snapshot;
  id: string;
  onCommand: SendCommand;
}) {
  const [confirm, setConfirm] = useState<
      "delete" | "clear" | "previous" | "next" | null
    >(null),
    [busy, setBusy] = useState(false);
  const stages = [...snapshot.stages].sort((a, b) => a.sortIndex - b.sortIndex),
    index = stages.findIndex((s) => s.id === id),
    stage = stages[index];
  if (!stage) return null;
  const previous = stages[index - 1],
    next = stages[index + 1],
    processes = snapshot.processes.filter((p) => p.stageId === id),
    ids = new Set(processes.map((p) => p.id)),
    tasks = snapshot.tasks.filter((t) => ids.has(t.processId));
  const merge = confirm === "previous" || confirm === "next";
  return (
    <section className="stage-actions">
      <h3>Этап</h3>
      <DateCommandField
        key={`start:${stage.startDate}`}
        label="Начало этапа"
        value={stage.startDate}
        apply={(date) => onCommand({ type: "MoveStageBoundary", id, date })}
      />
      <DateCommandField
        key={`end:${stage.endDateExclusive}`}
        label="Окончание этапа включительно"
        value={addDays(stage.endDateExclusive, -1)}
        apply={(date) =>
          onCommand(
            next
              ? {
                  type: "MoveStageBoundary",
                  id: next.id,
                  date: addDays(date, 1),
                }
              : { type: "ResizeProject", edge: "end", date: addDays(date, 1) },
          )
        }
      />
      <p className="inspector-note">
        Перенос начальной границы двигает содержимое этапа. Внутренняя конечная
        граница — начало следующего этапа.
      </p>
      <button
        className="quiet-button"
        disabled={!previous}
        onClick={() => {
          setConfirm("previous");
        }}
      >
        Объединить с предыдущим
      </button>
      <button
        className="quiet-button"
        disabled={!next}
        onClick={() => {
          setConfirm("next");
        }}
      >
        Объединить со следующим
      </button>
      <button
        className="quiet-button"
        onClick={() => {
          setConfirm("clear");
        }}
      >
        Очистить этап
      </button>
      <button
        className="danger-button"
        disabled={stages.length === 1}
        onClick={() => {
          setConfirm("delete");
        }}
      >
        Удалить этап
      </button>
      {stages.length === 1 && (
        <p className="inspector-note">
          Единственный этап можно очистить, но нельзя удалить.
        </p>
      )}
      {confirm && (
        <div className="modal-backdrop" data-interactive>
          <section
            className="workspace-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Подтверждение операции с этапом"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) {
                e.stopPropagation();
                setConfirm(null);
              }
            }}
          >
            <h2>
              {merge
                ? "Объединить этапы?"
                : confirm === "delete"
                  ? "Удалить этап?"
                  : "Очистить этап?"}
            </h2>
            <p>
              {merge
                ? "Сохранится имя более раннего этапа и оба описания. Даты работ не изменятся."
                : `«${stage.title}»: ${String(processes.length)} процессов, ${String(tasks.length)} задач. Содержимое будет удалено одной обратимой операцией.`}
            </p>
            <p className="dialog-note">
              {confirm === "delete"
                ? "Следующие этапы и работы сдвинутся в освободившееся время."
                : confirm === "clear"
                  ? "Границы сохранятся, останется один короткий процесс без задач."
                  : "Связи и строки будут объединены без сдвига дат."}{" "}
              Свободные чекпойнты не меняются. Доступна отмена.
            </p>
            <div className="dialog-footer">
              <button
                className="quiet-button"
                disabled={busy}
                onClick={() => {
                  setConfirm(null);
                }}
              >
                Отмена
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => {
                  let command: ContentCommand;
                  if (confirm === "delete")
                    command = { type: "DeleteStage", id };
                  else if (confirm === "clear")
                    command = {
                      type: "ClearStage",
                      id,
                      processId: processIdSchema.parse(crypto.randomUUID()),
                      laneId: laneIdSchema.parse(crypto.randomUUID()),
                    };
                  else {
                    const left = confirm === "previous" ? previous : stage,
                      right = confirm === "previous" ? stage : next;
                    if (!left || !right) return;
                    command = {
                      type: "MergeStages",
                      leftStageId: left.id,
                      rightStageId: right.id,
                    };
                  }
                  setBusy(true);
                  void onCommand(command)
                    .then((ok) => {
                      if (ok) setConfirm(null);
                    })
                    .finally(() => {
                      setBusy(false);
                    });
                }}
              >
                Подтвердить
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
