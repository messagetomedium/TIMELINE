import { useCallback, useEffect, useRef, useState } from 'react';
import { projectIdSchema } from '../domain';
import type { ProcessId, ProjectDocument, ProjectId, ViewPreferences } from '../domain';
import type { WorkspaceService } from '../application/workspace/WorkspaceService';
import { RevisionConflict } from '../application/workspace/model';
import type { WorkspacePreferences } from '../application/workspace/model';
import type { WorkInput } from '../application/workspace/projectOperations';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { ProjectDialog } from '../features/projects/ProjectDialog';
import { ProjectActions } from '../features/projects/ProjectActions';
import { TimelineWorkspace } from '../features/timeline/TimelineWorkspace';

type Route = { kind: 'projects' } | { kind: 'editor'; id: ProjectId } | { kind: 'missing' };
function routeFromHash(): Route {
  if (!window.location.hash || window.location.hash === '#/projects') return { kind: 'projects' };
  const match = /^#\/projects\/([^/]+)$/.exec(window.location.hash);
  const id = projectIdSchema.safeParse(match?.[1]);
  return id.success ? { kind: 'editor', id: id.data } : { kind: 'missing' };
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось выполнить операцию. Данные не сброшены.';
}
type Snapshot = Awaited<ReturnType<WorkspaceService['snapshot']>>;

