import { describe, expect, it } from "vitest";
import { SessionPresentation } from "./SessionPresentation";
import { RemoteCommandService } from "./RemoteCommandService";
import { createTemplate } from "../../domain/v2/template";
import { dateOnly } from "../../domain";
const doc = () => createTemplate("View", "", dateOnly("2026-11-01"), () => crypto.randomUUID(), new Date().toISOString());
const storage = () => {
  const rows = new Map<string, string>();
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
};
describe("session presentation boundary", () => {
  it("restores view and workspace UI in one tab, isolates users/projects and prunes deleted expansions", () => {
    const store = storage(), a = doc(), b = doc(), first = new SessionPresentation("alice", store);
    const processId = a.processes[0]?.id; if (!processId) throw Error("Fixture missing process");
    first.saveView(a.project.id, { ...a.viewPreferences, cameraY: 123, expandedProcessIds: [processId] });
    first.saveWorkspace({ version: 1, mode: "timeline", portfolio: { camera: null, step: "2w", showWeekends: false } });
    expect(new SessionPresentation("alice", store).view(a).cameraY).toBe(123);
    expect(new SessionPresentation("alice", store).workspace().mode).toBe("timeline");
    expect(new SessionPresentation("bob", store).view(a).cameraY).toBe(0);
    expect(new SessionPresentation("bob", store).workspace().mode).toBe("cards");
    expect(first.view(b).cameraY).toBe(0);
    expect(first.view({ ...a, processes: [] }).expandedProcessIds).toEqual([]);
    expect(() => { first.saveView(b.project.id, a.viewPreferences); }).toThrow();
  });
  it("ignores malformed/out-of-scope preferences; unavailable UI storage never blocks content recovery", async () => {
    const store = storage(), d = doc();
    store.setItem(`timeline-ui-v1:alice:${d.project.id}`, '{"version":100}');
    const one = new SessionPresentation("alice", store);
    expect(one.view(d).cameraY).toBe(0);
    const failing = { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("quota"); }, removeItem: () => undefined };
    const memory = new SessionPresentation("alice", failing);
    expect(() => { memory.saveView(d.project.id, { ...d.viewPreferences, cameraY: 42 }); }).not.toThrow();
    expect(memory.view(d).cameraY).toBe(42);
    const service = new RemoteCommandService("alice", undefined, store);
    service.rememberDraft("Название", "Не потерять");
    for (let i = 0; i < 500; i++) await service.saveView(d.project.id, { ...d.viewPreferences, cameraY: i });
    expect(service.getState().sending).toBe(false); expect(service.getState().pending).toBe(false);
    expect(new RemoteCommandService("alice", undefined, store).getState().drafts).toEqual({ Название: "Не потерять" });
    expect(new SessionPresentation("alice", store).view(d).cameraY).toBe(499);
  });
  it("migrates an old view-only pending record locally without HTTP or deleting content input", async () => {
    const store = storage(), d = doc(); let requests = 0;
    store.setItem("timeline-api-draft-v1:alice", JSON.stringify({ pending: { kind: "view", projectId: d.project.id, body: { workspaceId: d.project.workspaceId, value: { ...d.viewPreferences, cameraY: 321 } } }, drafts: { Описание: "Мой ввод" } }));
    const service = new RemoteCommandService("alice", () => { requests++; return Promise.resolve(null); }, store);
    expect(service.getState().pending).toBe(false); await service.retry();
    expect(requests).toBe(0); expect(service.getState().drafts).toEqual({ Описание: "Мой ввод" });
    expect(new SessionPresentation("alice", store).view(d).cameraY).toBe(321);
  });
});
