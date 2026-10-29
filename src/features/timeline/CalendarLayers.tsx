import type { PointerEvent } from 'react';
import { addDays, addMonths, dateOnly, daysBetween } from '../../domain';
import type { DateOnly, GridStep, ProjectDocument, StageMarkerId } from '../../domain';
import { dateAtX, gridDates, isWeekend, xForDate } from '../../domain/timeline';
import type { TimelineCamera } from '../../domain/timeline';

const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const dayLabels = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export function CalendarRuler({ camera, width, step }: { readonly camera: TimelineCamera; readonly width: number; readonly step: GridStep }) {
  const months: DateOnly[] = [];
  let current = dateOnly(`${dateAtX(0, camera).slice(0, 7)}-01`);
  const end = dateAtX(width, camera);
  while (current <= end && months.length < 100) { months.push(current); current = addMonths(current, 1); }
  // Keep labels legible at overview zoom, independently of snap granularity.
  const labelStep = camera.pxPerDay < 7 && !['1w', '2w', '1mo'].includes(step) ? '1w' : step;
  const ticks = gridDates(width, camera, labelStep);
  return <div className="calendar-ruler" aria-label="Календарная шкала">
    {months.map((month) => {
      const width = daysBetween(month, addMonths(month, 1)) * camera.pxPerDay;
      const label = monthNames[Number(month.slice(5, 7)) - 1];
      return <div className="calendar-month" key={month} style={{ left: xForDate(month, camera), width }}>{width < 105 ? label?.slice(0, 3) : label} <span>{month.slice(0, 4)}</span></div>;
    })}
    {ticks.map((date) => <span className="calendar-tick" key={date} style={{ left: xForDate(date, camera) }}>{Number(date.slice(8, 10))}{camera.pxPerDay > 22 && <small>{dayLabels[((daysBetween(dateOnly('1970-01-05'), date) % 7) + 7) % 7]}</small>}</span>)}
    <div className="ruler-caption">КАЛЕНДАРЬ<span>2026 — 2027</span></div>
  </div>;
}

export function TimeGrid({ camera, width, height, step, weekends }: { readonly camera: TimelineCamera; readonly width: number; readonly height: number; readonly step: GridStep; readonly weekends: boolean }) {
  const days: DateOnly[] = [];
  if (weekends) {
    let current = dateAtX(0, camera);
    const end = dateAtX(width, camera);
    while (current <= end && days.length < 1500) { days.push(current); current = addDays(current, 1); }
  }
  return <svg className="time-grid" width={width} height={height} aria-hidden="true">
    {days.filter(isWeekend).map((day) => <rect className="weekend-shade" key={day} x={xForDate(day, camera)} y={0} width={camera.pxPerDay} height="100%" />)}
    {gridDates(width, camera, step).map((date) => <line key={date} x1={xForDate(date, camera)} x2={xForDate(date, camera)} y1={0} y2="100%" />)}
  </svg>;
}

export function StageBand({ document, camera, onStart }: { readonly document: ProjectDocument; readonly camera: TimelineCamera; readonly onStart: (event: PointerEvent, id: StageMarkerId) => void }) {
  return <div className="stage-band" aria-label="Этапы производства">
    {document.stageBands.map((band, index) => {
      const left = document.stageMarkers.find((stage) => stage.id === band.leftBoundaryId);
      const right = document.stageMarkers.find((stage) => stage.id === band.rightBoundaryId);
      if (!left || !right) return null;
      return <div className={`stage-region stage-color-${String(index % 4)}`} key={band.id} style={{ left: xForDate(left.date, camera), width: daysBetween(left.date, right.date) * camera.pxPerDay }}>
        <span className="stage-name">{band.title}</span><span className="stage-date">{left.date.split('-').reverse().join('.')}</span>
      </div>;
    })}
    {document.stageMarkers.map((stage) => <button data-interactive className="stage-grip" key={stage.id} data-stage-id={stage.id} data-date={stage.date}
      style={{ left: xForDate(stage.date, camera) }} aria-label={`Перенести границу: ${stage.title}`} title={`${stage.title} · ${stage.date}`} onPointerDown={(event) => { onStart(event, stage.id); }} />)}
    <div className="stage-caption">ЭТАПЫ</div>
  </div>;
}

export function DateLines({ document, camera, today, height }: { readonly document: ProjectDocument; readonly camera: TimelineCamera; readonly today: DateOnly; readonly height: number }) {
  return <div className="date-lines" aria-hidden="true" style={{ height: '100%', minHeight: height }}>
    {document.stageMarkers.map((stage) => <div key={stage.id} className="stage-line" style={{ left: xForDate(stage.date, camera) }} />)}
    <div className="today-line" data-today={today} style={{ left: xForDate(today, camera) }}><span>Сегодня · {today.slice(8, 10)}.{today.slice(5, 7)}</span></div>
  </div>;
}
