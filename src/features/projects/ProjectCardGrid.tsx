import type { ProjectDocument, ProjectId } from '../../domain';
import { projectColor } from '../../application/workspace/portfolio';
import { DateRange } from './DateRange';
import { ProjectActions } from './ProjectActions';
import type { ProjectActionProps } from './ProjectActions';

export function ProjectCardGrid({ documents, onOpen, ...actions }: ProjectActionProps & { readonly documents: readonly ProjectDocument[]; readonly onOpen: (id: ProjectId) => void }) {
  return <section className="project-card-grid" aria-label="Карточки проектов">
    {documents.map((document) => <article className="saved-project-card" key={document.project.id} data-project-id={document.project.id} style={{ borderTopColor: projectColor(document.project.id) }}>
      <div className="project-card-top"><span className="card-project-label">Проект</span><ProjectActions document={document} {...actions} /></div>
      <h2>{document.project.name}</h2><p className="card-description">{document.project.description || 'Без описания'}</p>
      <DateRange value={document.project} />
      <button className="card-open" onClick={() => { onOpen(document.project.id); }}>Открыть<span aria-hidden="true">→</span></button>
    </article>)}
  </section>;
}
