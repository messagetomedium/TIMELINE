import { useEffect, useRef, useState } from "react";
import { addDays, addMonths, dateOnly } from "../../domain";
import type { DateOnly } from "../../domain";
import {
  chooseRangeDate,
  formatDate,
  monthCells,
  parseDate,
} from "../../domain/dateRange";
import type { RangeSelection } from "../../domain/dateRange";
const months = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
export function DateRangeEditor({
  start,
  endExclusive,
  heading = "Границы проекта",
  startLabel = "Начало",
  endLabel = "Конец",
  apply,
  validate,
}: {
  start: DateOnly;
  endExclusive: DateOnly;
  heading?: string;
  startLabel?: string;
  endLabel?: string;
  apply: (start: DateOnly, end: DateOnly) => Promise<boolean>;
  validate: (start: DateOnly, end: DateOnly) => string | null;
}) {
  const end = addDays(endExclusive, -1),
    [a, setA] = useState(formatDate(start)),
    [b, setB] = useState(formatDate(end)),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    sending = useRef(false),
    pending = useRef<[DateOnly, DateOnly] | null>(null),
    retry = useRef<((left: DateOnly, right: DateOnly) => Promise<boolean>) | null>(null),
    [previous, setPrevious] = useState({ start, end });
  if (previous.start !== start || previous.end !== end) {
    const old = previous;
    // An arriving save must not overwrite a newer draft in the other field.
    setA((current) => current === formatDate(old.start) ? formatDate(start) : current);
    setB((current) => current === formatDate(old.end) ? formatDate(end) : current);
    setPrevious({ start, end });
  }
  const original = `${start}:${endExclusive}`,
    last = useRef(original);
  const save = async (left: DateOnly, right: DateOnly) => {
    let edge: DateOnly;
    try {
      edge = addDays(right, 1);
    } catch {
      setError("Конец выходит за поддерживаемый календарный диапазон");
      return false;
    }
    const key = `${left}:${edge}`;
    if (sending.current) {
      if (last.current !== key) pending.current = [left, right];
      return false;
    }
    const reason =
      left > right
        ? "Конец должен быть не раньше начала"
        : validate(left, edge);
    if (reason) {
      setError(reason);
      return false;
    }
    if (key === original) return true;
    if (last.current === key) return false;
    sending.current = true;
    last.current = key;
    setBusy(true);
    setError("");
    try {
      const ok = await apply(left, edge);
      if (ok) {
        setA((current) => current === a ? formatDate(left) : current);
        setB((current) => current === b ? formatDate(right) : current);
      } else {
        last.current = original;
        setError("Изменение не сохранено. Проверьте сообщение и повторите.");
      }
      return ok;
    } catch (e) {
      last.current = original;
      setError(e instanceof Error ? e.message : "Не удалось сохранить даты");
      return false;
    } finally {
      sending.current = false;
      setBusy(false);
      const queued = pending.current;
      pending.current = null;
      if (queued) void retry.current?.(...queued);
    }
  };
  useEffect(() => { retry.current = save; });
  const commitInputs = () => {
    try { void save(parseDate(a), parseDate(b)); }
    catch (e) { setError(e instanceof Error ? e.message : "Проверьте даты"); }
  };
  const inputRange = () => {
    try {
      return { start: parseDate(a), end: parseDate(b) };
    } catch {
      return { start, end };
    }
  };
  return (
    <section className="range-editor">
      <h3>{heading}</h3>
      <form
        onBlur={(e) => {
          if (e.target instanceof HTMLInputElement) commitInputs();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            commitInputs();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setA(formatDate(start));
            setB(formatDate(end));
            setError("");
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          commitInputs();
        }}
      >
        <div className="range-inputs">
          <label>
            {startLabel}
            <input
              aria-label={startLabel}
              value={a}
              inputMode="numeric"
              placeholder="ДД.ММ.ГГГГ"
              onChange={(e) => {
                setA(e.target.value);
                setError("");
                last.current = original;
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setA(formatDate(start));
                  setB(formatDate(end));
                  setError("");
                }
              }}
            />
          </label>
          <span>—</span>
          <label>
            {endLabel}
            <input
              aria-label={endLabel}
              value={b}
              inputMode="numeric"
              placeholder="ДД.ММ.ГГГГ"
              onChange={(e) => {
                setB(e.target.value);
                setError("");
                last.current = original;
              }}
            />
          </label>
          <button
            type="button"
            className="range-calendar-button"
            aria-label={`Календарь: ${heading}`}
            aria-expanded={open}
            onClick={() => {
              setError("");
              setOpen(true);
            }}
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M7 2v6m10-6v6M3 11h18" />
            </svg>
          </button>
        </div>
      </form>
      {error && !open && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <RangeCalendar
          initial={inputRange()}
          busy={busy}
          error={error}
          onCancel={() => {
            setOpen(false);
            setError("");
          }}
          onConfirm={async (selection) => {
            if (
              selection.start &&
              selection.end &&
              (await save(selection.start, selection.end))
            ) {
              setOpen(false);
            }
          }}
        />
      )}
    </section>
  );
}
function RangeCalendar({
  initial,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  initial: RangeSelection;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (range: RangeSelection) => Promise<void>;
}) {
  const [selection, setSelection] = useState(initial),
    [month, setMonth] = useState(() =>
      dateOnly(
        `${(initial.start ?? initial.end ?? dateOnly("2026-01-01")).slice(0, 7)}-01`,
      ),
    );
  return (
    <section
      className="range-popover"
      role="dialog"
      aria-label="Календарь диапазона"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <header>
        <button
          type="button"
          aria-label="Предыдущий месяц"
          disabled={month === "0001-01-01" || busy}
          onClick={() => {
            setMonth(addMonths(month, -1));
          }}
        >
          ‹
        </button>
        <strong aria-live="polite">
          {months[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
        </strong>
        <button
          type="button"
          aria-label="Следующий месяц"
          disabled={month === "9999-12-01" || busy}
          onClick={() => {
            setMonth(addMonths(month, 1));
          }}
        >
          ›
        </button>
      </header>
      <div className="range-weekdays">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="range-days">
        {monthCells(month).map((day, i) =>
          day ? (
            <button
              type="button"
              key={day}
              aria-label={formatDate(day)}
              aria-pressed={selection.start === day || selection.end === day}
              data-range-day={day}
              data-in-range={
                !!selection.start &&
                !!selection.end &&
                selection.start <= day &&
                day <= selection.end
              }
              className={`${day.slice(0, 7) !== month.slice(0, 7) ? "other-month" : ""} ${selection.start === day ? "range-start" : ""} ${selection.end === day ? "range-end" : ""}`}
              disabled={busy}
              onClick={() => {
                setSelection((old) => chooseRangeDate(old, day));
              }}
            >
              {Number(day.slice(8, 10))}
            </button>
          ) : (
            <span key={String(i)} />
          ),
        )}
      </div>
      <p className="range-selection" aria-live="polite">
        {selection.start ? formatDate(selection.start) : "Начало не выбрано"} —{" "}
        {selection.end ? formatDate(selection.end) : "Конец не выбран"}
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button
          type="button"
          className="quiet-button"
          disabled={busy}
          onClick={onCancel}
        >
          Отмена
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !selection.start || !selection.end}
          onClick={() => {
            void onConfirm(selection);
          }}
        >
          Подтвердить
        </button>
      </footer>
    </section>
  );
}
