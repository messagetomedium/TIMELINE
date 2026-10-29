import { orderedProcesses, orderedStageMarkers } from '../../application/projectQueries';
import type { ProjectDocument } from '../../domain';
import { DateRange } from './DateRange';
import { formatDate } from './formatDate';

export function ProjectSummary({ document }: { readonly document: ProjectDocument }) {
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Демонстрационный проект · только просмотр</p>
        <h1>{document.project.name}</h1>
        <p className="muted">{document.project.description}</p>
        <p><DateRange value={document.project} /></p>
      </header>
      <div className="summary-grid">
        <section className="panel" aria-labelledby="processes-heading">
          <div className="section-heading"><h2 id="processes-heading">Процессы</h2><span className="count">{document.processes.length}</span></div>
          <ol className="process-list">
            {orderedProcesses(document).map((process) => (
              <li key={process.id} className="process">
                <div className="process-heading">
                  <span className="color-dot" style={{ backgroundColor: process.color }} aria-hidden="true" />
                  <h3>{process.title}</h3><span className="status">{process.status}</span>
                </div>
                <p className="muted"><DateRange value={process} /></p>
                <ul className="task-list" aria-label={`Задачи: ${process.title}`}>
                  {document.tasks.filter((task) => task.processId === process.id).sort((a, b) => a.sortIndex - b.sortIndex || a.id.localeCompare(b.id)).map((task) => (
                    <li key={task.id}><span>{task.title}</span><span className="muted">{task.status}</span></li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
        <section className="panel" aria-labelledby="stages-heading">
          <div className="section-heading"><h2 id="stages-heading">Этапы</h2><span className="count">{document.stageMarkers.length}</span></div>
          <ol className="stage-list">
            {orderedStageMarkers(document).map((stage) => (
              <li key={stage.id}><time dateTime={stage.date}>{formatDate(stage.date)}</time><h3>{stage.title}</h3></li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
