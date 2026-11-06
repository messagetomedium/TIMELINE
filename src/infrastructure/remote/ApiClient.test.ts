import { afterEach, expect, it, vi } from "vitest";
import { requestApi } from "./ApiClient";
import { RemoteCommandService } from "./RemoteCommandService";
import { createTemplate } from "../../domain/v2/template";
import { dateOnly } from "../../domain";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("aborts a stalled content request, ends sending and keeps its exact id for retry", async () => {
  vi.useFakeTimers();
  const bodies: string[] = [];
  vi.stubGlobal("fetch", vi.fn((_path: string, options: RequestInit) => {
    if (typeof options.body !== "string") throw Error("Expected JSON request body");
    bodies.push(options.body);
    return new Promise((_resolve, reject) => { options.signal?.addEventListener("abort", () => { reject(new DOMException("Abort", "AbortError")); }); });
  }));
  const rows = new Map<string, string>();
  const store = { getItem: (k: string) => rows.get(k) ?? null, setItem: (k: string, v: string) => { rows.set(k, v); }, removeItem: (k: string) => { rows.delete(k); } };
  const service = new RemoteCommandService("timeout", requestApi, store);
  const d = createTemplate("Test", "", dateOnly("2026-11-01"), () => crypto.randomUUID(), new Date().toISOString());
  const e = service.envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "Сохранить" });
  const first = expect(service.execute(e)).rejects.toThrow("не подтверждён");
  await vi.advanceTimersByTimeAsync(15_000); await first;
  expect(service.getState().sending).toBe(false); expect(service.getState().pending).toBe(true);
  const second = expect(service.retry()).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(15_000); await second;
  expect(bodies).toEqual([JSON.stringify(e), JSON.stringify(e)]);
});
it("known offline never looks successful and dispatches no fetch", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); vi.stubGlobal("navigator", { onLine: false });
  await expect(requestApi("/api/v1/projects", "POST", {})).rejects.toMatchObject({ status: 0, code: "OFFLINE" });
  expect(fetch).not.toHaveBeenCalled();
});
