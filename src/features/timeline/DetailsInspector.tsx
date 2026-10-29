import { useState } from 'react';
import type { ProjectDocument } from '../../domain';
import type { Selection } from '../../application/timelineCommands';
import { DateRange } from '../projects/DateRange';

export function DetailsInspector({ document, selection, onRename }: { readonly document: ProjectDocument; readonly selection: Selection | null; readonly onRename: (target: Selection, title: string) => void }) {
  const item = selection?.kind === 'process' ? document.processes.find((item) => item.id === selection.id) : document.tasks.find((item) => item.id === selection?.id);
  const [draft, setDraft] = useState(item?.title ?? '');
  if (!selection || !item) return <aside className="details-inspector" aria-label="Свойства элемента"><p className="inspector-kicker">СВОЙСТВА</p><h2>Выберите работу</h2><p className="inspector-note">Нажмите на процесс или задачу, чтобы посмотреть детали.</p></aside>;
  const process = selection.kind === 'process' ? document.processes.find((process) => process.id === item.id) : document.processes.find((process) => 'processId' in item && process.id === item.processId);
  const assignments = document.assignments.filter((assignment) => assignment.targetId === item.id);
  return <aside className="details-inspector" aria-label="Свойства элемента" data-selected-id={item.id}>
    <div className="inspector-top"><p className="inspector-kicker">СВОЙСТВА</p><span className="inspector-type">{selection.kind === 'process' ? 'Процесс' : 'Задача'}</span></div>
    <div className="inspector-color" style={{ backgroundColor: process?.color }} />
    <label className="inspector-label" htmlFor="element-title">Название</label>
    <textarea id="element-title" rows={2} value={draft} onChange={(event) => { setDraft(event.target.value); }}
      onBlur={() => { if (draft !== item.title) onRename(selection, draft); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.stopPropagation(); setDraft(item.title); }
      }} />
    <div className="inspector-section"><span className="inspector-label">Даты</span><DateRange value={item} /></div>
    <div className="inspector-section"><span className="inspector-label">Статус</span><span className="inspector-status"><i />{item.status}</span></div>
    <div className="inspector-section"><span className="inspector-label">Описание</span><p>{item.details ?? 'Описание не добавлено.'}</p></div>
    <div className="inspector-section"><span className="inspector-label">{selection.kind === 'process' ? 'Руководитель процесса' : 'Исполнители'}</span>
      {assignments.map((assignment) => {
        const person = document.people.find((person) => person.id === assignment.personId);
        return <div className="inspector-person" key={assignment.id}><span className="person-avatar">{person?.displayName?.slice(0, 1) ?? '—'}</span><div><strong>{person?.displayName ?? 'Не назначен'}</strong><small>{assignment.roleLabel}</small></div></div>;
      })}
    </div>
    <div className="inspector-help"><strong>Работа с планом</strong><p>Двойной клик — название.<br />Ручка ⠿ — перенос.<br />Край полосы — длительность.<br />Пустой фон или средняя кнопка — панорама.<br />Esc — отмена жеста.</p></div>
    <p className="memory-notice">Демо работает в этой вкладке. Изменения сбросятся при обновлении страницы.</p>
  </aside>;
}
