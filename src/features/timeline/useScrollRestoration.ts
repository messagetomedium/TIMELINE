import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** A measured calendar width does not imply that its flex scroll viewport is ready. */
export function useScrollRestoration(body: RefObject<HTMLDivElement | null>, initialY: number, ready: boolean, active: boolean) {
  const done = useRef(false);
  const [restored, setRestored] = useState(false);
  const complete = useCallback(() => {
    done.current = true;
    setRestored(true);
  }, []);
  useLayoutEffect(() => {
    // Navigation takes precedence, including a gesture before the first measurement.
    if (active && !done.current) complete();
  }, [active, complete]);
  useLayoutEffect(() => {
    if (!ready || restored || done.current) return;
    const node = body.current;
    if (!node) return;
    let frame: number | undefined;
    const schedule = () => {
      if (!done.current && frame === undefined) frame = requestAnimationFrame(apply);
    };
    const apply = () => {
      frame = undefined;
      if (done.current || node.clientHeight === 0) return;
      const height = node.clientHeight, contentHeight = node.scrollHeight;
      const target = Math.max(0, Math.min(initialY, contentHeight - height));
      node.scrollTop = target;
      // WebKit can clamp an early assignment during layout. Verify the actual
      // position and geometry on the next frame before enabling persistence.
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (done.current) return;
        if (node.clientHeight === height && node.scrollHeight === contentHeight && Math.abs(node.scrollTop - target) < 1) complete();
        else schedule();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    // Native scroll/pointer navigation must never be overwritten by a late restore.
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) node.addEventListener(event, complete, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) node.removeEventListener(event, complete);
    };
  }, [body, initialY, ready, restored, complete]);
  return restored;
}
