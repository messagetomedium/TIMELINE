import { useState } from "react";
import type { RecoveryState, ServerRecovery } from "../application/v2/uiService";

export function ServerRecoveryPanel({ state, recovery, onRecovered, onError, onLogin, showDrafts = false }: {
  state: RecoveryState; recovery: ServerRecovery; onRecovered: (id: string | null) => Promise<void>;
  showDrafts?: boolean;
  onError: (error: unknown) => void; onLogin: () => void;
}) {
  const [confirm, setConfirm] = useState<"discard" | "reapply" | null>(null);
  const act = async (operation: () => Promise<string | null>) => {
    try { await onRecovered(await operation()); } catch (e) { onError(e); }
  };
  if (!state.pending && !state.message && (!showDrafts || !Object.keys(state.drafts).length)) return null;
  return <section className="legacy-notice" aria-label="Несохранённая правка">
    <p role="status">{state.sending ? "Запись выполняется…" : state.message || "Есть незавершённый ввод. Он сохранён только в этой вкладке до подтверждения сервером."}</p>
    {!state.sending && <>
      {state.pending && <button onClick={() => { void act(recovery.retry); }}>Повторить исходный запрос</button>}
      {state.conflict && <button onClick={() => { setConfirm("reapply"); }}>Сверить конфликт</button>}
      {state.authRequired && <button onClick={onLogin}>Войти снова</button>}
      <details><summary>Сохранённый черновик</summary>
        {Object.entries(state.drafts).map(([key, value]) => <label key={key}>{key}<textarea readOnly value={value} /></label>)}
        {state.intent && <label>Исходная команда<textarea readOnly value={state.intent} /></label>}
      </details>
      <button onClick={() => { setConfirm("discard"); }}>Удалить черновик</button>
    </>}
    {confirm && <section className="modal-backdrop"><section className="workspace-dialog" role="dialog" aria-label="Разрешение несохранённой правки">
      <h2>{confirm === "discard" ? "Удалить черновик?" : "Применить правку к новой ревизии?"}</h2>
      <p>{confirm === "discard" ? "Сохраните нужный текст из черновика. Удаление черновика не отменяет запись, которая могла уже пройти на сервере. После этого будут загружены серверные данные."
        : "Сначала загрузите актуальные данные кнопкой «Загрузить с сервера» и сравните их с черновиком. Подтверждение отправит сохранённую команду к новой ревизии; изменение дат может сдвинуть связанные работы."}</p>
      <button onClick={() => { setConfirm(null); }}>Отмена</button><button onClick={() => {
        const kind = confirm; setConfirm(null);
        if (kind === "discard") { try { recovery.discard(); void onRecovered(null).catch(onError); } catch (e) { onError(e); } }
        else void act(recovery.reapply);
      }}>{confirm === "discard" ? "Удалить и загрузить" : "Подтвердить повтор к новой ревизии"}</button>
    </section></section>}
  </section>;
}
