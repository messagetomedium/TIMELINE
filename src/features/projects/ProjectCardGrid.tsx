import type { ProjectDocument, ProjectId } from '../../domain';
import { FolderShape } from '../ui/FolderShape';
import { DateRange } from './DateRange';
import { ProjectActions } from './ProjectActions';
import type { ProjectActionProps } from './ProjectActions';

export function ProjectCardGrid({ documents, onOpen, inactiveIds, onRestore, onNew, ...actions }: ProjectActionProps & { readonly onNew?: () => void; readonly inactiveIds?: ReadonlySet<string>; readonly onRestore?: (d: ProjectDocument) => void; readonly documents: readonly ProjectDocument[]; readonly onOpen: (id: ProjectId) => void }) {
  return <section className="project-card-grid" aria-label="Карточки проектов">
    {onNew && <button className="new-project-card" aria-label="+ Новый проект" onClick={onNew}><FolderShape /><span className="card-project-label">создать</span><strong>НОВЫЙ ПРОЕКТ</strong><span className="new-card-footer" aria-hidden="true">＋</span></button>}
    {documents.map((document) => <article className="saved-project-card" key={document.project.id} data-project-id={document.project.id}>
      <FolderShape />
      <div className="project-card-top"><span className="card-project-label">Проект</span>{!onRestore && <ProjectActions document={document} {...actions} />}</div>
      <h2>{document.project.name}</h2><p className="card-description">{document.project.description || 'Без описания'}</p>
      {inactiveIds?.has(document.project.id) && <span>Неактивный</span>}
      <div className="card-dates"><DateRange value={document.project} /></div>
      {onRestore && <button className="card-open" onClick={() => { onRestore(document); }}>Восстановить проект</button>}
      {!onRestore && <button className="card-open" onClick={() => { onOpen(document.project.id); }}>Открыть<span aria-hidden="true">→</span></button>}
    </article>)}
  </section>;
}
