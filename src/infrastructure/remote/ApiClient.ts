export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    const message = code === "LEASE_OWNER_REQUIRED" ? "Право изменения принадлежит другой сессии. Исходная правка сохранена; дождитесь освобождения права и повторите запрос."
      : code === "LEASE_BUSY" ? "Эту работу или зависимые объекты сейчас изменяет другой участник. Правка сохранена; повторите исходный запрос позже."
      : code === "LEASE_STALE" ? "Право на изменение истекло или было отозвано. Правка сохранена; повторите исходный запрос либо сверьте актуальные данные."
      : code === "LEASE_LIMIT" ? "Слишком много незавершённых изменений. Завершите правку в других вкладках и повторите запрос."
      : code === "INVITATION_INVALID" ? "Приглашение недействительно: срок истёк, доступ отозван, оно уже принято или предназначено другому email. Войдите с email получателя либо запросите новое приглашение."
      : code === "EDITOR_LIMIT" ? "Все места MEDIUM заняты: владелец и 3 администратора. Обратитесь к владельцу."
      : code === "OWNER_REQUIRED" ? "Отозвать участника может только владелец; владельца отозвать нельзя."
      : code === "MAIL_UNAVAILABLE" ? "Почтовый сервис недоступен. Приглашение не отправлено и отозвано; сообщите администратору."
      : status === 401 ? "Сессия завершена. Войдите снова; несохранённая правка сохранена в этой вкладке."
      : status === 403 ? "Нет доступа к рабочему пространству. Обратитесь к администратору."
      : code === "REVISION_CONFLICT" ? "Данные изменились на сервере. Ваша правка сохранена для сверки."
      : code === "COMMAND_ID_REUSED" ? "Сервер отклонил повтор с другим содержимым. Правка сохранена."
      : status === 429 ? "Слишком много запросов. Повторите действие позже."
      : status === 0 || status >= 500 ? "Сервер недоступен. Результат записи не подтверждён; правка сохранена."
      : "Сервер отклонил действие. Проверьте данные; правка сохранена.";
    super(message);
    this.status = status;
    this.code = code;
  }
}
export type RequestApi = (path: string, method?: string, body?: unknown, options?: { headers: Record<string, string> }) => Promise<unknown>;
/** Cookies stay HttpOnly; no session secrets, actor IDs or configurable foreign hosts. */
export const requestApi: RequestApi = async (path, method = "GET", body, options) => {
  if (!path.startsWith("/api/") || path.startsWith("//")) throw Error("Неверный адрес API");
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) throw new ApiError(0, "OFFLINE");
  const controller = new AbortController(), timeout = setTimeout(() => { controller.abort(); }, 15_000);
  try {
    const response = await fetch(path, {
      method, credentials: "same-origin", cache: "no-store", signal: controller.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(body === undefined && !options ? {} : { headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...options?.headers } }),
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = value && typeof value === "object" && "error" in value ? value.error : undefined;
      throw new ApiError(response.status, typeof code === "string" ? code : "REQUEST_REJECTED");
    }
    return value;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, "UNAVAILABLE");
  } finally { clearTimeout(timeout); }
};
