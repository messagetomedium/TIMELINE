import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { addDays, daysBetween, gridStepSchema } from '../../domain';
import type { ProjectDocument, ProjectId } from '../../domain';
import { getCalendarGeometry, visibleYears } from '../../domain/calendar';
import { cameraForFitRange, cameraForFocusDate, getVisibleDateRange, snapDate, widthForInterval, WORK_ZOOM, xForDate, zoomCamera } from '../../domain/timeline';
import type { TimelineCamera } from '../../domain/timeline';
import { allProjectsRange, portfolioRange, projectColor } from '../../application/workspace/portfolio';
import { shiftProject } from '../../application/workspace/projectOperations';
import type { PortfolioPreferences } from '../../application/workspace/model';
import { CalendarRuler, TimeGrid } from '../timeline/CalendarLayers';
import { useLocalToday } from '../timeline/useLocalToday';
import { formatDate } from './formatDate';
import { ProjectActions } from './ProjectActions';
import type { ProjectActionProps } from './ProjectActions';

interface PortfolioProps extends ProjectActionProps {
  readonly documents: readonly ProjectDocument[];
  readonly preferences: PortfolioPreferences;
  readonly onPreferences: (preferences: PortfolioPreferences) => void;
  readonly onOpen: (id: ProjectId) => void;
  readonly onReorder?: ((ids: string[]) => void) | undefined;
  readonly onShift: (id: ProjectId, days: number, revision: number) => void;
}
interface Gesture {
  readonly pointerId: number; readonly x: number; readonly y: number; readonly scrollTop: number;
  readonly camera: TimelineCamera; readonly document: ProjectDocument | null;
  delta: number; cameraPreview: TimelineCamera | null;
}

