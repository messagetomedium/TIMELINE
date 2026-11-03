import { emptyPortfolio, summaryDocument } from "../application/v2/portfolio";
import type { ProjectSummary } from "../application/v2/portfolio";
import { PeopleCatalog } from "../features/timeline/PeopleUI";
import { emptyCatalog } from "../domain/v2/peopleModel";
import { WORKSPACE_ID } from "../domain/v2/model";
import type { PeopleCommand } from "../domain/v2/people";
import { FolderNavigation } from "../features/navigation/FolderNavigation";
import { CommitText } from "../features/timeline/CommitText";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dateOnly, projectIdSchema } from "../domain";
import type { ProjectId, ViewPreferences } from "../domain";
import type { Snapshot } from "../domain/v2/model";

import type { UIService, ServerRecovery, RecoveryState } from "../application/v2/uiService";
import { ServerRecoveryPanel } from "./ServerRecoveryPanel";
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
const noRecovery: RecoveryState = { pending: false, sending: false, message: "", intent: "", conflict: false, authRequired: false, drafts: {} };
const noSubscribe = () => () => undefined;
const noState = () => noRecovery;
export function FoundationApp({ service, server }: { service: UIService; server?: { recovery: ServerRecovery; email: string; onLogout: () => Promise<void>; onLogin: () => void } }) {
  const recovery = server?.recovery;
  const recoveryState = useSyncExternalStore(recovery?.subscribe ?? noSubscribe, recovery?.getState ?? noState);
  const [readFailed, setReadFailed] = useState(false), [epoch, setEpoch] = useState(0), [showDrafts, setShowDrafts] = useState(false);
  const [catalog, setCatalog] = useState(() => emptyCatalog(WORKSPACE_ID)),
    [peopleOpen, setPeopleOpen] = useState(false);
  const [documents, setDocuments] = useState<ProjectSummary[] | null>(null),
    [preferences, setPreferences] = useState(defaultPreferences),
    [views, setViews] = useState<Record<string, ViewPreferences>>({});
  const [id, setId] = useState(selectedId),
    [error, setError] = useState(""),
    [historyIssues, setHistoryIssues] = useState<string[]>([]),
    [legacy, setLegacy] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(0);
  const [detail, setActive] = useState<Snapshot | null>(null),
    [loadedId, setLoadedId] = useState<string | null>(null),
    [portfolio, setPortfolio] = useState(emptyPortfolio);
  const active = detail?.project.id === id ? detail : null;
  const [dialog, setDialog] = useState<"new" | ProjectSummary | null>(null);
  const draftKeys = useRef(new WeakMap<HTMLElement, string>());
  const writing = useRef(0),
    operations = useRef(Promise.resolve()),
    queue = useRef(Promise.resolve()),
    reading = useRef(0);
  const refresh = useCallback(async () => {
    const token = ++reading.current;
    const requestedId = selectedId() ?? null;
    let s: Awaited<ReturnType<UIService["screen"]>>;
    try { s = await service.screen(requestedId); }
    catch (e) { if (token === reading.current) setReadFailed(true); throw e; }
    if (token === reading.current) setReadFailed(false);
    if (token !== reading.current) return;
    setActive(s.active);
    setLoadedId(requestedId);
    setPortfolio(s.portfolio);
    setDocuments(s.documents);
    setCatalog(s.catalog);
    setPreferences(s.preferences);
    setViews(s.views);
    setHistoryIssues(s.historyIssues);
  }, [service]);
  const report = (e: unknown) => {
    setError(
      e instanceof Error ? e.message : "Ошибка сохранения. Данные не сброшены.",
    );
  };
  useEffect(() => {
    void Promise.resolve().then(refresh).catch(report);
    if (!recovery) void hasLegacyData().then(setLegacy).catch(report);
    const listener = () => {
      setId(selectedId());
      void refresh().catch(report);
    };
    window.addEventListener("hashchange", listener);
    return () => {
      window.removeEventListener("hashchange", listener);
    };
  }, [refresh, recovery]);
  const run = useCallback(
    (operation: () => Promise<unknown>) => {
      writing.current += 1;
      setBusy(true);
      const result = operations.current.then(async () => {
        setError("");
        try {
          await queue.current;
          await operation();
          await refresh();
          return true;
        } catch (e) {
          report(e);
          if (!recovery) await refresh().catch(report);
          return false;
        } finally {
          writing.current -= 1;
          setBusy(writing.current > 0);
        }
      });
      operations.current = result.then(() => undefined);
      return result;
    },
    [refresh, recovery],
  );
  const peopleCommand = (command: PeopleCommand) =>
    run(() =>
      service.peopleExecute({
        commandId: crypto.randomUUID(),
        workspaceId: catalog.workspaceId,
        expectedRevision: catalog.revision,
        command,
      }),
    );

  const undo = useCallback(
    (redo = false) => {
      if (recovery || (id && !active)) return;
      if (active) void run(() => service.undo(active.project.id, redo));
      else void run(() => service.portfolioCommand(portfolio.revision, redo ? "redo" : "undo"));
    },
    [id, active, portfolio.revision, run, service, recovery],
  );
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        recovery ||
        !(e.ctrlKey || e.metaKey) ||
        e.key.toLowerCase() !== "z" ||
        e.altKey ||
        (e.target instanceof Element &&
          e.target.closest(
            'input,textarea,[contenteditable="true"],[role="textbox"]',
          ))
      )
        return;
      if (peopleOpen) {
        e.preventDefault();
        void run(() => service.peopleUndo(catalog.revision, e.shiftKey));
      } else {
        e.preventDefault();
        undo(e.shiftKey);
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [active, undo, peopleOpen, catalog.revision, run, service, recovery]);
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
  useEffect(() => {
    if (!recovery) return;
    const guard = (event: BeforeUnloadEvent) => {
      if (recovery.getState().pending || Object.keys(recovery.getState().drafts).length || writing.current) { event.preventDefault(); }
    };
    window.addEventListener("beforeunload", guard);
    return () => { window.removeEventListener("beforeunload", guard); };
  }, [recovery]);
  const recovered = async (projectId: string | null) => {
    setError(""); setShowDrafts(false); setDialog(null); setPeopleOpen(false); setEpoch((n) => n + 1);
    if (projectId && !selectedId()) { location.hash = `/projects/${projectId}`; setId(projectId as ProjectId); }
    await refresh();
  };
  const blocked = !!recovery && (busy || recoveryState.pending || readFailed);
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
    <div className="app-shell" onInputCapture={(event) => {
      if (!recovery || !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) return;
      const input = event.target;
      if (input.readOnly || ["password", "checkbox", "radio", "button", "submit", "file"].includes(input.type)) return;
      const label = input.getAttribute("aria-label") ?? input.closest("label")?.textContent ?? input.name;
      const fields = Array.from(event.currentTarget.querySelectorAll("input,textarea"));
      const key = `${location.hash || "Проекты"} · ${label || "Поле"} · ${String(fields.indexOf(input))}`, value = input.value;
      draftKeys.current.set(input, key);
      recovery.rememberDraft(key, value);
    }} onKeyDownCapture={(event) => {
      if (event.key === "Escape" && recovery && event.target instanceof HTMLElement) {
        const key = draftKeys.current.get(event.target);
        if (key && !recovery.getState().pending) setTimeout(() => { recovery.forgetDraft(key); }, 0);
      }
    }}>
      <header className="app-header">
        <FolderNavigation
          documents={documents ?? []}
          activeId={id ?? null}
          home={!id}
          onHome={() => {
            location.hash = "/projects";
          }}
          onOpen={(projectId) => {
            location.hash = `/projects/${projectId}`;
          }}
        />
        <button
          className="navigation-button people-nav"
          disabled={!documents}
          onClick={() => {
            setPeopleOpen(true);
          }}
        >
          Исполнители
        </button>
        <div className="product-signature" aria-label="TIMELINE">TIME<span>LINE</span><i aria-hidden="true" /></div>
        <span
          className="workspace-label"
          role="status"
          aria-label="Состояние хранения"
        >
          {busy || pending
            ? "Сохраняется…"
            : recoveryState.pending ? "Запись не подтверждена"
            : readFailed ? "Нет связи с хранилищем"
            : Object.keys(recoveryState.drafts).length ? "Есть незавершённый ввод"
            : documents
              ? recovery ? "Сохранено на сервере" : "Локально в этом браузере"
              : "Открываем хранилище…"}
        </span>
        {server && <>{!!Object.keys(recoveryState.drafts).length && !recoveryState.pending && <button onClick={() => { setShowDrafts((open) => !open); }}>Черновик</button>}<span>{server.email}</span><button disabled={busy || recoveryState.pending || !!Object.keys(recoveryState.drafts).length} onClick={() => { void server.onLogout().catch(report); }}>Выйти</button></>}
      </header>
      {server && <>
        <ServerRecoveryPanel showDrafts={showDrafts} state={recoveryState} recovery={server.recovery} onRecovered={recovered} onError={report} onLogin={server.onLogin} />
        {(readFailed || recoveryState.conflict) && <div className="legacy-notice"><button onClick={() => { void refresh().catch(report); }}>Загрузить с сервера</button><button onClick={server.onLogin}>Войти снова</button></div>}
      </>}
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
      {historyIssues.map((issue) => (
        <div className="workspace-error" role="alert" key={issue}>
          {issue}
        </div>
      ))}
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
        <div className="app-content" aria-busy={busy} inert={blocked}>
          {id ? (
            loadedId !== id ? <main className="workspace-loading">Открываем проект…</main> : active ? (
              <FoundationTimeline
                key={`${id}:${String(epoch)}`}
                serverMode={!!recovery}
                snapshot={active}
                catalog={catalog}
                onPeople={peopleCommand}
                inspectorCollapsed={preferences.inspectorCollapsed ?? false}
                onToggleInspector={() => {
                  savePreferences({
                    ...preferences,
                    inspectorCollapsed: !preferences.inspectorCollapsed,
                  });
                }}
                view={views[id] ?? active.viewPreferences}
                onView={saveView}
                history={service.history(id)}
                onUndo={() => {
                  undo();
                }}
                onRedo={() => {
                  undo(true);
                }}
                onCommand={(c, revision) =>
                  run(() =>
                    revision === undefined
                      ? service.executeLocal(service.envelope(active, c))
                      : service.execute({
                          ...service.envelope(active, c),
                          expectedRevision: revision,
                        }),
                  )
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
              serverMode={!!recovery}
              documents={documents.map(summaryDocument)}
              summaries={documents}
              portfolio={portfolio}
              onPortfolio={(command) => { void run(() => service.portfolioCommand(portfolio.revision, command)); }}
              onUndo={(redo) => { undo(redo); }}
              onDelete={(d) => { void run(() => service.portfolioCommand(portfolio.revision, { type: "ArchiveProject", id: d.project.id, archived: true })); }}
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
                void run(() => service.projectCommand(projectId, { type: "ShiftProject", days }, revision));
              }}
              onExport={() => service.exportBackup().catch((e: unknown) => { report(e); return null; })}
              onPreviewImport={previewImport}
              onImport={(backup, copies) =>
                run(() => service.importBackup(backup, copies))
              }
            />
          )}
        </div>
      )}
      <div inert={blocked}>
      {peopleOpen && (
        <PeopleCatalog
          key={epoch}
          serverMode={!!recovery}
          catalog={catalog}
          onCommand={peopleCommand}
          onUndo={(redo) => {
            void run(() => service.peopleUndo(catalog.revision, redo));
          }}
          onClose={() => {
            setPeopleOpen(false);
          }}
        />
      )}
      {dialog && dialog !== "new" && (
        <section className="modal-backdrop">
          <section
            className="workspace-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Редактирование проекта"
          >
            <h2>Редактирование проекта</h2>
            {(["name", "description"] as const).map((field) => {
              const d =
                documents?.find((d) => d.project.id === dialog.project.id) ??
                dialog;
              return (
                <label key={field}>
                  {field === "name" ? "Название проекта" : "Описание"}
                  <CommitText
                    key={d.project[field] ?? ""}
                    label={field === "name" ? "Название проекта" : "Описание"}
                    value={d.project[field] ?? ""}
                    multiline={field === "description"}
                    onCommit={(value) => {
                      void run(() =>
                        service.projectCommand(d.project.id, {
                          type: field === "name" ? "Rename" : "Describe",
                          kind: "project", id: d.project.id, value,
                        }, d.project.revision, true),
                      );
                    }}
                  />
                </label>
              );
            })}
            <button
              className="primary-button"
              onClick={() => {
                setDialog(null);
              }}
            >
              Закрыть
            </button>
          </section>
        </section>
      )}
      {dialog === "new" && (
        <CreateDialog
          key={`new:${String(epoch)}`}
          source={null}
          busy={busy}
          onClose={() => {
            setDialog(null);
            if (recovery && !recovery.getState().pending) {
              try { recovery.clearDrafts(); } catch (e) { report(e); }
            }
          }}
          onSave={async (name, description, start) => {
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
          }}
        />
      )}
      </div>
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
          Нейтральный шаблон · 14 дней · 2 этапа · 4 процесса · 8 задач · один
          финальный дедлайн. Без исполнителей.
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
