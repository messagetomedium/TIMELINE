import type { CSSProperties } from 'react';
import type { DateOnly, ProjectDocument } from '../../domain';
import type { CalendarGeometry } from '../../domain/calendar';
import { timeFragments } from '../../domain/SegmentAxis';
import type { TimelineCamera } from '../../domain/timeline';
import { DateLines, TimeGrid } from './CalendarLayers';

interface Props {
  readonly document: ProjectDocument;
  readonly camera: TimelineCamera;
  readonly width: number;
  readonly calendar: CalendarGeometry;
  readonly weekends: boolean;
  readonly today: DateOnly;
  readonly hovered: string | null;
  readonly onHover: (id: string | null) => void;
}

export function PerformersSection({ document, camera, width, calendar, weekends, today, hovered, onHover }: Props) {
  const related = new Set([hovered]);
  if (document.processes.some((process) => process.id === hovered)) {
    document.tasks.filter((task) => task.processId === hovered).forEach((task) => related.add(task.id));
  }
  const height = document.people.length * 24 + 12;
  return <section className="performers-section" aria-label="Занятость исполнителей">
    <header className="performers-heading"><h2>Исполнители</h2><span>Занятость · {document.people.length} человек <i /> Общая ось времени</span></header>
    <div className="performers-scroll">
      <div className="performers-canvas" style={{ height }}>
        <div className="performers-time-background">
          <TimeGrid camera={camera} width={width} height={height} calendar={calendar} weekends={weekends} />
          <DateLines document={document} camera={camera} today={today} height={height} showTodayLabel={false} />
        </div>
        {document.people.map((person, index) => {
          const assignments = document.assignments.filter((assignment) => assignment.personId === person.id);
          const highlighted = assignments.some((assignment) => related.has(assignment.targetId));
          return <div className={`performer-row ${highlighted ? 'highlighted' : ''}`} key={person.id} data-person-id={person.id} data-highlighted={highlighted} style={{ top: 6 + index * 24 }}>
            <span className="performer-name" title={`${person.defaultRole ?? ''} — ${person.displayName ?? ''}`}><strong>{person.defaultRole}</strong> · {person.displayName}</span>
            <div className="performer-track">{assignments.map((assignment) => {
              const item = assignment.targetType === 'process' ? document.processes.find((process) => process.id === assignment.targetId) : document.tasks.find((task) => task.id === assignment.targetId);
              if (!item) return null;
              const parent = assignment.targetType === 'process' ? document.processes.find((process) => process.id === item.id) : document.processes.find((process) => 'processId' in item && process.id === item.processId);
              return timeFragments(item,camera).map(f=><div data-interactive key={`${assignment.id}:${f.startDate}`} className={`performer-segment ${related.has(item.id) ? 'linked' : ''}`} data-target-id={item.id} style={{left:f.x,width:f.width,'--bar-color':parent?.color} as CSSProperties}
                title={`${assignment.roleLabel} · ${person.displayName ?? ''} · ${item.title}`} onMouseEnter={() => { onHover(item.id); }} onMouseLeave={() => { onHover(null); }} />);
            })}</div>
          </div>;
        })}
      </div>
    </div>
  </section>;
}
