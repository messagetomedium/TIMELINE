import { useState } from "react";
import { addDays, dateOnlySchema, laneIdSchema } from "../../domain";
import type { Snapshot } from "../../domain/v2/model";
import { duplicateWorkCommand } from "../../application/v2/workCommands";
import { laneParent } from "../../domain/v2/work";
import type { WorkKind } from "../../domain/v2/work";
import type { SendCommand } from "./StageControls";
export function WorkActions({
  snapshot,
  kind,
  id,
  onCommand,
  onCreate,
}: {
  snapshot: Snapshot;
  kind: WorkKind;
  id: string;
  onCommand: SendCommand;
  onCreate: (kind: WorkKind, parentId: string) => void;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <section className="stage-actions">
      <h3>{kind === "process" ? "Процесс" : "Задача"}</h3>
      {kind === "process" && (
        <button
          className="quiet-button"
          onClick={() => {
            onCreate("task", id);
          }}
        >
          Добавить задачу в процесс
        </button>
      )}
      <button
        className="quiet-button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onCommand(
            duplicateWorkCommand(snapshot, kind, id, () => crypto.randomUUID()),
          ).finally(() => {
            setBusy(false);
          });
        }}
      >
        Дублировать {kind === "process" ? "процесс" : "задачу"}
      </button>
      <button
        className="danger-button"
        onClick={() => {
          setConfirm(true);
        }}
      >
        Удалить {kind === "process" ? "процесс" : "задачу"}
      </button>
      {confirm && (
        <div className="modal-backdrop" data-interactive>
          <section
            className="workspace-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Удаление работы"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) {
                e.stopPropagation();
                setConfirm(false);
              }
            }}
          >
            <h2>
              Удалить {kind === "process" ? "процесс с содержимым" : "задачу"}?
            </h2>
            <p>
              {kind === "process"
                ? "Задачи и связанный результат будут удалены вместе с процессом."
                : "Пустая строка будет удалена. Даты остальных работ сохранятся."}{" "}
              Доступна одна отмена всей операции.
            </p>
            <div className="dialog-footer">
              <button
                className="quiet-button"
                disabled={busy}
                onClick={() => {
                  setConfirm(false);
                }}
              >
                Отмена
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void onCommand({ type: "DeleteWork", kind, id })
                    .then((ok) => {
                      if (ok) setConfirm(false);
                    })
                    .finally(() => {
                      setBusy(false);
                    });
                }}
              >
                Удалить
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
export function CreateWorkForm({
  snapshot,
  kind,
  parentId,
  onCommand,
  onClose,
}: {
  snapshot: Snapshot;
  kind: WorkKind;
  parentId: string;
  onCommand: SendCommand;
  onClose: () => void;
}) {
  const parents = kind === "process" ? snapshot.stages : snapshot.processes;
  const initial = parents.find((p) => p.id === parentId) ?? parents[0];
  const [owner, setOwner] = useState(initial?.id ?? ""),
    [title, setTitle] = useState(""),
    [start, setStart] = useState<string>(
      initial?.startDate ?? snapshot.project.startDate,
    ),
    [end, setEnd] = useState<string>(
      addDays(
        initial?.endDateExclusive ?? snapshot.project.endDateExclusive,
        -1,
      ),
    ),
    [row, setRow] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [ids] = useState(() => ({
    id: crypto.randomUUID(),
    newLaneId: laneIdSchema.parse(crypto.randomUUID()),
  }));
  return (
    <div className="modal-backdrop" data-interactive>
      <form
        className="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={kind === "process" ? "Новый процесс" : "Новая задача"}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            onClose();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          try {
            const a = dateOnlySchema.parse(start),
              b = addDays(dateOnlySchema.parse(end), 1);
            if (a >= b) throw Error("Окончание не может быть раньше начала");
            setBusy(true);
            setError("");
            void onCommand({
              type: "CreateWork",
              kind,
              ...ids,
              parentId: owner,
              title,
              startDate: a,
              endDateExclusive: b,
              laneId: row ? laneIdSchema.parse(row) : null,
            })
              .then((ok) => {
                if (ok) onClose();
              })
              .finally(() => {
                setBusy(false);
              });
          } catch (e) {
            setError(e instanceof Error ? e.message : "Проверьте даты");
          }
        }}
      >
        <h2>{kind === "process" ? "Новый процесс" : "Новая задача"}</h2>
        <label>
          {kind === "process" ? "Этап работы" : "Родительский процесс"}
          <select
            aria-label={
              kind === "process" ? "Этап работы" : "Родительский процесс"
            }
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setRow("");
              const p = parents.find((p) => p.id === e.target.value);
              if (p) {
                setStart(p.startDate);
                setEnd(addDays(p.endDateExclusive, -1));
              }
            }}
          >
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Название работы
          <input
            autoFocus
            required
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </label>
        <div className="date-fields">
          <label>
            Начало работы
            <input
              type="date"
              required
              min="0001-01-01"
              max="9999-12-30"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
              }}
            />
          </label>
          <label>
            Окончание работы
            <input
              type="date"
              required
              min="0001-01-01"
              max="9999-12-30"
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
              }}
            />
          </label>
        </div>
        <label>
          Дорожка
          <select
            aria-label="Дорожка"
            value={row}
            onChange={(e) => {
              setRow(e.target.value);
            }}
          >
            <option value="">Новая дорожка</option>
            {snapshot.lanes
              .filter((l) => l.kind === kind && laneParent(l) === owner)
              .sort((a, b) => a.sortIndex - b.sortIndex)
              .map((l, i) => (
                <option key={l.id} value={l.id}>
                  Дорожка {String(i + 1)}
                </option>
              ))}
          </select>
        </label>
        <p className="dialog-note">
          Последовательные работы могут делить дорожку. Параллельным работам
          нужна новая. Копирование доступно в свойствах работы и не сдвигает
          соседей.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-footer">
          <button
            type="button"
            className="quiet-button"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            className="primary-button"
            disabled={busy || !owner || !title.trim()}
          >
            Добавить
          </button>
        </div>
      </form>
    </div>
  );
}
