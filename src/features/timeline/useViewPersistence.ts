import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { ProjectId, ViewPreferences } from "../../domain";
import { useScrollRestoration } from "./useScrollRestoration";

/** Frequent DOM scroll events update refs only. Flush one completed view locally. */
export function useViewPersistence(body: RefObject<HTMLDivElement | null>, initialY: number, view: Omit<ViewPreferences, "cameraY">, ready: boolean, active: boolean, save: (id: ProjectId, view: ViewPreferences) => void) {
  const y = useRef(initialY), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<(() => void) | undefined>(undefined), sent = useRef("");
  const restored = useScrollRestoration(body, initialY, ready, active);
  const flush = useCallback(() => {
    clearTimeout(timer.current); timer.current = undefined; latest.current?.();
  }, []);
  const onScroll = useCallback(() => {
    if (!restored) return;
    if (body.current) y.current = body.current.scrollTop;
    clearTimeout(timer.current); timer.current = setTimeout(flush, 120);
  }, [body, restored, flush]);
  useEffect(() => {
    latest.current = () => {
      if (!ready || !restored || active) return;
      const value = { ...view, cameraY: body.current?.scrollTop ?? y.current };
      const key = JSON.stringify(value);
      if (key === sent.current) return;
      sent.current = key; save(value.projectId, value);
    };
    flush();
  }, [view, body, ready, restored, active, save, flush]);
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => { flush(); window.removeEventListener("pagehide", flush); };
  }, [flush]);
  return onScroll;
}