export function App({ service }: { readonly service: WorkspaceService }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingPreferences, setPendingPreferences] = useState(0);
  const writing = useRef(false);
  const preferencesQueue = useRef(Promise.resolve());
  const [dialog, setDialog] = useState<'new' | ProjectDocument | null>(null);
  const [deleting, setDeleting] = useState<ProjectDocument | null>(null);
  const navigate = (id: ProjectId | null) => { window.location.hash = id ? `/projects/${id}` : '/projects'; };

  useEffect(() => {
    const listener = () => { setRoute(routeFromHash()); };
    window.addEventListener('hashchange', listener);
    return () => { window.removeEventListener('hashchange', listener); };
  }, []);
  useEffect(() => {
    let live = true;
    void service.start().then((value) => { if (live) { setSnapshot(value); setError(''); } }).catch((reason: unknown) => { if (live) setError(`Не удалось открыть локальное хранилище. ${message(reason)}`); });
    return () => { live = false; };
  }, [service, attempt]);

  const run = async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    if (writing.current) return null;
    writing.current = true; setBusy(true); setError('');
    try {
      await preferencesQueue.current;
      const result = await operation();
      setSnapshot(await service.snapshot());
      return result;
    } catch (reason) {
      setError(message(reason));
      if (reason instanceof RevisionConflict) setSnapshot(await service.snapshot());
      return null;
    } finally { writing.current = false; setBusy(false); }
  };
  const changePreferences = useCallback((preferences: WorkspacePreferences) => {
    setSnapshot((previous) => previous ? { ...previous, preferences } : previous);
    setPendingPreferences((value) => value + 1);
    preferencesQueue.current = preferencesQueue.current.then(() => service.savePreferences(preferences)).catch((reason: unknown) => { setError(`Не удалось сохранить вид. ${message(reason)}`); }).finally(() => { setPendingPreferences((value) => value - 1); });
  }, [service]);
  const saveView = useCallback((id: ProjectId, view: ViewPreferences) => {
    setSnapshot((previous) => previous ? { ...previous, views: { ...previous.views, [id]: view } } : previous);
    setPendingPreferences((value) => value + 1);
    preferencesQueue.current = preferencesQueue.current.then(() => service.saveView(id, view)).catch((reason: unknown) => { setError(`Не удалось сохранить вид проекта. ${message(reason)}`); }).finally(() => { setPendingPreferences((value) => value - 1); });
  }, [service]);
  const createWork = async (id: ProjectId, kind: 'process' | 'task', input: WorkInput, parentId: ProcessId | null) => {
    const result = await run(async () => { await service.createWork(id, kind, input, parentId); return service.repository.load(id); });
    return result;
  };
  const actions = {
    onRename: (document: ProjectDocument) => { setDialog(document); },
    onDelete: (document: ProjectDocument) => { setDeleting(document); },
    onDuplicate: (document: ProjectDocument) => { void run(() => service.duplicate(document.project.id)); },
  };
  const active = route.kind === 'editor' ? snapshot?.documents.find((document) => document.project.id === route.id) : undefined;
  useEffect(() => { window.document.title = active ? `${active.project.name} — Таймлайн` : 'Проекты — Таймлайн'; }, [active]);
  return <div className="app-shell">
    <header className="app-header"><a className="brand" href="#/projects"><span className="brand-mark" aria-hidden="true">т</span>Таймлайн</a>
      <nav aria-label="Основная навигация"><button className="nav-link" disabled={busy} aria-current={route.kind === 'projects' ? 'page' : undefined} onClick={() => { navigate(null); }}>Проекты</button></nav>
      {active && <div className="header-project"><span>/</span><strong>{active.project.name}</strong><ProjectActions document={active} {...actions} /></div>}
      <span className="workspace-label" role="status" aria-label="Состояние хранения">{busy || pendingPreferences > 0 ? 'Сохраняется…' : snapshot ? 'Локально в этом браузере' : 'Открываем хранилище…'}</span>
    </header>
    {error && <div className="workspace-error" role="alert">{error}<button aria-label="Закрыть сообщение" onClick={() => { setError(''); }}>×</button></div>}
    {!snapshot ? <main className="workspace-loading"><h1>{error ? 'Хранилище недоступно' : 'Открываем проекты…'}</h1>{error && <><p>База не сброшена. Проверьте доступ браузера к IndexedDB.</p><button className="primary-button" onClick={() => { setAttempt((value) => value + 1); }}>Повторить</button></>}</main>
      : <div className="app-content" inert={busy}>
        {route.kind === 'projects' ? <ProjectsPage documents={snapshot.documents} preferences={snapshot.preferences} onPreferences={changePreferences} onOpen={navigate} onNew={() => { setDialog('new'); }} {...actions}
          onShift={(id, days, revision) => { void run(() => service.shift(id, days, revision)); }}
          onExport={() => run(() => service.exportBackup())} onPreviewImport={(text) => run(() => service.previewImport(text))}
          onImport={async (backup, copies) => (await run(async () => { await service.importBackup(backup, copies); return true; })) === true} />
          : active ? <TimelineWorkspace key={active.project.id} document={active} onCommit={(document) => { void run(() => service.commit(document)); }} initialView={snapshot.views[active.project.id]} onViewChange={saveView} onCreateWork={createWork} />
            : <main className="workspace-loading"><h1>Проект не найден</h1><p>Он мог быть удалён или ссылка устарела.</p><button className="primary-button" onClick={() => { navigate(null); }}>К проектам</button></main>}
      </div>}
    {dialog && <ProjectDialog source={dialog === 'new' ? null : dialog} busy={busy} onClose={() => { setDialog(null); }} onSubmit={async (input) => {
      if (dialog === 'new') { const id = await run(() => service.create(input)); if (id) { navigate(id); return true; } return false; }
      return (await run(async () => { await service.rename(dialog.project.id, input.name, input.description, dialog.project.revision); return true; })) === true;
    }} />}
    {deleting && <div className="modal-backdrop"><section className="workspace-dialog" role="dialog" aria-modal="true" aria-label="Удаление проекта"><h2>Удалить проект?</h2><p>«{deleting.project.name}» и все его процессы и задачи будут удалены из этого браузера.</p><p className="dialog-note">Перед удалением можно сделать резервную копию JSON.</p><div className="dialog-footer"><button className="quiet-button" disabled={busy} onClick={() => { setDeleting(null); }}>Отмена</button><button className="danger-button" disabled={busy} onClick={() => { void run(async () => { await service.remove(deleting.project.id, deleting.project.revision); return true; }).then((ok) => { if (ok) { if (route.kind === 'editor' && route.id === deleting.project.id) navigate(null); setDeleting(null); } }); }}>Удалить проект</button></div></section></div>}
  </div>;
}
