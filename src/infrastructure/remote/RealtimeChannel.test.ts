import { afterEach, expect, it, vi } from "vitest";
import { EventFrames, acceptChange, watchRealtime } from "./RealtimeChannel";
import { WORKSPACE_ID } from "../../domain/v2/model";
import { changeSchema } from "../../application/v2/collaborationContracts";

const change = (sequence: number) => ({ sequence, workspaceId: WORKSPACE_ID, projectId: null, commandId: null, revision: sequence, workspaceRevision: sequence, peopleRevision: 0 });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("parses split CRLF frames, ignores heartbeats and bounds partial messages", () => {
  const frames = new EventFrames();
  expect(frames.push(': heartbeat\r')).toEqual([]);
  expect(frames.push('\n\r\nevent: change\r\nid: 1\r\ndata: ' + JSON.stringify(change(1)) + '\r')).toEqual([]);
  expect(frames.push('\n\r\n')).toEqual([{ event: "change", id: "1", data: change(1) }]);
  expect(() => new EventFrames().push("x".repeat(4097))).toThrow("buffer");
  expect(() => changeSchema.parse({ ...change(1), contacts: "private" })).toThrow();
});
it("deduplicates old/reordered events and rejects missing sequence or foreign scope", () => {
  expect(acceptChange(4, change(4))).toBe(false); expect(acceptChange(4, change(2))).toBe(false);
  expect(acceptChange(4, change(5))).toBe(true); expect(() => acceptChange(4, change(6))).toThrow("gap");
  expect(() => acceptChange(0, { ...change(1), workspaceId: crypto.randomUUID() })).toThrow();
});
it("resyncs after a gap and reconnects from the new snapshot cursor without replaying duplicates", async () => {
  vi.useFakeTimers(); vi.stubGlobal("window", new EventTarget()); vi.stubGlobal("navigator", { onLine: true });
  const changes: number[] = [], statuses: string[] = [], urls: string[] = [], resync = vi.fn(() => Promise.resolve(4));
  let calls = 0;
  const source: typeof fetch = vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); calls++;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      init?.signal?.addEventListener("abort", () => { controller.error(new DOMException("Aborted", "AbortError")); });
      const values = calls === 1 ? [1, 1, 3] : [5];
      controller.enqueue(new TextEncoder().encode(values.map((n) => `id: ${String(n)}\nevent: change\ndata: ${JSON.stringify(change(n))}\n\n`).join("") + 'event: ready\ndata: {"sequence":5}\n\n'));
    } });
    return Promise.resolve(new Response(stream, { headers: { "Content-Type": "text/event-stream", "X-Timeline-User": "alice" } }));
  });
  const stop = watchRealtime({ userId: "alice", sequence: 0, resync, change: (c) => { changes.push(c.sequence); }, status: (s) => { statuses.push(s); }, fetch: source });
  try {
    await vi.advanceTimersByTimeAsync(510);
    expect(resync).toHaveBeenCalledOnce(); expect(urls).toEqual(["/api/v1/realtime/events?after=0", "/api/v1/realtime/events?after=4"]);
    expect(changes).toEqual([1, 5]); expect(statuses.at(-1)).toBe("live");
  } finally { stop(); await vi.advanceTimersByTimeAsync(0); }
});
it.each([401, 403])("stops after HTTP %i and does not reconnect or expose data from another session", async (status) => {
  vi.useFakeTimers(); const target = new EventTarget(); vi.stubGlobal("window", target); vi.stubGlobal("navigator", { onLine: true });
  const source = vi.fn<typeof fetch>(() => Promise.resolve(new Response("{}", { status }))), changed = vi.fn(), states: string[] = [];
  const stop = watchRealtime({ userId: "alice", sequence: 0, resync: () => Promise.resolve(0), change: changed, status: (s) => { states.push(s); }, fetch: source });
  try { await vi.advanceTimersByTimeAsync(60_000); target.dispatchEvent(new Event("offline")); expect(source).toHaveBeenCalledOnce(); expect(states.at(-1)).toBe("denied"); expect(changed).not.toHaveBeenCalled(); }
  finally { stop(); }
});
