import type { CSSProperties } from 'react';
import type { DateOnly, GridStep, ProjectDocument } from '../../domain';
import { widthForInterval, xForDate } from '../../domain/timeline';
import type { TimelineCamera } from '../../domain/timeline';
import { DateLines, TimeGrid } from './CalendarLayers';

interface Props {
  readonly document: ProjectDocument;
  readonly camera: TimelineCamera;
  readonly width: number;
  readonly step: GridStep;
  readonly weekends: boolean;
  readonly today: DateOnly;
  readonly hovered: string | null;
  readonly onHover: (id: string | null) => void;
}

export function PerformersSection({ document, camera, width, step, weekends, today, hovered, onHover }: Props) {
  const related = new Set([hovered]);
  if (document.processes.some((process) => process.id === hovered)) {
    document.tasks.filter((task) => task.processId === hovered).forEach((task) => related.add(task.id));
  }
  const height = document.people.length * 20 + 12;
  return <section className="performers-section" aria-label="Занятость исполнителей">
    <header className="performers-heading"><h2>Занятость исполнителей</h2><span>{document.people.length} человек <i /> Общая ось времени</span></header>
    <div className="performers-scroll">
      <div className="performers-canvas" style={{ height }}>
        <TimeGrid camera={camera} width={width} height={height} step={step} weekends={weekends} />
        <DateLines document={document} camera={camera} today={today} height={height} />
        {document.people.map((person, index) => {
          const assignments = document.assignments.filter((assignment) => assignment.personId === person.id);
          const highlighted = assignments.some((assignment) => related.has(assignment.targetId));
          return <div className={`performer-row ${highlighted ? 'highlighted' : ''}`} key={person.id} data-person-id={person.id} data-highlighted={highlighted} style={{ top: 6 + index * 20 }}>
            <span className="performer-name" title={`${person.defaultRole ?? ''} — ${person.displayName ?? ''}`}><strong>{person.defaultRole}</strong> · {person.displayName}</span>
            {assignments.map((assignment) => {
              const item = assignment.targetType === 'process' ? document.processes.find((process) => process.id === assignment.targetId) : document.tasks.find((task) => task.id === assignment.targetId);
              if (!item) return null;
              const parent = assignment.targetType === 'process' ? document.processes.find((process) => process.id === item.id) : document.processes.find((process) => 'processId' in item && process.id === item.processId);
              const style = { left: xForDate(item.startDate, camera), width: widthForInterval(item, camera), '--bar-color': parent?.color } as CSSProperties;
              return <div data-interactive key={assignment.id} className={`performer-segment ${related.has(item.id) ? 'linked' : ''}`} data-target-id={item.id} style={style}
                title={`${assignment.roleLabel} · ${person.displayName ?? ''} · ${item.title}`} onMouseEnter={() => { onHover(item.id); }} onMouseLeave={() => { onHover(null); }} />;
            })}
          </div>;
        })}
      </div>
    </div>
  </section>;
}
