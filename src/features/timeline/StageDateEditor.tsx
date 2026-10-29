import { useState } from 'react';
import type { StageMarker } from '../../domain';

export function StageDateEditor({ stage, left, onApply, onClose }: {
  readonly stage: StageMarker;
  readonly left: number;
  readonly onApply: (value: string) => string | null;
  readonly onClose: () => void;
}) {
  const [value, setValue] = useState<string>(stage.date);
  const [error, setError] = useState('');
  return <form className="stage-date-editor" role="dialog" aria-label="Дата границы этапа" data-interactive style={{ left }}
    onPointerDown={(event) => { event.stopPropagation(); }}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
    onSubmit={(event) => { event.preventDefault(); const message = onApply(value); if (message) setError(message); }}>
    <div className="stage-editor-heading"><strong>{stage.title}</strong><button type="button" aria-label="Закрыть дату этапа" onClick={onClose}>×</button></div>
    <label htmlFor="stage-date">Дата границы</label>
    <input autoFocus type="date" id="stage-date" required value={value} onChange={(event) => { setValue(event.target.value); setError(''); }} />
    {error && <p role="alert">{error}</p>}
    <button className="stage-date-apply" type="submit">Применить</button>
  </form>;
}
