import type { ProjectDocument } from '../../domain';
import { DateRange } from './DateRange';

interface Props {
  readonly demo: ProjectDocument | null;
  readonly onShowDemo: () => void;
  readonly onOpenDemo: () => void;
}

export function ProjectOverview({ demo, onShowDemo, onOpenDemo }: Props) {
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Рабочее пространство</p>
        <h1>Проекты</h1>
        <p className="muted">От замысла до премьеры — всё начинается с проекта.</p>
      </header>
      {demo ? (
        <section aria-label="Список проектов" className="project-list">
          <button className="project-card" onClick={onOpenDemo}>
            <span className="tag">Демонстрационный проект</span>
            <span className="project-name">{demo.project.name}</span>
            <span className="muted">{demo.project.description}</span>
            <span className="card-footer"><DateRange value={demo.project} /><span aria-hidden="true">↗</span></span>
          </button>
        </section>
      ) : (
        <section className="empty-state" aria-labelledby="empty-title">
          <div className="empty-symbol" aria-hidden="true"><i /><i /><i /></div>
          <h2 id="empty-title">Здесь будут ваши проекты</h2>
          <p className="muted">Познакомьтесь со структурой проекта на примере небольшого фильма.</p>
          <button className="button" onClick={onShowDemo}>Показать демо-проект <span aria-hidden="true">→</span></button>
        </section>
      )}
    </>
  );
}
