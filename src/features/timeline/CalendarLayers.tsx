import type { PointerEvent } from 'react';
import type { DateOnly, ProjectDocument, StageMarkerId } from '../../domain';
import type { CalendarCell, CalendarGeometry } from '../../domain/calendar';
import { widthForInterval, xForDate } from '../../domain/timeline';
import type { TimelineCamera } from '../../domain/timeline';

function cellPosition(cell: CalendarCell, camera: TimelineCamera, viewportWidth: number) {
  const left = xForDate(cell.start, camera);
  const width = widthForInterval({ startDate: cell.start, endDateExclusive: cell.endExclusive }, camera);
  const inset = Math.max(0, -left);
  return { left, width, inset, available: Math.max(0, Math.min(width - inset, viewportWidth - Math.max(0, left))) };
}

export function CalendarRuler({ camera, width, calendar, today }: { readonly camera: TimelineCamera; readonly width: number; readonly calendar: CalendarGeometry; readonly today: DateOnly }) {
  return <div className="calendar-ruler" aria-label="Календарная шкала">
    {calendar.months.map((month) => {
      const position = cellPosition(month, camera, width);
      const full = `${month.label} ${month.secondaryLabel}`;
      const short = `${month.shortLabel} ${month.secondaryLabel}`;
      const label = position.available >= full.length * 6.5 + 18 ? full : position.available >= short.length * 6.5 + 14 ? short : '';
      return <div className="calendar-month" data-start={month.start} data-end={month.endExclusive} key={month.start} style={{ left: position.left, width: position.width }} title={full}>
        <span style={{ left: position.inset, width: position.available }}>{label}</span>
      </div>;
    })}
    {calendar.cells.map((cell) => {
      const position = cellPosition(cell, camera, width);
      const label = position.available >= cell.label.length * 5.2 + 3 ? cell.label : position.available >= cell.shortLabel.length * 5.2 + 3 ? cell.shortLabel : '';
      return <div className={`calendar-cell cell-${cell.kind}`} data-start={cell.start} data-end={cell.endExclusive} data-labelled={Boolean(label)} key={cell.start}
        style={{ left: position.left, width: position.width }} title={`${cell.label} · ${cell.start} — ${cell.endExclusive}`}>
        <span className="calendar-cell-label" style={{ left: position.inset, width: position.available }}>{label}{label && position.available >= 75 && <small>{cell.secondaryLabel}</small>}</span>
      </div>;
    })}
    <div className="ruler-today-line" style={{ left: xForDate(today, camera) }} />
  </div>;
}

export function TimeGrid({ camera, width, height, calendar, weekends }: { readonly camera: TimelineCamera; readonly width: number; readonly height: number; readonly calendar: CalendarGeometry; readonly weekends: boolean }) {
  return <svg className="time-grid" width={width} height={height} aria-hidden="true">
    {weekends && calendar.weekends.map((day) => <rect className="weekend-shade" data-date={day} key={day} x={xForDate(day, camera)} y={0} width={camera.pxPerDay} height="100%" />)}
    {calendar.cells.map((cell) => <line className="calendar-column-line" data-date={cell.start} key={cell.start} x1={xForDate(cell.start, camera)} x2={xForDate(cell.start, camera)} y1={0} y2="100%" />)}
    {calendar.months.map((month) => <line className="calendar-month-line" data-date={month.start} key={month.start} x1={xForDate(month.start, camera)} x2={xForDate(month.start, camera)} y1={0} y2="100%" />)}
  </svg>;
}

export function StageBand({ document, camera, width, calendar, weekends, today, onStart, onEdit }: {
  readonly document: ProjectDocument; readonly camera: TimelineCamera; readonly width: number; readonly calendar: CalendarGeometry; readonly weekends: boolean; readonly today: DateOnly;
  readonly onStart: (event: PointerEvent, id: StageMarkerId) => void; readonly onEdit: (id: StageMarkerId) => void;
}) {
  return <div className="stage-band" aria-label="Этапы производства">
    {document.stageBands.map((band, index) => {
      const left = document.stageMarkers.find((stage) => stage.id === band.leftBoundaryId);
      const right = document.stageMarkers.find((stage) => stage.id === band.rightBoundaryId);
      if (!left || !right) return null;
      const x = xForDate(left.date, camera);
      return <div className={`stage-region stage-color-${String(index % 4)}`} key={band.id} style={{ left: x, width: widthForInterval({ startDate: left.date, endDateExclusive: right.date }, camera) }}>
        <div className="stage-label-content" style={{ left: Math.max(0, -x) }}><span className="stage-name">{band.title}</span><span className="stage-date">{left.date.split('-').reverse().join('.')}</span></div>
      </div>;
    })}
    <TimeGrid camera={camera} width={width} height={68} calendar={calendar} weekends={weekends} />
    <DateLines document={document} camera={camera} today={today} height={68} showTodayLabel={false} />
    {document.stageMarkers.map((stage) => <button data-interactive className="stage-grip" key={stage.id} data-stage-id={stage.id} data-date={stage.date}
      style={{ left: xForDate(stage.date, camera) }} aria-label={`Перенести границу: ${stage.title}`} title={`${stage.title} · ${stage.date}. Нажмите для ввода даты.`}
      onClick={() => { onEdit(stage.id); }} onPointerDown={(event) => { onStart(event, stage.id); }} />)}
  </div>;
}

export function DateLines({ document, camera, today, height, showTodayLabel = true }: { readonly document: ProjectDocument; readonly camera: TimelineCamera; readonly today: DateOnly; readonly height: number; readonly showTodayLabel?: boolean }) {
  return <div className="date-lines" aria-hidden="true" style={{ height: '100%', minHeight: height }}>
    {document.stageMarkers.map((stage) => <div key={stage.id} className="stage-line" data-date={stage.date} style={{ left: xForDate(stage.date, camera) }} />)}
    <div className="today-line" data-today={today} style={{ left: xForDate(today, camera) }}>{showTodayLabel && <span>Сегодня · {today.slice(8, 10)}.{today.slice(5, 7)}</span>}</div>
  </div>;
}
