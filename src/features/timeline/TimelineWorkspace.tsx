import { useEffect, useRef, useState } from 'react';
import { dateOnlySchema, gridStepSchema } from '../../domain';
import type { GridStep, ProcessId, ProjectDocument, StageMarkerId } from '../../domain';
import { cameraForFitRange, cameraForFocusDate, getVisibleDateRange, widthForInterval, WORK_ZOOM, xForDate, zoomCamera } from '../../domain/timeline';
import { getCalendarGeometry, visibleYears } from '../../domain/calendar';
import type { TimelineCamera } from '../../domain/timeline';
import { applyTimelineCommand } from '../../application/timelineCommands';
import type { Selection } from '../../application/timelineCommands';
import { layoutTimeline, scheduleRange } from '../../application/timelineLayout';
import { CalendarRuler, DateLines, StageBand, TimeGrid } from './CalendarLayers';
import { DetailsInspector } from './DetailsInspector';
import { PerformersSection } from './PerformersSection';
import { TimelineBar } from './TimelineBar';
import { useTimelineGesture } from './useTimelineGesture';
import { useLocalToday } from './useLocalToday';
import { StageDateEditor } from './StageDateEditor';
import '../../styles/timeline.css';

interface Props {
  readonly document: ProjectDocument;
  readonly onCommit: (document: ProjectDocument) => void;
}

