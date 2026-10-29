import { useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import type { Process, Task } from '../../domain';
import type { Selection } from '../../application/timelineCommands';
import { widthForInterval, xForDate } from '../../domain/timeline';
import type { TimelineCamera } from '../../domain/timeline';

interface Props {
  readonly item: Process | Task;
  readonly target: Selection;
  readonly camera: TimelineCamera;
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

export function TimelineBar({ item, target, camera, y, color, selected, highlighted, expanded, toggle, onSelect, onRename, onHover, onGesture }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const style: CSSProperties = { left: xForDate(item.startDate, camera), top: y, width: widthForInterval(item, camera), '--bar-color': color } as CSSProperties;
  return (
    <div className={`timeline-bar ${target.kind}-bar ${selected ? 'selected' : ''} ${highlighted ? 'highlighted' : ''}`} style={style}
      role="button" tabIndex={0} aria-label={`${target.kind === 'process' ? 'Процесс' : 'Задача'}: ${item.title}`} data-interactive
      data-entity-id={item.id} data-start={item.startDate} data-end={item.endDateExclusive}
      title={item.title} onClick={(event) => { event.stopPropagation(); onSelect(target); }}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(target); } }}
      onMouseEnter={() => { onHover(item.id); }} onMouseLeave={() => { onHover(null); }}>
      <button className="resize-handle start" aria-label={`Изменить начало: ${item.title}`} onPointerDown={(event) => { onGesture(event, target, 'start'); }} />
      <button className="move-handle" aria-label={`Переместить: ${item.title}`} onPointerDown={(event) => { onGesture(event, target, 'move'); }}>⠿</button>
      {editing ? <input autoFocus className="inline-title" aria-label="Название на полосе" value={draft}
        onChange={(event) => { setDraft(event.target.value); }} onPointerDown={(event) => { event.stopPropagation(); }}
        onBlur={() => { setEditing(false); }} onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') setEditing(false);
          if (event.key === 'Enter') { onRename(target, draft); setEditing(false); }
        }} /> : <span className="bar-title" onDoubleClick={(event) => { event.stopPropagation(); setDraft(item.title); setEditing(true); }}>{item.title}</span>}
      {toggle && <button className="expand-handle" aria-label={`${expanded ? 'Свернуть' : 'Раскрыть'}: ${item.title}`} aria-expanded={expanded}
        onClick={(event) => { event.stopPropagation(); toggle(); }}>{expanded ? '⌃' : '⌄'}</button>}
      <button className="resize-handle end" aria-label={`Изменить окончание: ${item.title}`} onPointerDown={(event) => { onGesture(event, target, 'end'); }} />
    </div>
  );
}
