import { describe, expect, it } from "vitest";
import { RemoteCommandService } from "./RemoteCommandService";
import { ApiError } from "./ApiClient";
import type { RequestApi } from "./ApiClient";
import { createTemplate } from "../../domain/v2/template";
import { WORKSPACE_ID } from "../../domain/v2/model";
import { dateOnly } from "../../domain";
import { v2BackupSchema } from "../../application/v2/backup";

const document = () => createTemplate("Сервер", "", dateOnly("2026-11-01"), () => crypto.randomUUID(), new Date().toISOString());
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function result(body: unknown, revision = 1) {
  const b = body as { commandId: string; projectId?: string };
  return { commandId: b.commandId, projectId: b.projectId ?? null, revision, workspaceRevision: revision, peopleRevision: 0, changed: true };
}
describe("frontend API command/recovery boundary", () => {
  it("retries a lost acknowledgement after reload with the exact same envelope and isolates user drafts", async () => {
    const store = storage(), requests: unknown[] = [], d = document();
    const api: RequestApi = (_path, _method, body) => { requests.push(body); return requests.length === 1 ? Promise.reject(new ApiError(0, "UNAVAILABLE")) : Promise.resolve(result(body)); };
    const first = new RemoteCommandService("one", api, store);
    first.rememberDraft("Название", "Не потерять");
    const envelope = first.envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "Не потерять" });
    await expect(first.execute(envelope)).rejects.toThrow("не подтверждён");
    expect(new RemoteCommandService("one", api, store).getState().drafts).toEqual({ Название: "Не потерять" });
    expect(new RemoteCommandService("another", api, store).getState().pending).toBe(false);
    const reopened = new RemoteCommandService("one", api, store);
    expect(reopened.getState().pending).toBe(true);
    await reopened.retry();
    expect(requests).toEqual([envelope, envelope]);
    expect(reopened.getState().pending).toBe(false);
    expect(new RemoteCommandService("one", api, store).getState().drafts).toEqual({});
  });
  it("never overwrites a pending intent with a second command or silently rebases a conflict", async () => {
    const d = document(), requests: unknown[] = [];
    const api: RequestApi = (path, method, body) => {
      if (method === "POST") { requests.push(body); return requests.length === 1 ? Promise.reject(new ApiError(409, "REVISION_CONFLICT")) : Promise.resolve(result(body, 8)); }
      expect(path).toBe(`/api/v1/projects/${d.project.id}`);
      return Promise.resolve({ ...d, project: { ...d.project, revision: 7 } });
    };
    const service = new RemoteCommandService("one", api, storage());
    const e = service.envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "Моя правка" });
    await expect(service.execute(e)).rejects.toThrow("изменились");
    await expect(service.execute({ ...e, commandId: crypto.randomUUID() })).rejects.toThrow("Сначала разрешите");
    expect(requests).toHaveLength(1);
    await service.reapply();
    expect(requests[1]).toMatchObject({ ...e, commandId: (requests[1] as typeof e).commandId, expectedRevision: 7 });
    expect((requests[1] as typeof e).commandId).not.toBe(e.commandId);
  });
  it.each([401, 403, 422, 503])("keeps failed intent and input for HTTP %i without local fallback", async (status) => {
    const store = storage(), d = document();
    const service = new RemoteCommandService("one", () => Promise.reject(new ApiError(status, "REJECTED")), store);
    service.rememberDraft("Описание", "Черновик");
    await expect(service.execute(service.envelope(d, { type: "Describe", kind: "project", id: d.project.id, value: "Черновик" }))).rejects.toThrow();
    const recovered = new RemoteCommandService("one", undefined, store).getState();
    expect(recovered.pending).toBe(true); expect(recovered.drafts).toEqual({ Описание: "Черновик" });
  });
  it("dispatches nothing when durable intent storage fails", async () => {
    let requests = 0;
    const service = new RemoteCommandService("one", () => { requests++; return Promise.resolve(null); }, { getItem: () => null, setItem: () => { throw Error("quota"); }, removeItem: () => undefined });
    const d = document();
    await expect(service.execute(service.envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "A" }))).rejects.toThrow("Черновик вкладки недоступен");
    expect(requests).toBe(0); expect(service.getState().intent).toContain('"value": "A"');
  });
  it("preserves unfinished input when saving view preferences, and restores it after reload", async () => {
    const store = storage(), d = document();
    const service = new RemoteCommandService("one", (_path, _method, body) => Promise.resolve({ value: (body as { value: unknown }).value }), store);
    service.rememberDraft("Название", "Ещё редактирую");
    await service.saveView(d.project.id, d.viewPreferences);
    expect(new RemoteCommandService("one", undefined, store).getState().drafts).toEqual({ Название: "Ещё редактирую" });
    service.forgetDraft("Название");
    expect(new RemoteCommandService("one", undefined, store).getState().drafts).toEqual({});
  });
  it("fails closed on an invalid recovery record until explicit discard", async () => {
    const store = storage(); store.setItem("timeline-api-draft-v1:one", "broken-json");
    let requests = 0;
    const service = new RemoteCommandService("one", () => { requests++; return Promise.resolve(null); }, store), d = document();
    expect(service.getState().pending).toBe(true);
    await expect(service.execute(service.envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "A" }))).rejects.toThrow("Сначала разрешите");
    expect(requests).toBe(0);
    service.discard(); expect(service.getState().pending).toBe(false);
  });
  it("coalesces reads and refreshes only the changed project after a confirmed command", async () => {
    let d = document(); const calls: string[] = [];
    const api: RequestApi = (path, method, body) => {
      calls.push(`${method ?? "GET"} ${path}`);
      if (method === "POST") { d = { ...d, project: { ...d.project, revision: d.project.revision + 1 } }; return Promise.resolve({ ...result(body, d.project.revision), workspaceRevision: 1 }); }
      return Promise.resolve(path === "/api/v1/workspaces/current" ? { workspace: { id: WORKSPACE_ID, revision: 1 }, role: "owner" }
        : path === "/api/v1/people" ? { workspaceId: WORKSPACE_ID, revision: 0, people: [], retiredAssignments: [] }
        : path.includes("limit=") ? { projects: [{ project: d.project }], workspaceRevision: 1, nextOffset: null } : d);
    };
    const service = new RemoteCommandService("one", api, storage());
    await Promise.all([service.screen(d.project.id), service.screen(d.project.id)]);
    expect(calls).toHaveLength(4);
    calls.length = 0;
    await service.saveView(d.project.id, { ...d.viewPreferences, cameraY: 500 });
    await service.execute(service.envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "A" }));
    const refreshed = await service.screen(d.project.id, true);
    expect(calls).toEqual([`POST /api/v1/projects/${d.project.id}/commands`, `GET /api/v1/projects/${d.project.id}`]);
    expect(refreshed.views[d.project.id]?.cameraY).toBe(500);
    calls.length = 0;
    await service.projectCommand(d.project.id, { type: "Describe", kind: "project", id: d.project.id, value: "B" }, d.project.revision);
    await service.screen(d.project.id, true);
    expect(calls).toEqual([`POST /api/v1/projects/${d.project.id}/commands`, `GET /api/v1/projects/${d.project.id}`]);
    const backup = v2BackupSchema.parse(JSON.parse(await service.exportBackup()) as unknown);
    expect(backup.documents[0]?.viewPreferences.cameraY).toBe(500);
    expect(service.history()).toEqual({ canUndo: false, canRedo: false });
    await expect(service.undo()).rejects.toThrow("не поддерживается");
  });
  it("does not let an older overlapping read erase an acknowledged revision", async () => {
    let d = document(), unlock: (() => void) | undefined;
    const gate = new Promise<void>((done) => { unlock = done; }); let first = true;
    const api: RequestApi = async (path, method, body) => {
      if (method === "POST") { d = { ...d, project: { ...d.project, revision: 1 } }; return result(body); }
      if (path === "/api/v1/workspaces/current") return { workspace: { id: WORKSPACE_ID, revision: 1 }, role: "owner" };
      if (path === "/api/v1/people") return { workspaceId: WORKSPACE_ID, revision: 0, people: [], retiredAssignments: [] };
      if (path.includes("limit=")) {
        const snapshot = d;
        if (first) { first = false; await gate; }
        return { projects: [{ project: snapshot.project }], workspaceRevision: 1, nextOffset: null };
      }
      return d;
    };
    const service = new RemoteCommandService("race", api, storage());
    const reading = service.screen(d.project.id);
    await service.execute(service.envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "New" }));
    unlock?.();
    const latest = await reading;
    expect(latest.active?.project.revision).toBe(1); expect(latest.documents[0]?.project.revision).toBe(1);
  });
  it("does not turn a confirmed ACK into a failed write when draft cleanup becomes unavailable", async () => {
    const store = storage(), d = document(); let blocked = false;
    const service = new RemoteCommandService("cleanup", (_path, _method, body) => { blocked = true; return Promise.resolve(result(body)); }, {
      ...store, setItem: (key, value) => { if (blocked) throw Error("blocked"); store.setItem(key, value); },
      removeItem: (key) => { if (blocked) throw Error("blocked"); store.removeItem(key); },
    });
    await expect(service.execute(service.envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "Confirmed" }))).resolves.toBeUndefined();
    expect(service.getState().pending).toBe(false); expect(service.getState().sending).toBe(false);
    expect(service.getState().message).toContain("Сервер подтвердил");
    expect(new RemoteCommandService("cleanup", undefined, store).getState().pending).toBe(true); // Durable old ID remains safely retryable.
  });
  it("loads only lightweight pages, people and the selected detail; exposes no fake undo or import", async () => {
    const d = document(), paths: string[] = [];
    const api: RequestApi = (path) => {
      paths.push(path);
      return Promise.resolve(path === "/api/v1/workspaces/current" ? { workspace: { id: WORKSPACE_ID, revision: 1 }, role: "owner" }
        : path === "/api/v1/people" ? { workspaceId: WORKSPACE_ID, revision: 0, people: [], retiredAssignments: [] }
        : path.includes("limit=") ? { projects: [{ project: d.project }], workspaceRevision: 1, nextOffset: null } : d);
    };
    const service = new RemoteCommandService("one", api, storage());
    expect((await service.screen(null)).active).toBeNull();
    expect(paths).not.toContain(`/api/v1/projects/${d.project.id}`);
    expect((await service.screen(d.project.id)).active).toEqual(d);
    expect(service.history()).toEqual({ canUndo: false, canRedo: false });
    await expect(service.undo()).rejects.toThrow("не поддерживается");
    await expect(service.importBackup()).rejects.toThrow("не поддерживается");
  });
});
