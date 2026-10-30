import { useState } from 'react';
import { addDays, addMonths, dateOnly, interval } from '../../domain';
import type { ProjectDocument } from '../../domain';
import type { ProjectInput } from '../../application/workspace/projectOperations';

export function ProjectDialog({ source, busy, onSubmit, onClose }: {
  readonly source: ProjectDocument | null; readonly busy: boolean;
  readonly onSubmit: (input: ProjectInput) => Promise<boolean>; readonly onClose: () => void;
}) {
  const now = new Date();
  const month = dateOnly(`${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
  const [name, setName] = useState(source?.project.name ?? '');
  const [description, setDescription] = useState(source?.project.description ?? '');
  const [start, setStart] = useState<string>(source?.project.startDate ?? month);
  const [end, setEnd] = useState<string>(addDays(source?.project.endDateExclusive ?? addMonths(month, 3), -1));
  const [error, setError] = useState('');
  return <div className="modal-backdrop"><form className="workspace-dialog" role="dialog" aria-modal="true" aria-label={source ? 'Редактирование проекта' : 'Новый проект'}
    onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose(); }}
    onSubmit={(event) => {
      event.preventDefault();
      try {
        const dates = interval(dateOnly(start), addDays(dateOnly(end), 1));
        void onSubmit({ name: name.trim(), description, ...dates }).then((ok) => { if (ok) onClose(); });
      } catch { setError('Проверьте даты: окончание не может быть раньше начала.'); }
    }}>
    <div className="dialog-heading"><h2>{source ? 'Редактирование проекта' : 'Новый проект'}</h2><button type="button" aria-label="Закрыть форму" disabled={busy} onClick={onClose}>×</button></div>
    <label>Название проекта<input autoFocus required value={name} onChange={(event) => { setName(event.target.value); }} /></label>
    <label>Описание<textarea value={description} onChange={(event) => { setDescription(event.target.value); }} rows={3} /></label>
    {!source && <div className="date-fields"><label>Начальная дата<input type="date" required value={start} onChange={(event) => { setStart(event.target.value); }} /></label><label>Конечная дата<input type="date" required value={end} onChange={(event) => { setEnd(event.target.value); }} /></label></div>}
    <p className="dialog-note">{source ? 'Даты проекта перемещаются целиком за ручку в общем таймлайне.' : 'Проект будет пустым. Процессы и задачи можно добавить в редакторе.'}</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="dialog-footer"><button type="button" className="quiet-button" disabled={busy} onClick={onClose}>Отмена</button><button type="submit" className="primary-button" disabled={busy}>{source ? 'Сохранить' : 'Создать проект'}</button></div>
  </form></div>;
}
