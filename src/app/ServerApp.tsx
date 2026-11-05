import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { FoundationApp } from "./FoundationApp";
import { RemoteCommandService } from "../infrastructure/remote/RemoteCommandService";
import { requestApi } from "../infrastructure/remote/ApiClient";

const sessionSchema = z.object({ user: z.object({ id: z.string().min(1), email: z.email(), emailVerified: z.boolean() }) }).nullable();
type User = NonNullable<z.infer<typeof sessionSchema>>["user"];
export function ServerApp({ resetToken, verified }: { resetToken?: string; verified: boolean }) {
  const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [loginOpen, setLoginOpen] = useState(false), [resetOpen, setResetOpen] = useState(!!resetToken);
  const load = async () => {
    setLoading(true); setError("");
    try { setUser(sessionSchema.parse(await requestApi("/api/auth/get-session"))?.user ?? null); }
    catch { setError("Не удалось проверить вход. Проверьте соединение с сервером."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void Promise.resolve().then(load); }, []);
  const userId = user?.emailVerified ? user.id : null;
  const service = useMemo(() => userId ? new RemoteCommandService(userId) : null, [userId]);
  if (loading) return <main className="workspace-loading" role="status">Проверяем вход…</main>;
  if (error) return <main className="workspace-loading"><p role="alert">{error}</p><button onClick={() => { void load(); }}>Повторить подключение</button></main>;
  const authenticated = async () => { await load(); setLoginOpen(false); setResetOpen(false); };
  const logout = async () => {
    try { await requestApi("/api/auth/sign-out", "POST", {}); setUser(null); }
    catch { setError("Не удалось выйти. Повторите подключение."); }
  };
  return <>
    {service && user ? <FoundationApp key={user.id} service={service} server={{ recovery: service, email: user.email, onLogout: logout, onLogin: () => { setLoginOpen(true); } }} /> : null}
    {(!service || loginOpen || resetOpen) && <AuthForm initial={resetOpen ? "reset" : "login"} resetToken={resetToken ?? ""} verified={verified} onSuccess={authenticated} onResetDone={() => { setResetOpen(false); }} />}
  </>;
}
function formText(data: FormData, key: string) { const value = data.get(key); return typeof value === "string" ? value : ""; }
function AuthForm({ initial, resetToken, verified, onSuccess, onResetDone }: {
  initial: "login" | "reset"; resetToken: string; verified: boolean; onSuccess: () => Promise<void>; onResetDone: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "forgot" | "reset">(initial);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(verified ? "Email подтверждён. Войдите в аккаунт." : "");
  const [email, setEmail] = useState("");
  const submit = async (data: FormData) => {
    setBusy(true); setError(""); setNotice("");
    const password = formText(data, "password");
    const callbackURL = `${location.origin}/?auth=verified`;
    try {
      if (mode === "login") {
        await requestApi("/api/auth/sign-in/email", "POST", { email, password });
        await onSuccess();
      } else if (mode === "register") {
        await requestApi("/api/auth/sign-up/email", "POST", { name: formText(data, "name").trim(), email, password, callbackURL });
        setNotice("Запрос подтверждения принят. Проверьте почту и откройте ссылку, затем войдите. Доставка письма не подтверждена. Доступ к пространству предоставляет администратор.");
        setMode("login");
      } else if (mode === "forgot") {
        await requestApi("/api/auth/request-password-reset", "POST", { email, redirectTo: `${location.origin}/?auth=reset` });
        setNotice("Если аккаунт существует, запрос восстановления принят. Проверьте почту; доставка письма не подтверждена.");
      } else {
        await requestApi("/api/auth/reset-password", "POST", { token: resetToken, newPassword: password });
        setNotice("Пароль обновлён. Войдите с новым паролем."); setMode("login"); onResetDone();
      }
    } catch {
      setError(mode === "login" ? "Вход не выполнен. Проверьте email, пароль и подтверждение email. Если сервер недоступен, повторите позже."
        : mode === "reset" ? "Пароль не изменён. Ссылка могла истечь; запросите новую или повторите позже."
        : "Не удалось подтвердить отправку. Проверьте поля; сервис почты может быть временно недоступен. Повторите позже или сообщите администратору.");
    } finally { setBusy(false); }
  };
  return <section className="modal-backdrop"><form className="workspace-dialog" aria-label="Доступ к TIMELINE" onSubmit={(e) => {
    e.preventDefault(); if (!busy) void submit(new FormData(e.currentTarget));
  }}>
    <h1>{mode === "login" ? "Вход в TIMELINE" : mode === "register" ? "Регистрация" : mode === "forgot" ? "Восстановление доступа" : "Новый пароль"}</h1>
    <p className="inspector-note">Серверный режим · данные рабочего пространства в PostgreSQL. Локальные проекты браузера сохранены отдельно.</p>
    {notice && <p role="status">{notice}</p>}{error && <p className="workspace-error" role="alert">{error}</p>}
    {mode === "register" && <label>Имя<input name="name" autoComplete="name" required maxLength={200} disabled={busy} /></label>}
    {mode !== "reset" && <label>Email<input name="email" type="email" autoComplete="email" required value={email} onChange={(e) => { setEmail(e.target.value); }} disabled={busy} /></label>}
    {mode !== "forgot" && <label>Пароль<input key={mode} name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 12} maxLength={128} disabled={busy} /></label>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Подождите…" : mode === "login" ? "Войти" : mode === "register" ? "Зарегистрироваться" : mode === "forgot" ? "Отправить ссылку" : "Изменить пароль"}</button>
    <div className="dialog-footer">
      {mode !== "login" && <button type="button" disabled={busy} onClick={() => { setMode("login"); setError(""); onResetDone(); }}>К входу</button>}
      {mode === "login" && <><button type="button" disabled={busy} onClick={() => { setMode("register"); setError(""); }}>Создать аккаунт</button><button type="button" disabled={busy} onClick={() => { setMode("forgot"); setError(""); }}>Забыли пароль?</button></>}
    </div>
    {mode === "login" && <button type="button" disabled={busy || !z.email().safeParse(email).success} onClick={() => {
      setBusy(true); setError("");
      void requestApi("/api/auth/send-verification-email", "POST", { email, callbackURL: `${location.origin}/?auth=verified` })
        .then(() => { setNotice("Если требуется подтверждение, запрос принят. Проверьте почту; доставка письма не подтверждена."); }).catch(() => { setError("Не удалось подтвердить отправку. Сервис почты может быть недоступен; повторите позже или сообщите администратору."); }).finally(() => { setBusy(false); });
    }}>Повторить письмо подтверждения</button>}
  </form></section>;
}
