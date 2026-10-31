import { selectWork } from '../../application/v2/workSelection';
import type { WorkSelection } from '../../application/v2/workSelection';
import { processIdSchema, taskIdSchema } from '../../domain';
import { groupDrop } from './groupDrop';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { Snapshot } from '../../domain/v2/model';
import type { PreviewResult } from './useTimelineGesture';
import type { ReactNode } from 'react';
import type { GestureCommand } from '../../domain/v2/gesture';
import { withGaps } from '../../domain/SegmentAxis';
import type { ResultGap } from '../../domain/SegmentAxis';
import { dateOnlySchema, gridStepSchema, daysBetween } from '../../domain';
import type { GridStep, ProcessId, ProjectDocument, ProjectId, StageMarkerId, ViewPreferences } from '../../domain';
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
import { CreateWorkDialog } from './CreateWorkDialog';
import type { WorkInput } from '../../application/workspace/projectOperations';
import '../../styles/timeline.css';

export interface FoundationUI {
  snapshot:Snapshot;
  onCreate:(kind:'process'|'task',parent:string|null)=>void;
  inspectorCollapsed:boolean;
  onToggleInspector:()=>void;
  layout: typeof layoutTimeline;
  evaluate: (document: ProjectDocument, command: GestureCommand) => PreviewResult;
  onCommand: (command: GestureCommand, revision: number) => void;
  onSelect: () => void;
  onStageSelect: (id: StageMarkerId) => void;
  inspector: (selection: Selection | null, scene: Snapshot | undefined, count:number) => ReactNode;
  stages: (camera: TimelineCamera, width: number, scene: Snapshot | undefined, start: (event: PointerEvent, id: StageMarkerId) => void) => ReactNode;
  checkpoints: (camera: TimelineCamera, scene: Snapshot | undefined, start:(e:PointerEvent,id:string,date:import('../../domain').DateOnly)=>void) => ReactNode;
  gaps: (scene:Snapshot|undefined)=>readonly ResultGap[];
  results: (camera:TimelineCamera,scene:Snapshot|undefined,layout:ReturnType<typeof layoutTimeline>)=>ReactNode;
  resultsHeight: (scene:Snapshot|undefined,layout:ReturnType<typeof layoutTimeline>)=>number;
  onRename: (target:Selection,title:string)=>void;
  toolbar: ReactNode;
}
interface Props {
  readonly foundation?: FoundationUI;
  readonly document: ProjectDocument;
  readonly onCommit: (document: ProjectDocument) => void;
  readonly initialView: ViewPreferences | undefined;
  readonly onViewChange: (id: ProjectId, view: ViewPreferences) => void;
  readonly onCreateWork: (id: ProjectId, kind: 'process' | 'task', input: WorkInput, parent: ProcessId | null) => Promise<ProjectDocument | null>;
}

