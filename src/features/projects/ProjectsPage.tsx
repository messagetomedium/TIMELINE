import { useRef, useState } from 'react';
import type { ProjectDocument, ProjectId } from '../../domain';
import type { PortfolioPreferences, WorkspacePreferences } from '../../application/workspace/model';
import { ProjectCardGrid } from './ProjectCardGrid';
import type { ProjectActionProps } from './ProjectActions';
import { PortfolioTimeline } from './PortfolioTimeline';
import '../../styles/projects.css';

interface Props<TBackup extends { documents: readonly unknown[] }> extends ProjectActionProps {
  readonly documents: readonly ProjectDocument[]; readonly preferences: WorkspacePreferences;
  readonly onPreferences: (preferences: WorkspacePreferences) => void;
  readonly onOpen: (id: ProjectId) => void; readonly onNew: () => void;
  readonly onShift: (id: ProjectId, days: number, revision: number) => void;
  readonly onExport: () => Promise<string | null>;
  readonly onPreviewImport: (text: string) => Promise<{ backup: TBackup; collisions: number } | null>;
  readonly onImport: (backup: TBackup, copies: boolean) => Promise<boolean>;
}

export function ProjectsPage<TBackup extends { documents: readonly unknown[] }>({ documents, preferences, onPreferences, onOpen, onNew, onShift, onExport, onPreviewImport, onImport, ...actions }: Props<TBackup>) {
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
    <header className="projects-heading"><div><p className="eyebrow">Рабочее пространство</p><div className="projects-title-row"><h1>Проекты</h1><div className="view-switch" role="group" aria-label="Представление проектов">
      <button aria-pressed={preferences.mode === 'cards'} onClick={() => { onPreferences({ ...preferences, mode: 'cards' }); }}><span aria-hidden="true">▦</span>Карточки</button>
      <button aria-pressed={preferences.mode === 'timeline'} onClick={() => { onPreferences({ ...preferences, mode: 'timeline' }); }}><span aria-hidden="true">☷</span>Таймлайн</button>
    </div></div></div><button className="primary-button" onClick={onNew}>+ Новый проект</button></header>
    <div className="projects-storage"><span>Данные хранятся в этом браузере · без синхронизации между устройствами</span><div><button onClick={() => { void exportFile(); }}>Экспортировать резервную копию JSON</button><button onClick={() => { file.current?.click(); }}>Импортировать JSON</button></div>
      <input ref={file} type="file" accept=".json,application/json" aria-label="Файл резервной копии" hidden onChange={(event) => {
        const selected = event.target.files?.[0]; event.target.value = '';
        if (selected) void selected.text().then(onPreviewImport).then((result) => { if (result) { setPreview(result); setCopies(result.collisions > 0); } });
      }} />
    </div>
    {documents.length === 0 ? <section className="projects-empty"><h2>Проектов пока нет</h2><p>Создайте проект: два этапа, четыре процесса и восемь задач без назначенных исполнителей.</p><button className="primary-button" onClick={onNew}>Создать первый проект</button></section>
      : preferences.mode === 'cards' ? <ProjectCardGrid documents={documents} onOpen={onOpen} {...actions} />
        : <PortfolioTimeline documents={documents} preferences={preferences.portfolio} onPreferences={changePortfolio} onOpen={onOpen} onShift={onShift} {...actions} />}
    {preview && <div className="modal-backdrop"><form className="workspace-dialog" role="dialog" aria-modal="true" aria-label="Импорт резервной копии" onSubmit={(event) => { event.preventDefault(); setImporting(true); void onImport(preview.backup, copies).then((ok) => { if (ok) setPreview(null); }).finally(() => { setImporting(false); }); }}>
      <h2>Импорт резервной копии</h2><p>Проектов в файле: {preview.backup.documents.length}.</p><p>{preview.collisions ? `Совпадений ID с локальными проектами: ${String(preview.collisions)}. Можно импортировать только как независимые копии.` : 'Совпадений ID не обнаружено. Существующие проекты останутся на месте.'}</p>
      <label className="checkbox-label"><input type="checkbox" checked={copies} disabled={preview.collisions > 0 || importing} onChange={(event) => { setCopies(event.target.checked); }} />Импортировать как копии с новыми ID</label>
      <p className="dialog-note">Настройки общего календаря будут восстановлены из файла. Все документы импортируются одной транзакцией.</p>
      <div className="dialog-footer"><button type="button" className="quiet-button" disabled={importing} onClick={() => { setPreview(null); }}>Отмена</button><button type="submit" className="primary-button" disabled={importing}>{copies ? 'Импортировать как копии' : 'Импортировать'}</button></div>
    </form></div>}
  </main>;
}
