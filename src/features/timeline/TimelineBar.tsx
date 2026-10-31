import { useState } from 'react';
import { CommitText } from './CommitText';
import type { CSSProperties, PointerEvent } from 'react';
import type { Process, Task } from '../../domain';
import type { Selection } from '../../application/timelineCommands';
import { widthForInterval, xForDate } from '../../domain/timeline';
import type { TimelineCamera } from '../../domain/timeline';

interface Props {
  readonly item: Process | Task;
  readonly target: Selection;
  readonly camera: TimelineCamera;
  readonly viewportWidth: number;
  readonly y: number;
  readonly color: string;
  readonly selected: boolean;
  readonly highlighted: boolean;
  readonly expanded: boolean;
  readonly toggle: (() => void) | undefined;
  readonly onSelect: (target: Selection) => void;
  readonly onRename: (target: Selection, title: string) => void;
  readonly onHover: (id: string | null) => void;
  readonly onGesture: (event: PointerEvent, target: Selection, action: 'move' | 'start' | 'end') => void;
}

export function TimelineBar({ item, target, camera, viewportWidth, y, color, selected, highlighted, expanded, toggle, onSelect, onRename, onHover, onGesture }: Props) {
  const [editing, setEditing] = useState(false);
  const style: CSSProperties = { left: xForDate(item.startDate, camera), top: y, width: widthForInterval(item, camera), '--bar-color': color } as CSSProperties;
  const inView = xForDate(item.startDate, camera) < viewportWidth && xForDate(item.endDateExclusive, camera) > 0;
  const visibleInset = inView ? Math.max(0, -xForDate(item.startDate, camera)) : 0;
  const rightInset = inView ? Math.max(7, xForDate(item.endDateExclusive, camera) - viewportWidth + 7) : 7;
  return (
    <div className={`timeline-bar ${target.kind}-bar ${selected ? 'selected' : ''} ${highlighted ? 'highlighted' : ''}`} style={style}
      role="button" tabIndex={0} aria-label={`${target.kind === 'process' ? 'Процесс' : 'Задача'}: ${item.title}`} data-interactive
      data-entity-id={item.id} data-start={item.startDate} data-end={item.endDateExclusive}
      title={item.title} onClick={(event) => { event.stopPropagation(); onSelect(target); }}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(target); } }}
      onMouseEnter={() => { onHover(item.id); }} onMouseLeave={() => { onHover(null); }}>
      <button className="resize-handle start" aria-label={`Изменить начало: ${item.title}`} onPointerDown={(event) => { onGesture(event, target, 'start'); }} />
      <button className="move-handle" style={{ left: visibleInset + 7 }} aria-label={`Переместить: ${item.title}`} onPointerDown={(event) => { onGesture(event, target, 'move'); }}>⠿</button>
      {editing ? <div className="inline-title" style={{left:visibleInset+22,width:Math.min(widthForInterval(item,camera)-visibleInset-28,viewportWidth-28)}} onPointerDown={e=>{e.stopPropagation();}}><CommitText key={item.title} input autoFocus label="Название на полосе" value={item.title} onCommit={value=>{onRename(target,value);}} onFinish={()=>{setEditing(false);}}/></div> : <span className="bar-title" style={{ position: 'absolute', left: visibleInset + 24, right: target.kind === 'process' ? rightInset + 16 : inView ? Math.max(6, xForDate(item.endDateExclusive, camera) - viewportWidth + 6) : 6, width: 'auto', padding: 0 }} onDoubleClick={(event) => { event.stopPropagation(); setEditing(true); }}>{item.title}</span>}
      {toggle && <button className="expand-handle" style={{ right: rightInset }} aria-label={`${expanded ? 'Свернуть' : 'Раскрыть'}: ${item.title}`} aria-expanded={expanded}
        onClick={(event) => { event.stopPropagation(); toggle(); }}>{expanded ? '⌃' : '⌄'}</button>}
      <button className="resize-handle end" aria-label={`Изменить окончание: ${item.title}`} onPointerDown={(event) => { onGesture(event, target, 'end'); }} />
    </div>
  );
}
