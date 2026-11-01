import { orderedProjects } from "../../application/v2/portfolio";
import type { ProjectSummary, PortfolioState, PortfolioCommand } from "../../application/v2/portfolio";
import { useEffect, useRef, useState } from 'react';
import type { ProjectDocument, ProjectId } from '../../domain';
import type { PortfolioPreferences, WorkspacePreferences } from '../../application/workspace/model';
import { ProjectCardGrid } from './ProjectCardGrid';
import type { ProjectActionProps } from './ProjectActions';
import { PortfolioTimeline } from './PortfolioTimeline';
import '../../styles/projects.css';

interface Props<TBackup extends { documents: readonly unknown[] }> extends ProjectActionProps {
  readonly summaries?: readonly ProjectSummary[];
  readonly portfolio?: PortfolioState;
  readonly onPortfolio?: (command: PortfolioCommand) => void;
  readonly onUndo?: (redo: boolean) => void;
  readonly documents: readonly ProjectDocument[]; readonly preferences: WorkspacePreferences;
  readonly onPreferences: (preferences: WorkspacePreferences) => void;
  readonly onOpen: (id: ProjectId) => void; readonly onNew: () => void;
  readonly onShift: (id: ProjectId, days: number, revision: number) => void;
  readonly onExport: () => Promise<string | null>;
  readonly onPreviewImport: (text: string) => Promise<{ backup: TBackup; collisions: number } | null>;
  readonly onImport: (backup: TBackup, copies: boolean) => Promise<boolean>;
}

