import { useEffect, useRef, useState } from "react";
import { DateRangeEditor } from "./DateRangeEditor";
import { rangeImpact } from "../../domain/v2/activity";
import type { BoundaryEffect } from "../../domain/v2/activity";
import { planCommand } from "../../domain/v2/commands";
import type { Snapshot } from "../../domain/v2/model";
import { addDays } from "../../domain";
import type { DateOnly } from "../../domain";
import { formatDate } from "../../domain/dateRange";
import type { SendCommand } from "./StageControls";

export function ProjectRangeEditor({ snapshot, onCommand }: { snapshot: Snapshot; onCommand: SendCommand }) {
  const [choice, setChoice] = useState<{ startDate: DateOnly; endDateExclusive: DateOnly; source: Snapshot } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const resolve = useRef<((result: boolean | null) => void) | null>(null);
  useEffect(() => () => { resolve.current?.(null); }, []);
  const finish = (result: boolean | null) => { resolve.current?.(result); resolve.current = null; setChoice(null); setError(""); };
  const applyChoice = async (effect: BoundaryEffect) => {
    if (!choice || busy) return;
    setBusy(true); setError("");
    try {
      const command = { type: "ResizeProjectRange" as const, startDate: choice.startDate, endDateExclusive: choice.endDateExclusive, effect };
      planCommand(choice.source, command);
      const ok = await onCommand(command, choice.source.project.revision);
      if (ok) finish(true);
      else setError("Изменение не сохранено. Проверьте сообщение; при конфликте отмените выбор и обновите данные.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось изменить границы"); }
    finally { setBusy(false); }
  };
  return <>
    <DateRangeEditor start={snapshot.project.startDate} endExclusive={snapshot.project.endDateExclusive}
      validate={(startDate, endDateExclusive) => {
        try { rangeImpact(snapshot, { startDate, endDateExclusive }); return null; }
        catch (e) { return e instanceof Error ? e.message : "Проверьте границы"; }
      }}
      apply={(startDate, endDateExclusive) => {
        const command = { type: "ResizeProjectRange" as const, startDate, endDateExclusive };
        if (!rangeImpact(snapshot, command).length) return onCommand(command);
        return new Promise<boolean | null>((done) => { resolve.current = done; setChoice({ startDate, endDateExclusive, source: snapshot }); });
      }} />
    {choice && <div className="modal-backdrop" data-interactive>
      <section className="workspace-dialog" role="dialog" aria-modal="true" aria-label="Сокращение границ проекта"
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!busy) finish(null); } }}>
        <h2>Новые границы затрагивают работы</h2>
        <p>Затронуто работ: {rangeImpact(choice.source, choice).length}. Полностью вышедшие за границы работы сохранят даты и станут неактивными. Задачи неактивного процесса не ограничивают календарь.</p>
        <ul>{rangeImpact(choice.source, choice).map((w) => <li key={w.id}>{"stageId" in w ? "Процесс" : "Задача"}: {w.title} ({formatDate(w.startDate)} — {formatDate(addDays(w.endDateExclusive, -1))})</li>)}</ul>
        {error && <p role="alert" className="field-error">{error}</p>}
        <button type="button" className="primary-button" disabled={busy} onClick={() => { void applyChoice("clip"); }}>Обрезать работы по границе</button>
        <button type="button" disabled={busy} onClick={() => { void applyChoice("deactivate"); }}>Не обрезать — сделать затронутые работы неактивными</button>
        <button type="button" autoFocus className="quiet-button" disabled={busy} onClick={() => { finish(null); }}>Отмена</button>
      </section>
    </div>}
  </>;
}
