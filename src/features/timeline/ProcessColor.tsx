import { useId, useRef, useState } from "react";

import { PROCESS_PALETTE } from "./processPalette";

export function ProcessColor({ value, onCommit }: { value: string; onCommit: (color: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const sending = useRef(false), trigger = useRef<HTMLButtonElement>(null), id = useId();
  const current = PROCESS_PALETTE.find(c => c.value.toLowerCase() === value.toLowerCase());
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <section className="process-color" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} onKeyDown={e => {
    if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(); }
  }}>
    <button ref={trigger} type="button" className="color-trigger" aria-label="Цвет процесса" aria-expanded={open} aria-controls={id}
      onClick={() => { setOpen(v => !v); }}><span className="color-chip" style={{ backgroundColor: value }} />Цвет</button>
    {open && <div id={id} className="color-catalog" role="group" aria-label="Палитра процессов">
      <p>{current ? current.name : "Текущий цвет (из старого проекта)"}</p>
      <div className="color-swatches">{PROCESS_PALETTE.map(color => <button type="button" key={color.value} disabled={busy}
        aria-label={color.name} aria-pressed={color.value.toLowerCase() === value.toLowerCase()} style={{ backgroundColor: color.value }}
        onKeyDown={e => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const buttons = Array.from(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button') ?? []), index = buttons.indexOf(e.currentTarget);
          const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (index + (e.key === "ArrowLeft" ? -1 : e.key === "ArrowUp" ? -5 : e.key === "ArrowDown" ? 5 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }} onClick={() => {
          if (sending.current) return;
          if (color.value.toLowerCase() === value.toLowerCase()) { close(); return; }
          sending.current = true; setBusy(true);
          void onCommit(color.value).then(ok => { if (ok) close(); }).finally(() => { sending.current = false; setBusy(false); });
        }}>{color.value.toLowerCase() === value.toLowerCase() ? "✓" : ""}</button>)}</div>
    </div>}
  </section>;
}
