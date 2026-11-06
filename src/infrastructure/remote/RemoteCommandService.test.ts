import { describe, expect, it, vi } from "vitest";
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
  it("an older receipt after reconnect never reduces workspace revision or rebases another stale field", async () => {
    const old = document(), current = { ...old, project: { ...old.project, revision: 2 } }, writes: { path: string; body: unknown }[] = [];
    const api: RequestApi = (path, method, body) => {
      if (method === "POST") { writes.push({ path, body }); return Promise.resolve({ ...result(body, 1), projectId: current.project.id, workspaceRevision: path === "/api/v1/projects" ? 6 : 1 }); }
      return Promise.resolve(path === "/api/v1/workspaces/current" ? { workspace: { id: WORKSPACE_ID, revision: 5 }, role: "owner" }
        : path === "/api/v1/people" ? { workspaceId: WORKSPACE_ID, revision: 0, people: [], retiredAssignments: [] }
        : path.includes("limit=") ? { projects: [{ project: current.project }], workspaceRevision: 5, nextOffset: null } : current);
    };
    const service = new RemoteCommandService("old-receipt", api, storage()); await service.screen(current.project.id);
    const e = service.envelope(old, { type: "Rename", kind: "project", id: old.project.id, value: "Receipt" });
    await service.execute(e); await service.executeLocal({ ...e, commandId: crypto.randomUUID() });
    await service.create({ type: "CreateProject", name: "Next", description: "", startDate: dateOnly("2026-11-02") });
    expect(writes[1]?.body).toMatchObject({ expectedRevision: 0 }); expect(writes[2]?.body).toMatchObject({ expectedRevision: 5 });
  });
  it("renews only an outstanding leased command and never reports success before its ACK", async () => {
    vi.useFakeTimers();
    const d = document(), lease = { id: crypto.randomUUID(), fence: 1, expiresAt: new Date(Date.now() + 20_000).toISOString(), baseRevision: 0 };
    let acknowledge: ((value: unknown) => void) | undefined; const renewals: unknown[] = [];
    const api: RequestApi = (path, _method, body) => {
      if (path.endsWith("/leases")) return Promise.resolve({ lease });
      if (path.endsWith("/renew")) { renewals.push(body); return Promise.resolve({ lease }); }
      if (path.endsWith("/commands")) return new Promise((resolve) => { acknowledge = resolve; });
      return Promise.resolve({ released: true });
    };
    try {
      const service = new RemoteCommandService("renew", api, storage(), true), e = service.envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "ACK" });
      const saving = service.execute(e); await vi.advanceTimersByTimeAsync(6000);
      expect(renewals).toEqual([{ commandId: e.commandId, fence: 1 }]); expect(service.getState()).toMatchObject({ pending: true, sending: true });
      acknowledge?.(result(e)); await saving; await vi.advanceTimersByTimeAsync(12_000);
      expect(renewals).toHaveLength(1); expect(service.getState()).toMatchObject({ pending: false, sending: false });
    } finally { vi.useRealTimers(); }
  });
  it("never rebases a queued stale field over a revision jump that includes another actor", async () => {
    const d = document(), requests: unknown[] = [];
    const service = new RemoteCommandService("jump", (_path, _method, body) => { requests.push(body); return Promise.resolve(result(body, 3)); }, storage());
    const e = service.envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "First" });
    await service.execute(e); await service.executeLocal({ ...e, commandId: crypto.randomUUID(), command: { ...e.command, type: "Rename", kind: "project", id: d.project.id, value: "Queued" } });
    expect(requests[1]).toMatchObject({ expectedRevision: 0 });
  });
  it("persists lease proof beside the original envelope and retries an uncertain ACK with identical commandId/body", async () => {
    const store = storage(), d = document(), bodies: unknown[] = [], headers: unknown[] = []; let attempts = 0;
    const api: RequestApi = (path, _method, body, options) => {
      if (path.endsWith("/leases")) return Promise.resolve({ lease: { id: crypto.randomUUID(), fence: 7, expiresAt: new Date(Date.now() + 20_000).toISOString(), baseRevision: 0 } });
      if (path.endsWith("/commands")) {
        bodies.push(body); headers.push(options?.headers); attempts++;
        expect(store.getItem("timeline-api-draft-v1:leased")).toContain('"fence":7');
        return attempts === 1 ? Promise.reject(new ApiError(0, "UNAVAILABLE")) : Promise.resolve(result(body));
      }
      return Promise.resolve({ released: true });
    };
    const first = new RemoteCommandService("leased", api, store, true), e = first.envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "Keep" });
    await expect(first.execute(e)).rejects.toThrow(); const resumed = new RemoteCommandService("leased", api, store, true); await resumed.retry();
    expect(bodies).toEqual([e, e]); expect(headers[0]).toEqual(headers[1]); expect(resumed.getState().pending).toBe(false);
  });
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
    const d = document(), requests: unknown[] = [], prepared: unknown[] = [], proofs: unknown[] = [];
    const api: RequestApi = (path, method, body, options) => {
      if (path.endsWith("/leases")) {
        prepared.push(body);
        return Promise.resolve({ lease: { id: crypto.randomUUID(), fence: prepared.length, expiresAt: new Date(Date.now() + 20_000).toISOString(), baseRevision: prepared.length === 1 ? 0 : 7 } });
      }
      if (method === "DELETE") return Promise.resolve({ released: true });
      if (path.endsWith("/commands")) proofs.push(options?.headers);
      if (method === "POST") { requests.push(body); return requests.length === 1 ? Promise.reject(new ApiError(409, "REVISION_CONFLICT")) : Promise.resolve(result(body, 8)); }
      expect(path).toBe(`/api/v1/projects/${d.project.id}`);
      return Promise.resolve({ ...d, project: { ...d.project, revision: 7 } });
    };
    const service = new RemoteCommandService("one", api, storage(), true);
    const e = service.envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "Моя правка" });
    await expect(service.execute(e)).rejects.toThrow("изменились");
    await expect(service.execute({ ...e, commandId: crypto.randomUUID() })).rejects.toThrow("Сначала разрешите");
    expect(requests).toHaveLength(1);
    await service.reapply();
    expect(requests[1]).toMatchObject({ ...e, commandId: (requests[1] as typeof e).commandId, expectedRevision: 7 });
    expect((requests[1] as typeof e).commandId).not.toBe(e.commandId);
    expect(prepared).toEqual(requests);
    expect(proofs[0]).toMatchObject({ "X-Timeline-Fence": "1" });
    expect(proofs[1]).toMatchObject({ "X-Timeline-Fence": "2" });
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
