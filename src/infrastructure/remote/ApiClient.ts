export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    const message = status === 401 ? "Сессия завершена. Войдите снова; несохранённая правка сохранена в этой вкладке."
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
export type RequestApi = (path: string, method?: string, body?: unknown) => Promise<unknown>;
/** Cookies stay HttpOnly; no session secrets, actor IDs or configurable foreign hosts. */
export const requestApi: RequestApi = async (path, method = "GET", body) => {
  if (!path.startsWith("/api/") || path.startsWith("//")) throw Error("Неверный адрес API");
  const controller = new AbortController(), timeout = setTimeout(() => { controller.abort(); }, 15_000);
  try {
    const response = await fetch(path, {
      method, credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
