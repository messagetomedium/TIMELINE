import { useState } from 'react';
import { addDays, dateOnly, interval } from '../../domain';
import type { ProcessId, ProjectDocument } from '../../domain';
import type { WorkInput } from '../../application/workspace/projectOperations';

export function CreateWorkDialog({ document, kind, parentId, onSubmit, onClose }: {
  readonly document: ProjectDocument; readonly kind: 'process' | 'task'; readonly parentId: ProcessId | null;
  readonly onSubmit: (input: WorkInput) => Promise<boolean>; readonly onClose: () => void;
}) {
  const parent = document.processes.find((process) => process.id === parentId);
  const range = parent ?? document.project;
  const [title, setTitle] = useState('');
  const [start, setStart] = useState<string>(range.startDate);
  const [end, setEnd] = useState<string>(addDays(range.endDateExclusive, -1));
  const lanes = document.lanes.filter((lane) => lane.kind === kind && (lane.kind === 'process' || lane.processId === parentId));
  const [laneId, setLaneId] = useState(kind === 'process' && document.processes.length === 0 ? lanes[0]?.id ?? '' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="modal-backdrop"><form className="workspace-dialog" role="dialog" aria-modal="true" aria-label={kind === 'process' ? 'Новый процесс' : 'Новая задача'} onSubmit={(event) => {
    event.preventDefault();
    try {
      const dates = interval(dateOnly(start), addDays(dateOnly(end), 1));
      setBusy(true);
      void onSubmit({ title: title.trim(), ...dates, laneId: laneId || null }).then((ok) => { if (ok) onClose(); }).finally(() => { setBusy(false); });
    } catch { setError('Проверьте даты: окончание не может быть раньше начала.'); }
  }}>
    <div className="dialog-heading"><h2>{kind === 'process' ? 'Новый процесс' : 'Новая задача'}</h2><button type="button" aria-label="Закрыть форму" disabled={busy} onClick={onClose}>×</button></div>
    {parent && <p className="dialog-note">Процесс: {parent.title}</p>}
    <label>Название работы<input autoFocus required value={title} onChange={(event) => { setTitle(event.target.value); }} /></label>
    <div className="date-fields"><label>Начало работы<input type="date" required value={start} onChange={(event) => { setStart(event.target.value); }} /></label><label>Окончание работы<input type="date" required value={end} onChange={(event) => { setEnd(event.target.value); }} /></label></div>
    <label>Дорожка<select aria-label="Дорожка" value={laneId} onChange={(event) => { setLaneId(event.target.value); }}><option value="">Новая дорожка</option>{lanes.map((lane, index) => <option key={lane.id} value={lane.id}>Дорожка {index + 1}</option>)}</select></label>
    <p className="dialog-note">Последовательные работы могут делить дорожку. Для параллельной работы выберите новую. Задача при необходимости расширит процесс.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-footer"><button type="button" className="quiet-button" disabled={busy} onClick={onClose}>Отмена</button><button type="submit" className="primary-button" disabled={busy}>Добавить</button></div>
  </form></div>;
}
