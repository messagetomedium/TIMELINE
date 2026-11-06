import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";
import { teamSchema, guestLinksSchema } from "../application/v2/accessContracts";
import { ApiError, requestApi } from "../infrastructure/remote/ApiClient";

function message(error: unknown) {
  if (error instanceof ApiError) {
    if (["EDITOR_LIMIT", "OWNER_REQUIRED", "MAIL_UNAVAILABLE"].includes(error.code)) return error.message;
    if (error.status === 401) return "Сессия завершена. Войдите снова.";
    if (error.status === 403) return "Нет доступа. Обратитесь к владельцу MEDIUM.";
    if (error.status === 429) return "Слишком много запросов. Повторите позже.";
    if (!error.status || error.status >= 500) return "Сервер недоступен. Действие не подтверждено; проверьте список после подключения.";
    return "Действие отклонено. Проверьте данные и обновите список.";
  }
  return "Не удалось проверить ответ сервера. Обновите список перед повторным действием.";
}
function useAccessList<T>(path: string, schema: z.ZodType<T>) {
  const [data, setData] = useState<T | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const working = useRef(false);
  const read = useCallback(async () => schema.parse(await requestApi(path)), [path, schema]);
  const reload = useCallback(async () => {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try { setData(await read()); }
    catch (e) { setData(null); setError(message(e)); }
    finally { working.current = false; setBusy(false); }
  }, [read]);
  useEffect(() => { void Promise.resolve().then(reload); }, [reload]);
  const act = async (operation: () => Promise<string>, afterConfirmed?: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    try {
      setNotice(await operation()); // A confirmed mutation stays confirmed if the next read fails.
      try { await afterConfirmed?.(); setData(await read()); }
      catch (e) { setData(null); setError(`Действие подтверждено, но обновить список не удалось. ${message(e)}`); }
    } catch (e) { setError(message(e)); }
    finally { working.current = false; setBusy(false); }
  };
  return { data, busy, error, notice, reload, act };
}
function AccessDialog({ title, children, busy, onClose }: { title: string; children: ReactNode; busy: boolean; onClose: () => void }) {
  return <section className="modal-backdrop" data-presentation><section className="workspace-dialog access-dialog" role="dialog" aria-modal="true" aria-label={title}>
    <div className="dialog-heading"><h2>{title}</h2><button aria-label="Закрыть доступ" disabled={busy} onClick={onClose}>×</button></div>{children}
  </section></section>;
}
function Confirmation({ label, busy, onCancel, onConfirm }: { label: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <section role="alertdialog" aria-label="Подтверждение отзыва"><p>{label}</p><div className="dialog-footer">
    <button disabled={busy} onClick={onCancel}>Отмена</button><button disabled={busy} onClick={onConfirm}>Подтвердить отзыв</button>
  </div></section>;
}
const invitationStatus = { pending: "Ожидает принятия", used: "Принято", expired: "Срок истёк", revoked: "Отозвано" };
export function TeamAccess({ onClose, onMembershipChanged }: { onClose: () => void; onMembershipChanged: () => Promise<void> }) {
  const list = useAccessList("/api/v1/team", teamSchema);
  const [email, setEmail] = useState(""), [confirm, setConfirm] = useState<{ path: string; label: string } | null>(null);
  return <AccessDialog title="Команда и доступ" busy={list.busy} onClose={onClose}>
    <p>MEDIUM · Владелец + 3 администратора. {list.data ? `${String(list.data.members.length)} из ${String(list.data.limits.editors)} мест занято. До ${String(list.data.limits.guests)} гостевых подключений.` : "Загружаем команду…"}</p>
    {list.error && <p role="alert">{list.error}</p>}{list.notice && <p role="status">{list.notice}</p>}
    <button disabled={list.busy} onClick={() => { void list.reload(); }}>Обновить команду</button>
    {list.data && <>
      <h3>Участники</h3><ul className="access-list">{list.data.members.map((m) => <li key={m.id}>
        <strong>{m.name}</strong><span>{m.email} · {m.role === "owner" ? "Владелец (owner)" : "Администратор (admin)"}</span>
        {list.data?.role === "owner" && m.role !== "owner" && <button disabled={list.busy} onClick={() => { setConfirm({ path: `/api/v1/members/${m.id}`, label: `Отозвать доступ ${m.email}? Исполнители и назначения сохранятся.` }); }}>Отозвать участника {m.email}</button>}
      </li>)}</ul>
      <form onSubmit={(e) => { e.preventDefault(); void list.act(async () => {
        await requestApi("/api/v1/invitations", "POST", { email: email.trim() }); setEmail("");
        return "Приглашение создано на 7 дней. Доставка письма зависит от почтового сервиса.";
      }); }}>
        <label>Email администратора<input type="email" required maxLength={254} value={email} disabled={list.busy} onChange={(e) => { setEmail(e.target.value); }} /></label>
        <button className="primary-button" disabled={list.busy || list.data.members.length >= list.data.limits.editors}>Пригласить администратора</button>
      </form>
      <h3>Приглашения</h3>{!list.data.invitations.length && <p>Приглашений пока нет.</p>}
      <ul className="access-list">{list.data.invitations.map((i) => <li key={i.id}><strong>{i.email}</strong>
        <span>{invitationStatus[i.status]} · До {new Date(i.expiresAt).toLocaleString("ru-RU")}</span>
        {i.status === "pending" && <button disabled={list.busy} onClick={() => { setConfirm({ path: `/api/v1/invitations/${i.id}`, label: `Отозвать приглашение ${i.email}?` }); }}>Отозвать приглашение {i.email}</button>}
      </li>)}</ul>
    </>}
    {confirm && <Confirmation label={confirm.label} busy={list.busy} onCancel={() => { setConfirm(null); }} onConfirm={() => {
      const path = confirm.path; setConfirm(null); void list.act(async () => { await requestApi(path, "DELETE"); return "Доступ отозван."; }, path.startsWith("/api/v1/members/") ? onMembershipChanged : undefined);
    }} />}
  </AccessDialog>;
}

const issuedLinkSchema = z.strictObject({ id: z.uuid(), url: z.url() });
export function ProjectSharing({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const list = useAccessList(`/api/v1/projects/${projectId}/guest-links`, guestLinksSchema);
  const [issued, setIssued] = useState(""), [copy, setCopy] = useState(""), [confirm, setConfirm] = useState<string | null>(null);
  const copyLink = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopy("Ссылка скопирована."); }
    catch { setCopy("Автоматическое копирование недоступно. Выделите и скопируйте ссылку вручную."); }
  };
  return <AccessDialog title="Поделиться просмотром" busy={list.busy} onClose={onClose}>
    <p>Просмотр одного проекта без регистрации, исполнителей и контактов. Ссылка действует до отзыва; гостевой сеанс — один час. Ссылку увидит каждый, кому вы её передадите.</p>
    {list.error && <p role="alert">{list.error}</p>}{list.notice && <p role="status">{list.notice}</p>}
    <button disabled={list.busy} onClick={() => { void list.reload(); }}>Обновить ссылки</button>
    <button className="primary-button" disabled={list.busy || !list.data} onClick={() => { void list.act(async () => {
      const result = issuedLinkSchema.parse(await requestApi(`/api/v1/projects/${projectId}/guest-links`, "POST"));
      const url = new URL(result.url);
      if (url.origin !== location.origin || url.pathname !== "/guest" || url.search || !/^[\w-]{43}$/.test(url.hash.slice(1))) throw Error("Сервер вернул некорректную ссылку.");
      setIssued(result.url); void copyLink(result.url); return "Ссылка выпущена. Сохраните её до закрытия этого окна: повторно показать секрет нельзя.";
    }); }}>Создать гостевую ссылку</button>
    {issued && <><label>Новая гостевая ссылка<input readOnly value={issued} onFocus={(e) => { e.currentTarget.select(); }} /></label>
      <button onClick={() => { void copyLink(issued); }}>Копировать ссылку</button><p role="status">{copy}</p></>}
    {list.data && <><h3>Ссылки проекта</h3>{!list.data.links.length && <p>Гостевых ссылок пока нет.</p>}
      <ul className="access-list">{list.data.links.map((link) => <li key={link.id}><span>Ссылка {link.id.slice(0, 8)} · {link.status === "active" ? "Действует · Только просмотр" : "Отозвана"}</span>
        {link.status === "active" && <button disabled={list.busy} onClick={() => { setConfirm(link.id); }}>Отозвать ссылку {link.id.slice(0, 8)}</button>}
      </li>)}</ul></>}
    {confirm && <Confirmation label="Отозвать ссылку и доступ её гостей?" busy={list.busy} onCancel={() => { setConfirm(null); }} onConfirm={() => {
      const id = confirm; setConfirm(null); void list.act(async () => { await requestApi(`/api/v1/guest-links/${id}`, "DELETE"); setIssued(""); return "Гостевой доступ отозван."; });
    }} />}
  </AccessDialog>;
}
