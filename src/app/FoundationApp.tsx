import { useCallback, useEffect, useRef, useState } from "react";
import { dateOnly, projectIdSchema } from "../domain";
import type { ProjectId, ViewPreferences } from "../domain";
import type { Snapshot } from "../domain/v2/model";
import { displayDocument } from "../domain/v2/model";
import { CommandService } from "../application/v2/CommandService";
import { FoundationTimeline } from "../features/timeline/FoundationTimeline";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import {
  exportLegacy,
  hasLegacyData,
} from "../infrastructure/local/legacyExport";
import { defaultPreferences } from "../application/workspace/model";
import type { WorkspacePreferences } from "../application/workspace/model";

function download(content: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
function selectedId() {
  const raw = /^#\/projects\/([^/]+)$/.exec(location.hash)?.[1];
  return raw ? projectIdSchema.safeParse(raw).data : null;
}
export function FoundationApp({ service }: { service: CommandService }) {
  const [documents, setDocuments] = useState<Snapshot[] | null>(null),
    [preferences, setPreferences] = useState(defaultPreferences),
    [views, setViews] = useState<Record<string, ViewPreferences>>({});
  const [id, setId] = useState(selectedId),
    [error, setError] = useState(""),
    [legacy, setLegacy] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(0);
  const [dialog, setDialog] = useState<"new" | Snapshot | null>(null);
  const writing = useRef(false),
    queue = useRef(Promise.resolve());
  const refresh = useCallback(async () => {
    const s = await service.snapshot();
    setDocuments(s.documents);
    setPreferences(s.preferences);
    setViews(s.views);
  }, [service]);
  const report = (e: unknown) => {
    setError(
      e instanceof Error ? e.message : "Ошибка сохранения. Данные не сброшены.",
    );
  };
  useEffect(() => {
    void Promise.resolve().then(refresh).catch(report);
    void hasLegacyData().then(setLegacy).catch(report);
    const listener = () => {
      setId(selectedId());
    };
    window.addEventListener("hashchange", listener);
    return () => {
      window.removeEventListener("hashchange", listener);
    };
  }, [refresh]);
  const run = useCallback(
    async (operation: () => Promise<unknown>) => {
      if (writing.current) return false;
      writing.current = true;
      setBusy(true);
      setError("");
      try {
        await queue.current;
        await operation();
        await refresh();
        return true;
      } catch (e) {
        report(e);
        await refresh().catch(report);
        return false;
      } finally {
        writing.current = false;
        setBusy(false);
      }
    },
    [refresh],
  );
  const active = documents?.find((d) => d.project.id === id);
  const undo = useCallback(
    (redo = false) => {
      if (active) void run(() => service.undo(active.project.id, redo));
    },
    [active, run, service],
  );
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.key.toLowerCase() !== "z" ||
        e.altKey ||
        (e.target instanceof Element &&
          e.target.closest(
            'input,textarea,[contenteditable="true"],[role="textbox"]',
          ))
      )
        return;
      if (active) {
        e.preventDefault();
        undo(e.shiftKey);
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [active, undo]);
  useEffect(() => {
    document.title = active
      ? `${active.project.name} — Таймлайн`
      : "Проекты — Таймлайн";
  }, [active]);
  const saveView = useCallback(
    (projectId: ProjectId, v: ViewPreferences) => {
      setViews((old) => ({ ...old, [projectId]: v }));
      setPending((n) => n + 1);
      queue.current = queue.current
        .then(() => service.saveView(projectId, v))
        .catch(report)
        .finally(() => {
          setPending((n) => n - 1);
        });
    },
    [service],
  );
  const savePreferences = (p: WorkspacePreferences) => {
    setPreferences(p);
    setPending((n) => n + 1);
    queue.current = queue.current
      .then(() => service.savePreferences(p))
      .catch(report)
      .finally(() => {
        setPending((n) => n - 1);
      });
  };
  const source = (projectId: string) => {
    const d = documents?.find((x) => x.project.id === projectId);
    if (!d) throw Error("Проект не найден");
    return d;
  };
  const previewImport = (text: string) =>
    service.previewImport(text).catch(() => {
      setError(
        "Нужен JSON-бэкап V2 с корректными датами и связями. V1 можно экспортировать отдельно; автоматического переноса нет.",
      );
      return null;
    });
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#/projects">
          <span className="brand-mark">т</span>Таймлайн
        </a>
        <nav>
          <button
            className="nav-link"
            onClick={() => {
              location.hash = "/projects";
            }}
          >
            Проекты
          </button>
        </nav>
        {active && (
          <div className="header-project">
            <span>/</span>
            <strong>{active.project.name}</strong>
          </div>
        )}
        <span
          className="workspace-label"
          role="status"
          aria-label="Состояние хранения"
        >
          {busy || pending
            ? "Сохраняется…"
            : documents
              ? "Локально в этом браузере"
              : "Открываем хранилище…"}
        </span>
      </header>
      {legacy && (
        <div className="legacy-notice" role="note">
          Найдены данные V1.2. Они сохранены без изменений. Новый редактор
          использует отдельное хранилище; автоматического переноса нет.
          <button
            onClick={() => {
              void exportLegacy()
                .then((text) => {
                  download(text, "timeline-legacy-v1.json");
                })
                .catch(report);
            }}
          >
            Экспортировать прежние данные JSON
          </button>
        </div>
      )}
      {error && (
        <div className="workspace-error" role="alert">
          {error}
          <button
            aria-label="Закрыть сообщение"
            onClick={() => {
              setError("");
            }}
          >
            ×
          </button>
        </div>
      )}
      {!documents ? (
        <main className="workspace-loading">
          <h1>{error ? "Хранилище недоступно" : "Открываем проекты…"}</h1>
          {error && (
            <button
              onClick={() => {
                void refresh().catch(report);
              }}
            >
              Повторить
            </button>
          )}
        </main>
      ) : (
        <div className="app-content" inert={busy}>
          {id ? (
            active ? (
              <FoundationTimeline
                key={id}
                snapshot={active}
                view={views[id] ?? active.viewPreferences}
                onView={saveView}
                history={service.history(id)}
                onUndo={() => {
                  undo();
                }}
                onRedo={() => {
                  undo(true);
                }}
                onCommand={(c) =>
                  run(() => service.execute(service.envelope(active, c)))
                }
              />
            ) : (
              <main className="workspace-loading">
                <h1>Проект не найден</h1>
                <a href="#/projects">К проектам</a>
              </main>
            )
          ) : (
            <ProjectsPage
              documents={documents.map(displayDocument)}
              preferences={preferences}
              onPreferences={savePreferences}
              onOpen={(projectId) => {
                location.hash = `/projects/${projectId}`;
              }}
              onNew={() => {
                setDialog("new");
              }}
              onRename={(d) => {
                setDialog(source(d.project.id));
              }}
              onDuplicate={(d) => {
                void run(() => service.duplicate(d.project.id));
              }}
              onShift={(projectId, days, revision) => {
                void run(() =>
                  service.execute({
                    ...service.envelope(source(projectId), {
                      type: "ShiftProject",
                      days,
                    }),
                    expectedRevision: revision,
                  }),
                );
              }}
              onExport={() => service.exportBackup()}
              onPreviewImport={previewImport}
              onImport={(backup, copies) =>
                run(() => service.importBackup(backup, copies))
              }
            />
          )}
        </div>
      )}
      {dialog && (
        <CreateDialog
          key={typeof dialog === "string" ? dialog : dialog.project.id}
          source={dialog === "new" ? null : dialog}
          busy={busy}
          onClose={() => {
            setDialog(null);
          }}
          onSave={async (name, description, start) => {
            if (dialog === "new") {
              let created: ProjectId | undefined;
              const ok = await run(async () => {
                created = await service.create({
                  type: "CreateProject",
                  name,
                  description,
                  startDate: start,
                });
              });
              if (ok && created) location.hash = `/projects/${created}`;
              return ok;
            }
            return run(async () => {
              if (name !== dialog.project.name)
                await service.execute(
                  service.envelope(dialog, {
                    type: "Rename",
                    kind: "project",
                    id: dialog.project.id,
                    value: name,
                  }),
                );
              const current = await service.repository.load(dialog.project.id);
              if (current && description !== current.project.description)
                await service.execute(
                  service.envelope(current, {
                    type: "Describe",
                    kind: "project",
                    id: current.project.id,
                    value: description,
                  }),
                );
            });
          }}
        />
      )}
    </div>
  );
}
function CreateDialog({
  source,
  busy,
  onSave,
  onClose,
}: {
  source: Snapshot | null;
  busy: boolean;
  onSave: (
    name: string,
    description: string,
    start: ReturnType<typeof dateOnly>,
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const now = new Date();
  const today = dateOnly(
    `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
  );
  const [name, setName] = useState(source?.project.name ?? ""),
    [description, setDescription] = useState(source?.project.description ?? ""),
    [start, setStart] = useState<string>(source?.project.startDate ?? today);
  return (
    <div className="modal-backdrop">
      <form
        className="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={source ? "Редактирование проекта" : "Новый проект"}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(name, description, dateOnly(start)).then((ok) => {
            if (ok) onClose();
          });
        }}
      >
        <h2>{source ? "Редактирование проекта" : "Новый проект"}</h2>
        <label>
          Название проекта
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label>
          Описание
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
        </label>
        {!source && (
          <label>
            Начальная дата
            <input
              type="date"
              min="0001-01-01"
              max="9999-12-18"
              required
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
              }}
            />
          </label>
        )}
        <p className="dialog-note">
          Нейтральный шаблон · 14 дней · 2 этапа · 4 процесса · 8 задач ·
          один финальный дедлайн. Без исполнителей.
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
          <button className="primary-button" disabled={busy}>
            {source ? "Сохранить" : "Создать проект"}
          </button>
        </div>
      </form>
    </div>
  );
}