export function TimelineWorkspace({ document, onCommit, initialView, onViewChange, onCreateWork, foundation }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const timeViewport = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const today = useLocalToday();
  const initialFocus = today >= document.project.startDate && today < document.project.endDateExclusive ? today : document.project.startDate;
  const [width, setWidth] = useState(960);
  const [storedCamera, setCamera] = useState<TimelineCamera>(() => initialView ? { originDate: document.project.startDate, pxPerDay: initialView.zoomPxPerDay, panX: initialView.cameraX } : cameraForFocusDate({ originDate: document.project.startDate, pxPerDay: WORK_ZOOM, panX: 0 }, initialFocus, 960, 0.32));
  const [showResults,setShowResults] = useState(initialView?.showResults ?? false);
  const camera:TimelineCamera={...storedCamera,gaps:showResults?foundation?.gaps(undefined)??[]:[]};
  const [step, setStep] = useState<GridStep>(initialView?.gridStep ?? '1w');
  const [weekends, setWeekends] = useState(initialView?.showWeekends ?? true);
  const [expanded, setExpanded] = useState<ReadonlySet<ProcessId>>(() => new Set(initialView?.expandedProcessIds ?? document.viewPreferences.expandedProcessIds));
  const [viewReady, setViewReady] = useState(false);
  const [scrollY, setScrollY] = useState(initialView?.cameraY ?? 0);
  const [retainedView] = useState(() => ({ expandedAssigneeGroupIds: initialView?.expandedAssigneeGroupIds ?? document.viewPreferences.expandedAssigneeGroupIds, showPeoplePanel: initialView?.showPeoplePanel ?? document.viewPreferences.showPeoplePanel }));
  const [creating, setCreating] = useState<'process' | 'task' | null>(null);
  const [selection, setSelection] = useState<Selection | null>(() => document.processes[0] ? { kind: 'process', id: document.processes[0].id } : null);
  const [multi,setMulti]=useState<WorkSelection|null>(()=>document.processes[0]?{kind:'process',ids:[document.processes[0].id],anchor:document.processes[0].id}:null);
  const validMulti=multi?{...multi,ids:multi.ids.filter(id=>(multi.kind==='process'?document.processes:document.tasks).some(x=>x.id===id))}:null;
  const [hovered, setHovered] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editingStage, setEditingStage] = useState<StageMarkerId | null>(null);
  const gesture = useTimelineGesture({ document, camera, step, surface, body, setCamera, onCommit, onError: setError, onStageClick: foundation?.onStageSelect ?? setEditingStage, evaluate: foundation?.evaluate, onCommand: foundation ? (command,revision)=>{if(command.type==='GroupMove'&&command.kind==='task'&&command.destination)setExpanded(old=>new Set([...old,processIdSchema.parse(command.destination?.parentId)]));foundation.onCommand(command,revision);} : undefined,
    stack:foundation?(d,drop)=>groupDrop(foundation.snapshot,d,foundation.layout,expanded,drop):undefined });
  const sceneDocument = gesture.preview ?? document;
  const sceneExpanded=gesture.command?.type==='GroupMove'&&gesture.command.kind==='task'&&gesture.command.destination?new Set([...expanded,processIdSchema.parse(gesture.command.destination.parentId)]):expanded;
  const layout = (foundation?.layout ?? layoutTimeline)(sceneDocument, sceneExpanded);
  const sceneCamera:TimelineCamera={...camera,gaps:showResults?foundation?.gaps(gesture.snapshot)??[]:[]};
  const bodyHeight = Math.max(460, layout.height,showResults?foundation?.resultsHeight(gesture.snapshot,layout)??0:0);
  const calendar = getCalendarGeometry(getVisibleDateRange(width, sceneCamera), step);
  const activeStage = sceneDocument.stageMarkers.find((stage) => stage.id === editingStage);

  useEffect(() => {
    const element = timeViewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setWidth(entry.contentRect.width);
      if (!initialized.current) {
        if (!initialView) setCamera((previous) => cameraForFocusDate(previous, initialFocus, entry.contentRect.width, 0.32, WORK_ZOOM));
        if (body.current && initialView) body.current.scrollTop = initialView.cameraY;
        initialized.current = true;
        setViewReady(true);
      }
    });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [initialFocus, initialView]);

  const processKeys = document.processes.map(p => p.id).join(',');
  useEffect(() => {
    const validIds = new Set(processKeys.split(','));
    if (viewReady && !gesture.active) onViewChange(document.project.id, {
      projectId: document.project.id, gridStep: step, zoomPxPerDay: camera.pxPerDay, cameraX: camera.panX + daysBetween(camera.originDate, document.project.startDate) * camera.pxPerDay, cameraY: scrollY,
      showWeekends: weekends, showResults, expandedProcessIds: [...expanded].filter(id => validIds.has(id)), ...retainedView,
    });
  }, [viewReady, gesture.active, document.project.id, document.project.startDate, processKeys, step, camera.originDate, camera.panX, camera.pxPerDay, scrollY, weekends, showResults, expanded, retainedView, onViewChange]);

  const select = (target:Selection,modifiers?:{ctrlKey:boolean;metaKey:boolean;shiftKey:boolean}) => {
    if(foundation){try{const next=selectWork(foundation.snapshot,validMulti?.ids.length?validMulti:null,target.kind,target.id,modifiers?.shiftKey?'range':modifiers?.ctrlKey||modifiers?.metaKey?'toggle':'plain');setMulti(next);const id=next?.ids.includes(target.id)?target.id:next?.ids.at(-1);setSelection(id?(target.kind==='process'?{kind:'process',id:processIdSchema.parse(id)}:{kind:'task',id:taskIdSchema.parse(id)}):null);setError('');}catch(e){setError(e instanceof Error?e.message:'Выбор недоступен');return;}}
    else setSelection(target);
    foundation?.onSelect();
    if(target.kind==='process')setExpanded(old=>new Set([...old,target.id]));
  };
  const toggle = (id: ProcessId) => {
    setExpanded((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const rename = (target: Selection, title: string) => {
    if(foundation) {foundation.onRename(target,title);return;}
    const result = applyTimelineCommand(document, { type: 'rename', target, title });
    if (result.ok) { onCommit(result.document); setError(''); } else setError(result.error);
  };
  const startBar: typeof gesture.startBar = (event, target, action) => { const ids=action==='move'&&validMulti?.kind===target.kind&&validMulti.ids.includes(target.id)?validMulti.ids:[target.id];if(event.button===0&&ids.length===1)select(target);setEditingStage(null);gesture.startBar(event,target,action,ids); };
  const applyStageDate = (value: string): string | null => {
    if (!activeStage) return 'Граница не найдена.';
    const parsed = dateOnlySchema.safeParse(value);
    if (!parsed.success) return 'Введите корректную календарную дату.';
    const result = (foundation?.evaluate ?? applyTimelineCommand)(document, { type: 'stage', id: activeStage.id, date: parsed.data });
    if (!result.ok) return result.error;
    onCommit(result.document); setEditingStage(null); setError('');
    return null;
  };
  const selectedItem = selection?.kind === 'process' ? sceneDocument.processes.find((item) => item.id === selection.id) : sceneDocument.tasks.find((item) => item.id === selection?.id);
  const activeProcess = selection?.kind === 'process' ? document.processes.find((item) => item.id === selection.id) : document.processes.find((item) => 'processId' in (selectedItem ?? {}) && selectedItem && 'processId' in selectedItem && item.id === selectedItem.processId) ?? document.processes[0];
  return <main className={`timeline-workspace ${foundation?.inspectorCollapsed?'inspector-collapsed':''}`} aria-label="Редактор таймлайна" data-project-revision={document.project.revision} data-px-per-day={camera.pxPerDay} data-pan-x={camera.panX}>
    <div className={`timeline-surface ${gesture.active ? `gesture-${gesture.active}` : ''} ${gesture.invalid ? 'invalid-gesture' : ''}`} ref={surface}
      onPointerDown={gesture.startPan} onPointerMove={gesture.onPointerMove} onPointerUp={gesture.onPointerUp} onPointerCancel={gesture.onPointerCancel} onLostPointerCapture={gesture.onLostPointerCapture}>
      <div className="calendar-row"><div className="calendar-gutter section-gutter" data-interactive><strong>Календарь</strong><span>{visibleYears(calendar.range)}</span></div>
        <div className="calendar-time" ref={timeViewport}><CalendarRuler camera={sceneCamera} width={width} calendar={calendar} today={today} /></div>
      </div>
      <div className="stage-row"><div className="section-gutter stage-gutter" data-interactive>Этапы</div>
        {foundation ? foundation.stages(sceneCamera, width, gesture.snapshot, gesture.startStage) : <StageBand document={sceneDocument} camera={sceneCamera} width={width} calendar={calendar} weekends={weekends} today={today} onStart={gesture.startStage} onEdit={setEditingStage} />}
      </div>
      <div className="timeline-body" ref={body} aria-label="Производственный план" onScroll={(event) => { setScrollY(event.currentTarget.scrollTop); }}>
        <div className="timeline-body-layout" style={{ height: bodyHeight }}>
        <div className="section-gutter production-gutter" data-interactive><div><strong>Процессы</strong><small>{document.processes.length} процессов · {document.tasks.length} задачи</small><button className="add-work-button" onClick={() => { if(foundation)foundation.onCreate('process',activeProcess?.id??null);else setCreating('process'); }}>+ Процесс</button>{activeProcess && <button className="add-work-button" onClick={() => { if(foundation)foundation.onCreate('task',activeProcess.id);else setCreating('task'); }}>+ Задача</button>}</div></div>
        <div className="timeline-canvas" style={{ height: bodyHeight }}>
          {showResults && foundation?.results(sceneCamera,gesture.snapshot,layout)}
          <TimeGrid camera={sceneCamera} width={width} height={bodyHeight} calendar={calendar} weekends={weekends} />
          {document.processes.length === 0 && <div className="empty-editor-note" data-interactive><h2>Чистый лист</h2><p>{foundation ? 'Выберите этап, чтобы настроить план.' : 'Календарь готов. Добавьте первый процесс кнопкой «+ Процесс» слева.'}</p></div>}
          {layout.rows.map((row) => <div key={`${row.id}:${row.processId ?? ''}`} className="lane-divider" style={{ top: row.y + 30 }} />)}
          {layout.groups.map((group) => {
            const process = sceneDocument.processes.find((item) => item.id === group.processId);
            return process ? <div className="process-container" key={group.processId} style={{ left: xForDate(process.startDate, sceneCamera), width: widthForInterval(process, sceneCamera), top: group.y - 3, height: group.height, borderColor: `${process.color}55`, backgroundColor: `${process.color}09` }} /> : null;
          })}
          <DateLines document={sceneDocument} camera={sceneCamera} today={today} height={bodyHeight} />
          {foundation?.checkpoints(sceneCamera, gesture.snapshot, gesture.startCheckpoint)}
          {layout.rows.flatMap((row) => {
            if (row.kind === 'process') return sceneDocument.processes.filter((item) => item.laneId === row.id).map((process) => <TimelineBar key={process.id} item={process} target={{ kind: 'process', id: process.id }} camera={sceneCamera} viewportWidth={width} y={row.y} color={process.color}
              selected={validMulti?.kind==='process'?validMulti.ids.includes(process.id):selection?.id===process.id} highlighted={hovered === process.id || gesture.affectedIds.includes(process.id)} expanded={sceneExpanded.has(process.id)} toggle={() => { toggle(process.id); }} onSelect={select} onRename={rename} onHover={setHovered} onGesture={startBar} />);
            return sceneDocument.tasks.filter((item) => item.laneId === row.id).map((task) => {
              const process = sceneDocument.processes.find((item) => item.id === task.processId);
              return <TimelineBar key={task.id} item={task} target={{ kind: 'task', id: task.id }} camera={sceneCamera} viewportWidth={width} y={row.y} color={process?.color ?? '#888888'}
                selected={validMulti?.kind==='task'?validMulti.ids.includes(task.id):selection?.id===task.id} highlighted={hovered === task.id || gesture.affectedIds.includes(task.id)} expanded={false} toggle={undefined} onSelect={select} onRename={rename} onHover={setHovered} onGesture={startBar} />;
            });
          })}
        </div>
        </div>
      </div>
      <PerformersSection document={sceneDocument} camera={sceneCamera} width={width} calendar={calendar} weekends={weekends} today={today} hovered={hovered} onHover={setHovered} />
      <div className="toolbar-dock" data-interactive>
        <div className="floating-toolbar" role="toolbar" aria-label="Вид таймлайна">
          {foundation?.toolbar}{validMulti&&validMulti.ids.length>1&&<output className="selection-count" aria-label="Выбрано работ">{validMulti.ids.length}</output>}
          {foundation && <button className="navigation-button" aria-pressed={showResults} onClick={()=>{setCamera(withGaps(camera,showResults?[]:foundation.gaps(undefined),width/2));setShowResults(!showResults);}}>Результаты</button>}
          <button aria-label="Уменьшить масштаб" onClick={() => { setCamera((previous) => zoomCamera({...previous,gaps:camera.gaps??[]}, 1 / 1.25, width / 2)); }}>−</button>
          <output aria-label="Масштаб">{Math.round(camera.pxPerDay * 100 / WORK_ZOOM)}%</output>
          <button aria-label="Увеличить масштаб" onClick={() => { setCamera((previous) => zoomCamera({...previous,gaps:camera.gaps??[]}, 1.25, width / 2)); }}>+</button>
          <span className="toolbar-separator" />
          <label htmlFor="grid-step">Шаг</label><select id="grid-step" value={step} onChange={(event) => { setStep(gridStepSchema.parse(event.target.value)); }}>
            <option value="1d">1 день</option><option value="2d">2 дня</option><option value="3d">3 дня</option><option value="1w">Неделя</option><option value="2w">2 недели</option><option value="1mo">Месяц</option>
          </select>
          <span className="toolbar-separator" /><button className="weekend-button" aria-pressed={weekends} onClick={() => { setWeekends((previous) => !previous); }}><i />Выходные</button>
          <span className="toolbar-separator" /><button className="navigation-button" onClick={() => { setCamera((previous) => cameraForFocusDate({...previous,gaps:camera.gaps??[]}, today, width, 0.5, Math.max(WORK_ZOOM, previous.pxPerDay))); }}>Сегодня</button>
          <button className="navigation-button" onClick={() => { setCamera((previous) => cameraForFitRange({...previous,gaps:camera.gaps??[]}, scheduleRange(document), width)); }}>Весь проект</button>
        </div>
        <span className="gesture-hint">Фон — панорама · ⠿ — перенос · Esc — отмена</span>
      </div>
      {error && <div className="timeline-error" role="alert" data-interactive>{error}<button aria-label="Закрыть сообщение" onClick={() => { setError(''); }}>×</button></div>}
      {activeStage && <StageDateEditor key={`${activeStage.id}:${activeStage.date}`} stage={activeStage} left={Math.max(8, Math.min(xForDate(activeStage.date, camera), width - 272))} onApply={applyStageDate} onClose={() => { setEditingStage(null); }} />}
    </div>
    {foundation ? <section className="inspector-dock"><button className="inspector-toggle" aria-label={foundation.inspectorCollapsed?'Развернуть свойства':'Свернуть свойства'} aria-expanded={!foundation.inspectorCollapsed} onClick={foundation.onToggleInspector}>{foundation.inspectorCollapsed?'‹':'›'}</button><div className="inspector-content" inert={foundation.inspectorCollapsed} aria-hidden={foundation.inspectorCollapsed}>{foundation.inspector(selection,gesture.snapshot,validMulti?.ids.length??0)}</div></section> : <DetailsInspector key={`${selection?.id ?? 'none'}:${selectedItem?.title ?? ''}`} document={sceneDocument} selection={selection} onRename={rename} />}
    {creating && <CreateWorkDialog document={document} kind={creating} parentId={creating === 'task' ? activeProcess?.id ?? null : null} onClose={() => { setCreating(null); }} onSubmit={async (input) => {
      const result = await onCreateWork(document.project.id, creating, input, creating === 'task' ? activeProcess?.id ?? null : null);
      if (!result) return false;
      if (creating === 'process') { const added = result.processes.find((item) => !document.processes.some((before) => before.id === item.id)); if (added) select({ kind: 'process', id: added.id }); }
      else if (activeProcess) setExpanded((previous) => new Set([...previous, activeProcess.id]));
      return true;
    }} />}
  </main>;
}