export function TimelineWorkspace({ document, onCommit }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const timeViewport = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const today = useLocalToday();
  const initialFocus = today >= document.project.startDate && today < document.project.endDateExclusive ? today : document.project.startDate;
  const [width, setWidth] = useState(960);
  const [camera, setCamera] = useState<TimelineCamera>(() => cameraForFocusDate({ originDate: document.project.startDate, pxPerDay: WORK_ZOOM, panX: 0 }, initialFocus, 960, 0.32));
  const [step, setStep] = useState<GridStep>('1w');
  const [weekends, setWeekends] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<ProcessId>>(() => new Set(document.viewPreferences.expandedProcessIds));
  const [selection, setSelection] = useState<Selection | null>(() => document.processes[0] ? { kind: 'process', id: document.processes[0].id } : null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editingStage, setEditingStage] = useState<StageMarkerId | null>(null);
  const gesture = useTimelineGesture({ document, camera, step, surface, body, setCamera, onCommit, onError: setError, onStageClick: setEditingStage });
  const sceneDocument = gesture.preview ?? document;
  const layout = layoutTimeline(sceneDocument, expanded);
  const bodyHeight = Math.max(460, layout.height);
  const calendar = getCalendarGeometry(getVisibleDateRange(width, camera), step);
  const activeStage = sceneDocument.stageMarkers.find((stage) => stage.id === editingStage);

  useEffect(() => {
    const element = timeViewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setWidth(entry.contentRect.width);
      if (!initialized.current) {
        setCamera((previous) => cameraForFocusDate(previous, initialFocus, entry.contentRect.width, 0.32, WORK_ZOOM));
        initialized.current = true;
      }
    });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [initialFocus]);

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
  const startBar: typeof gesture.startBar = (event, target, action) => { if (event.button === 0) select(target); setEditingStage(null); gesture.startBar(event, target, action); };
  const applyStageDate = (value: string): string | null => {
    if (!activeStage) return 'Граница не найдена.';
    const parsed = dateOnlySchema.safeParse(value);
    if (!parsed.success) return 'Введите корректную календарную дату.';
    const result = applyTimelineCommand(document, { type: 'stage', id: activeStage.id, date: parsed.data });
    if (!result.ok) return result.error;
    onCommit(result.document); setEditingStage(null); setError('');
    return null;
  };
  const selectedItem = selection?.kind === 'process' ? sceneDocument.processes.find((item) => item.id === selection.id) : sceneDocument.tasks.find((item) => item.id === selection?.id);
  return <main className="timeline-workspace" aria-label="Редактор таймлайна" data-project-revision={document.project.revision} data-px-per-day={camera.pxPerDay} data-pan-x={camera.panX}>
    <div className={`timeline-surface ${gesture.active ? `gesture-${gesture.active}` : ''} ${gesture.invalid ? 'invalid-gesture' : ''}`} ref={surface}
      onPointerDown={gesture.startPan} onPointerMove={gesture.onPointerMove} onPointerUp={gesture.onPointerUp} onPointerCancel={gesture.onPointerCancel} onLostPointerCapture={gesture.onLostPointerCapture}>
      <div className="calendar-row"><div className="calendar-gutter section-gutter" data-interactive><strong>Календарь</strong><span>{visibleYears(calendar.range)}</span></div>
        <div className="calendar-time" ref={timeViewport}><CalendarRuler camera={camera} width={width} calendar={calendar} today={today} /></div>
      </div>
      <div className="stage-row"><div className="section-gutter stage-gutter" data-interactive>Этапы</div>
        <StageBand document={sceneDocument} camera={camera} width={width} calendar={calendar} weekends={weekends} today={today} onStart={gesture.startStage} onEdit={setEditingStage} />
      </div>
      <div className="timeline-body" ref={body} aria-label="Производственный план">
        <div className="timeline-body-layout" style={{ height: bodyHeight }}>
        <div className="section-gutter production-gutter" data-interactive><div><strong>Процессы</strong><small>{document.processes.length} процессов · {document.tasks.length} задачи</small></div></div>
        <div className="timeline-canvas" style={{ height: bodyHeight }}>
          <TimeGrid camera={camera} width={width} height={bodyHeight} calendar={calendar} weekends={weekends} />
          {layout.rows.map((row) => <div key={`${row.id}:${row.processId ?? ''}`} className="lane-divider" style={{ top: row.y + 30 }} />)}
          {layout.groups.map((group) => {
            const process = sceneDocument.processes.find((item) => item.id === group.processId);
            return process ? <div className="process-container" key={group.processId} style={{ left: xForDate(process.startDate, camera), width: widthForInterval(process, camera), top: group.y - 3, height: group.height, borderColor: `${process.color}55`, backgroundColor: `${process.color}09` }} /> : null;
          })}
          <DateLines document={sceneDocument} camera={camera} today={today} height={bodyHeight} />
          {layout.rows.flatMap((row) => {
            if (row.kind === 'process') return sceneDocument.processes.filter((item) => item.laneId === row.id).map((process) => <TimelineBar key={process.id} item={process} target={{ kind: 'process', id: process.id }} camera={camera} viewportWidth={width} y={row.y} color={process.color}
              selected={selection?.id === process.id} highlighted={hovered === process.id} expanded={expanded.has(process.id)} toggle={() => { toggle(process.id); }} onSelect={select} onRename={rename} onHover={setHovered} onGesture={startBar} />);
            return sceneDocument.tasks.filter((item) => item.laneId === row.id).map((task) => {
              const process = sceneDocument.processes.find((item) => item.id === task.processId);
              return <TimelineBar key={task.id} item={task} target={{ kind: 'task', id: task.id }} camera={camera} viewportWidth={width} y={row.y} color={process?.color ?? '#888888'}
                selected={selection?.id === task.id} highlighted={hovered === task.id} expanded={false} toggle={undefined} onSelect={select} onRename={rename} onHover={setHovered} onGesture={startBar} />;
            });
          })}
        </div>
        </div>
      </div>
      <PerformersSection document={sceneDocument} camera={camera} width={width} calendar={calendar} weekends={weekends} today={today} hovered={hovered} onHover={setHovered} />
      <div className="toolbar-dock" data-interactive>
        <div className="floating-toolbar" role="toolbar" aria-label="Вид таймлайна">
          <button aria-label="Уменьшить масштаб" onClick={() => { setCamera((previous) => zoomCamera(previous, 1 / 1.25, width / 2)); }}>−</button>
          <output aria-label="Масштаб">{Math.round(camera.pxPerDay * 100 / WORK_ZOOM)}%</output>
          <button aria-label="Увеличить масштаб" onClick={() => { setCamera((previous) => zoomCamera(previous, 1.25, width / 2)); }}>+</button>
          <span className="toolbar-separator" />
          <label htmlFor="grid-step">Шаг</label><select id="grid-step" value={step} onChange={(event) => { setStep(gridStepSchema.parse(event.target.value)); }}>
            <option value="1d">1 день</option><option value="2d">2 дня</option><option value="3d">3 дня</option><option value="1w">Неделя</option><option value="2w">2 недели</option><option value="1mo">Месяц</option>
          </select>
          <span className="toolbar-separator" /><button className="weekend-button" aria-pressed={weekends} onClick={() => { setWeekends((previous) => !previous); }}><i />Выходные</button>
          <span className="toolbar-separator" /><button className="navigation-button" onClick={() => { setCamera((previous) => cameraForFocusDate(previous, today, width, 0.5, Math.max(WORK_ZOOM, previous.pxPerDay))); }}>Сегодня</button>
          <button className="navigation-button" onClick={() => { setCamera((previous) => cameraForFitRange(previous, scheduleRange(document), width)); }}>Весь проект</button>
        </div>
        <span className="gesture-hint">Фон — панорама · ⠿ — перенос · Esc — отмена</span>
      </div>
      {error && <div className="timeline-error" role="alert" data-interactive>{error}<button aria-label="Закрыть сообщение" onClick={() => { setError(''); }}>×</button></div>}
      {activeStage && <StageDateEditor key={`${activeStage.id}:${activeStage.date}`} stage={activeStage} left={Math.max(8, Math.min(xForDate(activeStage.date, camera), width - 272))} onApply={applyStageDate} onClose={() => { setEditingStage(null); }} />}
    </div>
    <DetailsInspector key={`${selection?.id ?? 'none'}:${selectedItem?.title ?? ''}`} document={sceneDocument} selection={selection} onRename={rename} />
  </main>;
}
