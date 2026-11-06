import { changeSchema, counterSchema } from "../../application/v2/collaborationContracts";
import type { Change } from "../../application/v2/collaborationContracts";
import { WORKSPACE_ID } from "../../domain/v2/model";
import { ApiError } from "./ApiClient";

export class EventFrames {
  private buffer = "";
  push(text: string) {
    this.buffer = (this.buffer + text).replace(/\r\n/g, "\n");
    const frames: { event: string; id: string; data: unknown }[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf("\n\n")) >= 0) {
      const frame = this.buffer.slice(0, boundary); this.buffer = this.buffer.slice(boundary + 2);
      if (frame.length > 4096) throw Error("Invalid event frame");
      let event = "message", id = ""; const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        if (line.startsWith("id: ")) id = line.slice(4);
        if (line.startsWith("data: ")) data.push(line.slice(6));
      }
      if (data.length) frames.push({ event, id, data: JSON.parse(data.join("\n")) as unknown });
    }
    if (this.buffer.length > 4096) throw Error("Invalid event buffer");
    return frames;
  }
}
export function acceptChange(current: number, change: Change) {
  if (change.workspaceId !== WORKSPACE_ID) throw new ApiError(403, "STREAM_SCOPE");
  if (change.sequence <= current) return false;
  if (change.sequence !== current + 1) throw Error("Event sequence gap");
  return true;
}
export type SyncState = "connecting" | "live" | "offline" | "denied";
/** Native fetch SSE: explicit 401/403, bounded frames and inactivity watchdog. */
export function watchRealtime(options: {
  userId: string; sequence: number; resync: () => Promise<number>; change: (value: Change) => void; status: (value: SyncState) => void;
  fetch?: typeof fetch;
}) {
  let stopped = false, cursor = options.sequence, controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined, resync = false, backoff = 500;
  const isStopped = () => stopped;
  const source = options.fetch ?? fetch;
  const loop = async () => {
    while (!isStopped()) {
      try {
        if (typeof navigator !== "undefined" && !navigator.onLine) throw new ApiError(0, "OFFLINE");
        options.status("connecting");
        if (resync) { cursor = await options.resync(); resync = false; }
        if (isStopped()) return;
        controller = new AbortController();
        let watchdog = setTimeout(() => { controller?.abort(); }, 15_000);
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
          const response = await source(`/api/v1/realtime/events?after=${String(cursor)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { Accept: "text/event-stream" } });
          if (!response.ok) throw new ApiError(response.status, "STREAM_UNAVAILABLE");
          if (response.headers.get("X-Timeline-User") !== options.userId) throw new ApiError(401, "STREAM_IDENTITY");
          if (!response.headers.get("Content-Type")?.startsWith("text/event-stream") || !response.body) throw Error("Missing event stream");
          reader = response.body.getReader(); const frames = new EventFrames(), decoder = new TextDecoder();
          while (!isStopped()) {
            const part = await reader.read(); if (part.done) break;
            clearTimeout(watchdog); watchdog = setTimeout(() => { controller?.abort(); }, 15_000);
            for (const frame of frames.push(decoder.decode(part.value, { stream: true }))) {
              if (isStopped()) return;
              if (frame.event === "access-denied") throw new ApiError(403, "STREAM_DENIED");
              if (frame.event === "reset" || frame.event === "unavailable") throw Error("Resync required");
              if (frame.event === "ready") { options.status("live"); backoff = 500; }
              if (frame.event !== "change") continue;
              const change = changeSchema.parse(frame.data);
              if (counterSchema.parse(Number(frame.id)) !== change.sequence) throw Error("Invalid event id");
              if (acceptChange(cursor, change)) { cursor = change.sequence; options.change(change); }
            }
          }
          throw Error("Event stream disconnected");
        } finally { clearTimeout(watchdog); controller.abort(); await reader?.cancel().catch(() => undefined); }
      } catch (e) {
        if (isStopped()) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { options.status("denied"); stopped = true; detach(); return; }
        options.status("offline"); resync = true;
        await new Promise<void>((resolve) => { wake = resolve; timer = setTimeout(resolve, backoff); });
        backoff = Math.min(5000, backoff * 2);
      }
    }
  };
  const reconnect = () => { controller?.abort(); clearTimeout(timer); wake?.(); };
  const offline = () => { options.status("offline"); reconnect(); };
  const detach = () => { window.removeEventListener("online", reconnect); window.removeEventListener("offline", offline); };
  window.addEventListener("online", reconnect); window.addEventListener("offline", offline);
  void loop();
  return () => { stopped = true; reconnect(); detach(); };
}
