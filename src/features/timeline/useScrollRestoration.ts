import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** A measured calendar width does not imply that its flex scroll viewport is ready. */
export function useScrollRestoration(body: RefObject<HTMLDivElement | null>, initialY: number, active: boolean) {
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
    if (restored || done.current) return;
    const node = body.current;
    if (!node) return;
    let frame: number | undefined;
    let applied: { y: number; height: number; contentHeight: number } | undefined;
    const schedule = () => {
      if (!done.current && frame === undefined) frame = requestAnimationFrame(apply);
    };
    const apply = () => {
      frame = undefined;
      if (done.current || node.clientHeight === 0) return;
      if (!applied && node.scrollTop !== 0) { complete(); return; }
      const height = node.clientHeight, contentHeight = node.scrollHeight;
      const target = Math.max(0, Math.min(initialY, contentHeight - height));
      applied = { y: target, height, contentHeight };
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
    const scrolled = () => {
      // A different nonzero position with unchanged geometry is navigation, not
      // our own scroll event or WebKit clamping against an unfinished layout.
      if (node.scrollTop > 0 && (!applied || Math.abs(node.scrollTop - applied.y) >= 1
        && node.clientHeight === applied.height && node.scrollHeight === applied.contentHeight)) complete();
    };
    node.addEventListener("scroll", scrolled, { passive: true });
    // Native scroll/pointer navigation must never be overwritten by a late restore.
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) node.addEventListener(event, complete, { passive: true });
    // When layout is already usable, restore in this layout effect: consumers
    // must not observe an extra zero-position frame while data is ready.
    apply();
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      node.removeEventListener("scroll", scrolled);
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) node.removeEventListener(event, complete);
    };
  }, [body, initialY, restored, complete]);
  return restored;
}
