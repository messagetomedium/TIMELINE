import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { guestProjectSchema } from "../application/v2/accessContracts";
import { requestApi } from "../infrastructure/remote/ApiClient";
import { DateRange } from "../features/projects/DateRange";
import { GuestTimeline } from "./GuestTimeline";

type GuestProject = z.infer<typeof guestProjectSchema>;
/** Only the existing sanitized guest DTO enters this view; no editor/service/catalog. */
export function GuestView({ token }: { token: string | null }) {
  const [value, setValue] = useState<GuestProject | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(true);
  const exchange = useRef<Promise<unknown> | null>(null), reading = useRef<Promise<void> | null>(null);
  const load = useCallback((allowExchange = false) => {
    if (reading.current) return reading.current;
    if (token && !exchange.current && !allowExchange) return Promise.resolve();
    setBusy(true); setError("");
    const read = async () => {
      try {
        // Coalesce StrictMode/focus/retry. F5 without a fragment uses the HttpOnly cookie.
        if (token) {
          exchange.current ??= requestApi("/api/v1/guest/exchange", "POST", { token }).catch((e: unknown) => { exchange.current = null; throw e; });
          await exchange.current;
        }
        setValue(guestProjectSchema.parse(await requestApi("/api/v1/guest/project")));
      } catch {
        setValue(null);
        setError("Гостевой доступ недоступен: ссылка могла быть отозвана, часовой сеанс завершился, достигнут лимит 6 гостей или нет связи с сервером. Откройте исходную ссылку снова либо повторите подключение.");
      } finally { setBusy(false); reading.current = null; }
    };
    reading.current = read(); return reading.current;
  }, [token]);
  useEffect(() => {
    void Promise.resolve().then(() => load(true));
    const check = () => { void load(); };
    // Security revalidation, not collaborative editing: never prolong a guest session.
    const timer = setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => { clearInterval(timer); window.removeEventListener("focus", check); };
  }, [load]);
  return <div className="app-shell"><header className="app-header"><strong>TIMELINE</strong><span>Гостевой просмотр · Только чтение</span>
    <button disabled={busy} onClick={() => { void load(true); }}>Обновить просмотр</button></header>
    <main className="project-overview guest-project" aria-label="Гостевой проект" aria-busy={busy}>
      {error && <p role="alert">{error}</p>}{busy && !value && <p role="status">Открываем гостевой проект…</p>}
      {value && <><div className="page-heading"><span className="eyebrow">Только просмотр</span><h1>{value.project.name}</h1><DateRange value={value.project} /><p className="muted">Один проект. Доступ может быть отозван командой; гостевой сеанс действует один час.</p></div>
        <GuestTimeline value={value} />
      </>}
    </main></div>;
}
