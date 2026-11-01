import type { ProjectDocument } from '../../domain';

export interface ProjectActionProps {
  readonly onRename: (document: ProjectDocument) => void;
  readonly onDuplicate: (document: ProjectDocument) => void;
  readonly onDelete?: ((document: ProjectDocument) => void) | undefined;
}
export function ProjectActions({ document, onRename, onDuplicate, onDelete }: ProjectActionProps & { readonly document: ProjectDocument }) {
  return <details className="project-actions" data-interactive><summary aria-label={`Действия: ${document.project.name}`}>···</summary><div role="menu" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); }}>
    <button role="menuitem" onClick={() => { onRename(document); }}>Переименовать</button>
    <button role="menuitem" onClick={() => { onDuplicate(document); }}>Дублировать</button>
    {onDelete && <button role="menuitem" className="danger-text" onClick={() => { onDelete(document); }}>Удалить</button>}
  </div></details>;
}
