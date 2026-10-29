import { useEffect, useRef, useState } from 'react';
import { daysBetween, gridStepSchema } from '../../domain';
import type { GridStep, ProcessId, ProjectDocument } from '../../domain';
import { widthForInterval, xForDate, zoomCamera } from '../../domain/timeline';
import type { TimelineCamera } from '../../domain/timeline';
import { applyTimelineCommand } from '../../application/timelineCommands';
import type { Selection } from '../../application/timelineCommands';
import { layoutTimeline } from '../../application/timelineLayout';
import { CalendarRuler, DateLines, StageBand, TimeGrid } from './CalendarLayers';
import { DetailsInspector } from './DetailsInspector';
import { PerformersSection } from './PerformersSection';
import { TimelineBar } from './TimelineBar';
import { useTimelineGesture } from './useTimelineGesture';
import { useLocalToday } from './useLocalToday';
import '../../styles/timeline.css';

interface Props {
  readonly document: ProjectDocument;
  readonly onCommit: (document: ProjectDocument) => void;
}

export function TimelineWorkspace({ document, onCommit }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const [width, setWidth] = useState(1100);
  const [camera, setCamera] = useState<TimelineCamera>({ originDate: document.project.startDate, pxPerDay: 3, panX: 176 });
  const [step, setStep] = useState<GridStep>('1w');
  const [weekends, setWeekends] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<ProcessId>>(() => new Set(document.viewPreferences.expandedProcessIds));
  const [selection, setSelection] = useState<Selection | null>(() => document.processes[0] ? { kind: 'process', id: document.processes[0].id } : null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [error, setError] = useState('');
  const today = useLocalToday();
  const gesture = useTimelineGesture({ document, camera, step, surface, body, setCamera, onCommit, onError: setError });
  const sceneDocument = gesture.preview ?? document;
  const layout = layoutTimeline(sceneDocument, expanded);
  const bodyHeight = Math.max(460, layout.height);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setWidth(entry.contentRect.width);
      if (!initialized.current) {
        const pxPerDay = Math.max(1.5, (entry.contentRect.width - 200) / daysBetween(document.project.startDate, document.project.endDateExclusive));
        setCamera((previous) => ({ ...previous, pxPerDay }));
        initialized.current = true;
      }
    });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [document.project.startDate, document.project.endDateExclusive]);

  const select = (target: Selection) => {
    setSelection(target);
    if (target.kind === 'process') setExpanded((previous) => new Set([...previous, target.id]));
  };
  const toggle = (id: ProcessId) => {
    setExpanded((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const rename = (target: Selection, title: string) => {
    const result = applyTimelineCommand(document, { type: 'rename', target, title });
    if (result.ok) { onCommit(result.document); setError(''); } else setError(result.error);
  };
  const startBar: typeof gesture.startBar = (event, target, action) => { select(target); gesture.startBar(event, target, action); };
  const selectedItem = selection?.kind === 'process' ? sceneDocument.processes.find((item) => item.id === selection.id) : sceneDocument.tasks.find((item) => item.id === selection?.id);
  return <main className="timeline-workspace" aria-label="Редактор таймлайна" data-project-revision={document.project.revision}>
    <div className={`timeline-surface ${gesture.active ? `gesture-${gesture.active}` : ''} ${gesture.invalid ? 'invalid-gesture' : ''}`} ref={surface}
      onPointerDown={gesture.startPan} onPointerMove={gesture.onPointerMove} onPointerUp={gesture.onPointerUp} onPointerCancel={gesture.onPointerCancel} onLostPointerCapture={gesture.onLostPointerCapture}>
      <CalendarRuler camera={camera} width={width} step={step} />
      <StageBand document={sceneDocument} camera={camera} onStart={gesture.startStage} />
      <div className="timeline-body" ref={body} aria-label="Производственный план">
        <div className="timeline-canvas" style={{ height: bodyHeight }}>
          <TimeGrid camera={camera} width={width} height={bodyHeight} step={step} weekends={weekends} />
          <span className="production-caption">ПРОИЗВОДСТВО <small>{document.processes.length} процессов · {document.tasks.length} задачи</small></span>
          {layout.rows.map((row) => <div key={`${row.id}:${row.processId ?? ''}`} className="lane-divider" style={{ top: row.y + 30 }} />)}
          {layout.groups.map((group) => {
            const process = sceneDocument.processes.find((item) => item.id === group.processId);
            return process ? <div className="process-container" key={group.processId} style={{ left: xForDate(process.startDate, camera), width: widthForInterval(process, camera), top: group.y - 3, height: group.height, borderColor: `${process.color}55`, backgroundColor: `${process.color}09` }} /> : null;
          })}
          <DateLines document={sceneDocument} camera={camera} today={today} height={bodyHeight} />
          {layout.rows.flatMap((row) => {
            if (row.kind === 'process') return sceneDocument.processes.filter((item) => item.laneId === row.id).map((process) => <TimelineBar key={process.id} item={process} target={{ kind: 'process', id: process.id }} camera={camera} y={row.y} color={process.color}
              selected={selection?.id === process.id} highlighted={hovered === process.id} expanded={expanded.has(process.id)} toggle={() => { toggle(process.id); }} onSelect={select} onRename={rename} onHover={setHovered} onGesture={startBar} />);
            return sceneDocument.tasks.filter((item) => item.laneId === row.id).map((task) => {
              const process = sceneDocument.processes.find((item) => item.id === task.processId);
              return <TimelineBar key={task.id} item={task} target={{ kind: 'task', id: task.id }} camera={camera} y={row.y} color={process?.color ?? '#888888'}
                selected={selection?.id === task.id} highlighted={hovered === task.id} expanded={false} toggle={undefined} onSelect={select} onRename={rename} onHover={setHovered} onGesture={startBar} />;
            });
          })}
        </div>
      </div>
      <PerformersSection document={sceneDocument} camera={camera} width={width} step={step} weekends={weekends} today={today} hovered={hovered} onHover={setHovered} />
      <div className="toolbar-dock" data-interactive>
        <div className="floating-toolbar" role="toolbar" aria-label="Вид таймлайна">
          <button aria-label="Уменьшить масштаб" onClick={() => { setCamera((previous) => zoomCamera(previous, 1 / 1.25, width / 2)); }}>−</button>
          <output aria-label="Масштаб">{Math.round(camera.pxPerDay * 100 / 3)}%</output>
          <button aria-label="Увеличить масштаб" onClick={() => { setCamera((previous) => zoomCamera(previous, 1.25, width / 2)); }}>+</button>
          <span className="toolbar-separator" />
          <label htmlFor="grid-step">Шаг</label><select id="grid-step" value={step} onChange={(event) => { setStep(gridStepSchema.parse(event.target.value)); }}>
            <option value="1d">1 день</option><option value="2d">2 дня</option><option value="3d">3 дня</option><option value="1w">Неделя</option><option value="2w">2 недели</option><option value="1mo">Месяц</option>
          </select>
          <span className="toolbar-separator" /><button className="weekend-button" aria-pressed={weekends} onClick={() => { setWeekends((previous) => !previous); }}><i />Выходные</button>
        </div>
        <span className="gesture-hint">Фон — панорама · ⠿ — перенос · Esc — отмена</span>
      </div>
      {error && <div className="timeline-error" role="alert" data-interactive>{error}<button aria-label="Закрыть сообщение" onClick={() => { setError(''); }}>×</button></div>}
    </div>
    <DetailsInspector key={`${selection?.id ?? 'none'}:${selectedItem?.title ?? ''}`} document={sceneDocument} selection={selection} onRename={rename} />
  </main>;
}