export function ProjectsPage<TBackup extends { documents: readonly unknown[] }>({ documents, summaries, portfolio, onPortfolio, onUndo, preferences, onPreferences, onOpen, onNew, onShift, onExport, onPreviewImport, onImport, ...actions }: Props<TBackup>) {
  const [archive, setArchive] = useState(location.hash === '#/archive');
  const [confirm, setConfirm] = useState<ProjectDocument | null>(null);
  useEffect(() => {
    const route = () => { setArchive(location.hash === '#/archive'); };
    window.addEventListener('hashchange', route);
    return () => { window.removeEventListener('hashchange', route); };
  }, []);
  const meta = new Map(summaries?.map((d) => [d.project.id, d.project]));
  const cards = documents.filter((d) => !!meta.get(d.project.id)?.archivedAt === archive);
  const inactiveIds = new Set(summaries?.filter((d) => !d.project.isScheduled).map((d) => d.project.id));
  const visible = cards.filter((d) => !inactiveIds.has(d.project.id) || preferences.portfolio.showInactive);
  const positions = new Map(orderedProjects(summaries ?? [], portfolio?.order ?? []).map((d,i) => [d.project.id,i]));
  const timeline = [...visible].sort((a,b) => (positions.get(a.project.id) ?? 0) - (positions.get(b.project.id) ?? 0));
  const cardActions = { ...actions, onDelete: actions.onDelete ? (d: ProjectDocument) => { setConfirm(d); } : undefined };
  const file = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ backup: TBackup; collisions: number } | null>(null);
  const [copies, setCopies] = useState(false);
  const [importing, setImporting] = useState(false);
  const changePortfolio = (portfolio: PortfolioPreferences) => { onPreferences({ ...preferences, portfolio }); };
  const exportFile = async () => {
    const content = await onExport();
    if (!content) return;
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `timeline-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
  };
  return <main className="projects-page" aria-label="Проекты">
    <header className="projects-heading"><div><p className="eyebrow"><span className="editorial-index" aria-hidden="true">TL /</span> Рабочее пространство</p><div className="projects-title-row"><h1>{archive ? "Архив" : "Проекты"}</h1><div className="view-switch" role="group" aria-label="Представление проектов">
      <button aria-pressed={preferences.mode === 'cards'} onClick={() => { onPreferences({ ...preferences, mode: 'cards' }); }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>Карточки</button>
      <button aria-pressed={preferences.mode === 'timeline'} onClick={() => { onPreferences({ ...preferences, mode: 'timeline' }); }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h10M8 12h13M3 19h14"/><path d="M3 3v4M8 10v4M17 17v4"/></svg>Таймлайн</button>
    </div></div></div><button className="primary-button" onClick={onNew}>+ Новый проект</button></header>
    {portfolio && <div className="projects-storage">
      <button onClick={() => { location.hash = archive ? '/projects' : '/archive'; }}>{archive ? 'Все проекты' : 'Архив'}</button>
      <div><button aria-label="Отменить в портфеле" disabled={!portfolio.undo.length} onClick={() => { onUndo?.(false); }}>↶</button><button aria-label="Повторить в портфеле" disabled={!portfolio.redo.length} onClick={() => { onUndo?.(true); }}>↷</button></div>
    </div>}
    <div className="projects-storage"><span>Данные хранятся в этом браузере · без синхронизации между устройствами</span><div><button onClick={() => { void exportFile(); }}>Экспортировать резервную копию JSON</button><button onClick={() => { file.current?.click(); }}>Импортировать JSON</button></div>
      <input ref={file} type="file" accept=".json,application/json" aria-label="Файл резервной копии" hidden onChange={(event) => {
        const selected = event.target.files?.[0]; event.target.value = '';
        if (selected) void selected.text().then(onPreviewImport).then((result) => { if (result) { setPreview(result); setCopies(result.collisions > 0); } });
      }} />
    </div>
    {archive ? <ProjectCardGrid documents={cards} inactiveIds={inactiveIds} onOpen={onOpen} {...actions} onDelete={undefined} onRestore={(d) => { onPortfolio?.({ type: 'ArchiveProject', id: d.project.id, archived: false }); }} />
      : preferences.mode === 'cards' ? <>
        {cards.length === 0 && <section className="projects-empty"><h2>Проектов пока нет</h2><p>Создайте проект: два этапа, четыре процесса и восемь задач без назначенных исполнителей.</p><button className="primary-button" onClick={onNew}>Создать первый проект</button></section>}
        <ProjectCardGrid documents={cards} inactiveIds={inactiveIds} onOpen={onOpen} {...cardActions} />
      </> : <>
        <button aria-pressed={preferences.portfolio.showInactive ?? false} onClick={() => { changePortfolio({ ...preferences.portfolio, showInactive: !preferences.portfolio.showInactive }); }}>{preferences.portfolio.showInactive ? 'Скрыть неактивные' : 'Показать неактивные'}</button>
        <PortfolioTimeline documents={timeline} preferences={preferences.portfolio} onPreferences={changePortfolio} onOpen={onOpen} onShift={onShift} onReorder={onPortfolio ? (order) => { onPortfolio({ type: 'ReorderProjects', order }); } : undefined} {...cardActions} />
      </>}
    {confirm && <section className="modal-backdrop"><section className="workspace-dialog" role="dialog" aria-modal="true" aria-label="Архивирование проекта">
      <h2>Удалить проект «{confirm.project.name}»?</h2><p>Проект будет перемещён в архив. Все данные сохранятся, проект можно восстановить.</p>
      <div className="dialog-footer"><button onClick={() => { setConfirm(null); }}>Отмена</button><button className="danger-button" onClick={() => { actions.onDelete?.(confirm); setConfirm(null); }}>В архив</button></div>
    </section></section>}
    {preview && <div className="modal-backdrop"><form className="workspace-dialog" role="dialog" aria-modal="true" aria-label="Импорт резервной копии" onSubmit={(event) => { event.preventDefault(); setImporting(true); void onImport(preview.backup, copies).then((ok) => { if (ok) setPreview(null); }).finally(() => { setImporting(false); }); }}>
      <h2>Импорт резервной копии</h2><p>Проектов в файле: {preview.backup.documents.length}.</p><p>{preview.collisions ? `Совпадений ID с локальными проектами: ${String(preview.collisions)}. Можно импортировать только как независимые копии.` : 'Совпадений ID не обнаружено. Существующие проекты останутся на месте.'}</p>
      <label className="checkbox-label"><input type="checkbox" checked={copies} disabled={preview.collisions > 0 || importing} onChange={(event) => { setCopies(event.target.checked); }} />Импортировать как копии с новыми ID</label>
      <p className="dialog-note">Настройки общего календаря будут восстановлены из файла. Все документы импортируются одной транзакцией.</p>
      <div className="dialog-footer"><button type="button" className="quiet-button" disabled={importing} onClick={() => { setPreview(null); }}>Отмена</button><button type="submit" className="primary-button" disabled={importing}>{copies ? 'Импортировать как копии' : 'Импортировать'}</button></div>
    </form></div>}
  </main>;
}
