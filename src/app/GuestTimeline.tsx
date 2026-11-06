import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { z } from "zod";
import type { guestProjectSchema } from "../application/v2/accessContracts";
import { addDays, dateOnly } from "../domain";
import type { DateOnly } from "../domain";
import { getCalendarGeometry, visibleYears } from "../domain/calendar";
import { RESULT_COLUMN_WIDTH, xBefore } from "../domain/SegmentAxis";
import { cameraForFitRange, getVisibleDateRange, widthForInterval, WORK_ZOOM, xForDate } from "../domain/timeline";
import { CalendarRuler, TimeGrid } from "../features/timeline/CalendarLayers";
import { DateRange } from "../features/projects/DateRange";
import { formatDate } from "../features/projects/formatDate";
import "../styles/timeline.css";

type GuestProject = z.infer<typeof guestProjectSchema>;
type Row = { kind: "process" | "task"; work: GuestProject["processes"][number] | GuestProject["tasks"][number]; color: string; active: boolean }
  | { kind: "result"; result: GuestProject["results"][number]; boundary: DateOnly };
const rowHeight = 48, gutter = 176;

/** Projection of the guest DTO only. No Snapshot, editor, assignments or command handlers. */
export function GuestTimeline({ value }: { value: GuestProject }) {
  const host = useRef<HTMLDivElement>(null), [viewport, setViewport] = useState(800);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setViewport(Math.max(640, entry.contentRect.width - gutter)); });
    observer.observe(host.current); return () => { observer.disconnect(); };
  }, []);
  const stages = [...value.stages].sort((a, b) => a.sortIndex - b.sortIndex);
  const gaps = stages.filter((s) => value.results.some((r) => r.stageId === s.id)).map((s) => ({ stageId: s.id, boundary: s.endDateExclusive, width: RESULT_COLUMN_WIDTH }));
  const rows: Row[] = [];
  for (const stage of stages) {
    for (const process of value.processes.filter((p) => p.stageId === stage.id)) {
      rows.push({ kind: "process", work: process, color: process.color, active: process.isActive });
      for (const task of value.tasks.filter((t) => t.processId === process.id)) rows.push({ kind: "task", work: task, color: process.color, active: task.isActive && process.isActive });
    }
    for (const result of value.results.filter((r) => r.stageId === stage.id)) rows.push({ kind: "result", result, boundary: stage.endDateExclusive });
  }
  const works = [...value.processes, ...value.tasks];
  const range = {
    startDate: [value.project.startDate, ...works.map((w) => w.startDate), ...value.checkpoints.map((c) => c.date)].sort()[0] ?? value.project.startDate,
    endDateExclusive: [value.project.endDateExclusive, ...works.map((w) => w.endDateExclusive), ...value.checkpoints.map((c) => addDays(c.date, 1))].sort().at(-1) ?? value.project.endDateExclusive,
  };
  const width = Math.max(viewport, gaps.length * RESULT_COLUMN_WIDTH + 480), height = Math.max(144, rows.length * rowHeight);
  const camera = cameraForFitRange({ originDate: range.startDate, pxPerDay: WORK_ZOOM, panX: 0, gaps }, range, width);
  const calendar = getCalendarGeometry(getVisibleDateRange(width, camera), camera.pxPerDay >= 28 ? "1d" : camera.pxPerDay >= 7 ? "1w" : "1mo");
  const area = { project: value.project, checkpoints: value.checkpoints.map((c) => c.date) };
  return <div ref={host} className="timeline-surface guest-timeline" aria-label="Календарный таймлайн проекта">
    <div style={{ width: width + gutter }}>
      <div className="calendar-row"><div className="section-gutter calendar-gutter">Календарь<span>{visibleYears(calendar.range)}</span></div>
        <CalendarRuler camera={camera} width={width} calendar={calendar} today={dateOnly(new Date().toISOString().slice(0, 10))} area={area} /></div>
      <div className="stage-row"><div className="section-gutter stage-gutter">Этапы</div><div className="stage-band">
        {stages.map((stage, index) => <section className={`stage-region stage-color-${String(index % 4)}`} key={stage.id} data-start={stage.startDate} data-end={stage.endDateExclusive}
          style={{ left: xForDate(stage.startDate, camera), width: widthForInterval(stage, camera) }}><div className="stage-label-content"><h2 className="stage-name">{stage.title}</h2><span className="stage-date"><DateRange value={stage} /></span></div></section>)}
      </div></div>
      <div className="calendar-row guest-checkpoints" style={{ height: Math.max(32, value.checkpoints.length * 24) }}><div className="section-gutter">Чекпойнты</div>
        <div className="guest-time-track">{value.checkpoints.map((c, i) => <div className="checkpoint-header-label" key={c.id} data-date={c.date} title={`${c.title} · ${formatDate(c.date)}`}
          style={{ left: Math.max(0, Math.min(width - 180, xForDate(c.date, camera))), top: i * 24, width: 180 }}><strong>{c.title}</strong><small>{formatDate(c.date)}</small></div>)}</div></div>
      <div className="timeline-body-layout" style={{ height }}><div className="guest-row-labels">{rows.map((row) => <div key={row.kind === "result" ? row.result.id : row.work.id} className={`guest-row-label guest-${row.kind}`} style={{ height: rowHeight }}>
        {row.kind === "result" ? <span>Результат</span> : <><h3>{row.work.title}</h3><small>{row.active ? row.work.status : "Неактивная работа"}</small></>}
      </div>)}</div><div className="guest-time-track" style={{ height }}>
        <TimeGrid camera={camera} width={width} height={height} calendar={calendar} weekends area={area} />
        <div className="result-columns">{gaps.map((g) => <div className="result-column" key={g.stageId} style={{ left: xBefore(g.boundary, camera), width: g.width }} />)}</div>
        {value.checkpoints.map((c) => <div className="checkpoint-line" key={c.id} data-date={c.date} style={{ left: xForDate(c.date, camera) }} />)}
        {rows.map((row, i) => row.kind === "result" ? <div className="result-tile guest-result" key={row.result.id} style={{ left: xBefore(row.boundary, camera) + 8, top: i * rowHeight + 8 }}><strong>{row.result.title}</strong></div>
          : <div className={`timeline-bar ${row.kind}-bar${row.active ? "" : " inactive-work"}`} key={row.work.id} data-kind={row.kind} data-start={row.work.startDate} data-end={row.work.endDateExclusive}
            aria-label={`${row.kind === "process" ? "Процесс" : "Задача"}: ${row.work.title}`} title={`${row.work.title} · ${formatDate(row.work.startDate)} — ${formatDate(addDays(row.work.endDateExclusive, -1))}`}
            style={{ left: xForDate(row.work.startDate, camera), width: widthForInterval(row.work, camera), top: i * rowHeight + 10, "--bar-color": row.color } as CSSProperties}><span className="bar-title">{row.work.title}</span></div>)}
      </div></div>
    </div>
  </div>;
}