export function PortfolioTimeline({ documents, preferences, onPreferences, onOpen, onShift, onReorder, ...actions }: PortfolioProps) {
  const rowDrag = useRef<{ pointer: number; y: number; from: number; to: number; ids: string[] } | null>(null);
  const [rowOrder, setRowOrder] = useState<string[] | null>(null);
  const byId = new Map<string, ProjectDocument>(documents.map((d) => [d.project.id, d]));
  const rows = rowOrder ? rowOrder.flatMap((id) => { const d = byId.get(id); return d ? [d] : []; }) : documents;
  const today = useLocalToday();
  const range = allProjectsRange(documents);
  const focus = range && (today < range.startDate || today >= range.endDateExclusive) ? range.startDate : today;
  const surface = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const bodyDown = useRef<{ x: number; y: number } | null>(null);
  const suppressOpen = useRef(false);
  const [width, setWidth] = useState(1000);
  const [previewCamera, setPreviewCamera] = useState<TimelineCamera | null>(null);
  const [previewDocument, setPreviewDocument] = useState<ProjectDocument | null>(null);
  const [hint, setHint] = useState('');
  const camera = previewCamera ?? preferences.camera ?? cameraForFocusDate({ originDate: focus, pxPerDay: WORK_ZOOM, panX: 0 }, focus, width, 0.32);
  const calendar = getCalendarGeometry(getVisibleDateRange(width, camera), preferences.step);
  const height = Math.max(360, documents.length * 64 + 64);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setWidth(entry.contentRect.width);
      if (!initialized.current) {
        initialized.current = true;
        if (!preferences.camera) onPreferences({ ...preferences, camera: cameraForFocusDate({ originDate: focus, pxPerDay: WORK_ZOOM, panX: 0 }, focus, entry.contentRect.width, 0.32) });
      }
    });
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [focus, preferences, onPreferences]);

  const cancel = useCallback(() => {
    const orderGesture = rowDrag.current;
    rowDrag.current = null; setRowOrder(null);
    if (orderGesture && surface.current?.hasPointerCapture(orderGesture.pointer)) surface.current.releasePointerCapture(orderGesture.pointer);
    const current = gesture.current;
    gesture.current = null;
    if (current && !current.document && body.current) body.current.scrollTop = current.scrollTop;
    setPreviewDocument(null); setPreviewCamera(null); setHint('');
    if (current && surface.current?.hasPointerCapture(current.pointerId)) surface.current.releasePointerCapture(current.pointerId);
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('keydown', escape); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel); };
  }, [cancel]);

  const begin = (event: PointerEvent, document: ProjectDocument | null) => {
    if (gesture.current || (document && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation();
    if (document) suppressOpen.current = true;
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollTop: body.current?.scrollTop ?? 0, camera, document, delta: 0, cameraPreview: null };
    surface.current?.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    const orderGesture = rowDrag.current;
    if (orderGesture && orderGesture.pointer === event.pointerId) {
      const to = Math.max(0, Math.min(documents.length - 1, orderGesture.from + Math.round((event.clientY - orderGesture.y) / 64)));
      const ids = [...orderGesture.ids]; const [moved] = ids.splice(orderGesture.from, 1);
      if (moved) ids.splice(to, 0, moved);
      orderGesture.to = to; setRowOrder(ids); return;
    }
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.x;
    if (!current.document) {
      current.cameraPreview = { ...current.camera, panX: current.camera.panX + dx };
      setPreviewCamera(current.cameraPreview);
      if (body.current) body.current.scrollTop = current.scrollTop - (event.clientY - current.y);
    } else if (Math.abs(dx) >= 3) {
      try {
        const start = portfolioRange(current.document).startDate;
        const target = snapDate(addDays(start, Math.round(dx / current.camera.pxPerDay)), preferences.step);
        current.delta = daysBetween(start, target);
        const shifted = shiftProject(current.document, current.delta);
        setPreviewDocument(shifted);
        setHint(`${current.delta >= 0 ? '+' : ''}${String(current.delta)} дн. · ${formatDate(shifted.project.startDate)}`);
      } catch { current.delta = 0; setPreviewDocument(null); setHint('Перенос за пределы календаря невозможен.'); }
    }
  };
  const finish = (event: PointerEvent) => {
    const orderGesture = rowDrag.current;
    if (orderGesture && orderGesture.pointer === event.pointerId) {
      const ids = [...orderGesture.ids]; const [moved] = ids.splice(orderGesture.from, 1);
      if (moved) ids.splice(orderGesture.to, 0, moved);
      if (orderGesture.to !== orderGesture.from) onReorder?.(ids);
      cancel(); return;
    }
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (current.document && current.delta !== 0) onShift(current.document.project.id, current.delta, current.document.project.revision);
    else if (current.cameraPreview) onPreferences({ ...preferences, camera: current.cameraPreview });
    cancel();
    if (surface.current?.hasPointerCapture(event.pointerId)) surface.current.releasePointerCapture(event.pointerId);
  };
  const setCamera = (next: TimelineCamera) => { onPreferences({ ...preferences, camera: next }); };
  return <section className="portfolio timeline-surface" aria-label="Общий таймлайн проектов" ref={surface} data-px-per-day={camera.pxPerDay} data-pan-x={camera.panX}
    onPointerDown={(event) => { const target = event.target; if (event.button === 1 || (event.button === 0 && target instanceof Element && !target.closest('[data-interactive]'))) begin(event, null); }}
    onPointerMove={onPointerMove} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}>
    <div className="calendar-row"><div className="calendar-gutter section-gutter" data-interactive><strong>Название проекта</strong><span>{visibleYears(calendar.range)}</span></div><div className="calendar-time" ref={viewport}><CalendarRuler camera={camera} width={width} calendar={calendar} today={today} /></div></div>
    <div className="portfolio-body" ref={body}><div className="portfolio-grid" style={{ height }}>
      <div className="portfolio-background"><TimeGrid camera={camera} width={width} height={height} calendar={calendar} weekends={preferences.showWeekends} /><div className="portfolio-today today-line" data-today={today} style={{ left: xForDate(today, camera) }}><span>Сегодня</span></div></div>
      {rows.map((original, index) => {
        const document = previewDocument?.project.id === original.project.id ? previewDocument : original;
        const dates = portfolioRange(document);
        const left = xForDate(dates.startDate, camera);
        const barWidth = widthForInterval(dates, camera);
        const visibleInset = left < width && left + barWidth > 0 ? Math.max(0, -left) : 0;
        return <div className="portfolio-row" key={document.project.id} data-project-id={document.project.id} style={{ top: 20 + index * 64 }}>
          <div className="portfolio-name" data-interactive>{onReorder && <button className="portfolio-order-handle" aria-label={`Изменить порядок проекта: ${document.project.name}`} onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault(); event.stopPropagation();
            rowDrag.current = { pointer: event.pointerId, y: event.clientY, from: index, to: index, ids: rows.map((d) => d.project.id) };
            surface.current?.setPointerCapture(event.pointerId);
          }} onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const to = index + (event.key === 'ArrowUp' ? -1 : 1);
            if (to < 0 || to >= rows.length) return;
            const ids = rows.map((d) => d.project.id); const [moved] = ids.splice(index,1);
            if (moved) ids.splice(to,0,moved); onReorder(ids);
          }}>↕</button>}<button className="portfolio-open-name" onClick={() => { onOpen(document.project.id); }} title={document.project.name}>{document.project.name}</button><ProjectActions document={original} {...actions} /></div>
          <div className="portfolio-track"><div className={`portfolio-bar ${previewDocument?.project.id === document.project.id ? 'preview' : ''}`} role="button" tabIndex={0} data-interactive data-start={dates.startDate} data-end={dates.endDateExclusive}
            data-revision={original.project.revision} aria-label={`Проект: ${document.project.name}`} title={`${document.project.name} · ${formatDate(dates.startDate)} — ${formatDate(addDays(dates.endDateExclusive, -1))}`}
            style={{ left, width: barWidth, '--bar-color': projectColor(document.project.id) } as CSSProperties}
            onPointerDown={(event) => { if (event.button === 0) { suppressOpen.current = false; bodyDown.current = { x: event.clientX, y: event.clientY }; } }}
            onClick={(event) => { if (suppressOpen.current) return; const down = bodyDown.current; if (!down || Math.abs(event.clientX - down.x) + Math.abs(event.clientY - down.y) < 4) onOpen(document.project.id); bodyDown.current = null; }}
            onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(document.project.id); } }}>
            <button className="portfolio-move-handle" style={{ left: visibleInset + 8 }} aria-label={`Переместить проект: ${document.project.name}`} onClick={(event) => { event.stopPropagation(); }} onPointerDown={(event) => { begin(event, original); }}>⠿</button>
            <span style={{ paddingLeft: visibleInset + 30 }}>{document.project.name}</span>
          </div></div>
        </div>;
      })}
    </div></div>
    <div className="toolbar-dock" data-interactive><div className="floating-toolbar" role="toolbar" aria-label="Вид портфеля">
      <button aria-label="Уменьшить масштаб портфеля" onClick={() => { setCamera(zoomCamera(camera, 1 / 1.25, width / 2)); }}>−</button><output>{Math.round(camera.pxPerDay * 100 / WORK_ZOOM)}%</output><button aria-label="Увеличить масштаб портфеля" onClick={() => { setCamera(zoomCamera(camera, 1.25, width / 2)); }}>+</button>
      <span className="toolbar-separator" /><label htmlFor="portfolio-step">Шаг</label><select id="portfolio-step" value={preferences.step} onChange={(event) => { onPreferences({ ...preferences, step: gridStepSchema.parse(event.target.value) }); }}><option value="1d">1 день</option><option value="2d">2 дня</option><option value="3d">3 дня</option><option value="1w">Неделя</option><option value="2w">2 недели</option><option value="1mo">Месяц</option></select>
      <span className="toolbar-separator" /><button className="weekend-button" aria-pressed={preferences.showWeekends} onClick={() => { onPreferences({ ...preferences, showWeekends: !preferences.showWeekends }); }}><i />Выходные</button>
      <span className="toolbar-separator" /><button className="navigation-button" onClick={() => { setCamera(cameraForFocusDate(camera, today, width, 0.5, Math.max(WORK_ZOOM, camera.pxPerDay))); }}>Сегодня</button><button className="navigation-button" onClick={() => { if (range) setCamera(cameraForFitRange(camera, range, width)); }}>Все проекты</button>
    </div><span className="gesture-hint">Пустой фон — панорама · ⠿ — перенос всего проекта · Esc — отмена</span></div>
    {hint && <output className="portfolio-preview-hint">{hint}</output>}
  </section>;
}
