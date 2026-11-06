import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { positionAtX } from "../../domain/SegmentAxis";
import { xForDate, zoomCamera } from "../../domain/timeline";
import type { TimelineCamera } from "../../domain/timeline";

const clamp = (n: number, limit: number) => Math.max(-limit, Math.min(limit, Number.isFinite(n) ? n : 0));
export function wheelNavigation(event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "shiftKey" | "ctrlKey" | "metaKey">, pageHeight: number) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, pageHeight) : 1;
  const x = clamp(event.deltaX * unit, 2000), y = clamp(event.deltaY * unit, 2000);
  return event.ctrlKey || event.metaKey ? { x: 0, y: 0, scale: Math.exp(-clamp(y, 100) * 0.01) }
    : { x: event.shiftKey ? x || y : x, y: event.shiftKey ? 0 : y, scale: 1 };
}
/** A fixed-width result column has no date. Keep its chosen boundary in place, without snapping the column to the pointer. */
export function zoomAtPointer(camera: TimelineCamera, scale: number, x: number) {
  const hit = positionAtX(x, camera);
  return zoomCamera(camera, scale, hit.kind === "resultGap" ? xForDate(hit.boundary, camera) : x);
}
type GestureEvent = Event & { scale: number; clientX: number; clientY: number };
interface Options {
  surface: RefObject<HTMLDivElement | null>;
  viewport: RefObject<HTMLDivElement | null>;
  body: RefObject<HTMLDivElement | null>;
  camera: TimelineCamera;
  setCamera: (camera: TimelineCamera) => void;
  blocked?: () => boolean;
  onIdle?: (camera: TimelineCamera, scrollTop: number) => void;
  startPan?: (event: ReactPointerEvent) => void;
}
const excluded = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],.toolbar-dock,.editor-heading,.section-gutter';

/** Canvas-local browser navigation only. No commands, content preview or shared preferences. */
export function useCanvasNavigation(options: Options) {
  const latest = useRef(options), camera = useRef(options.camera), space = useRef(false);
  const [active, setActive] = useState(false);
  useLayoutEffect(() => { latest.current = options; camera.current = options.camera; });
  const eligible = useCallback((target: EventTarget | null, x: number, y: number) => {
    const o = latest.current, bounds = o.viewport.current?.getBoundingClientRect(), host = o.surface.current?.getBoundingClientRect();
    return !!bounds && !!host && target instanceof Element && !target.closest(excluded)
      && x >= bounds.left && x < Math.min(bounds.right, host.right) && y >= bounds.top && y < host.bottom;
  }, []);
  useEffect(() => {
    const surface = options.surface.current, body = options.body.current;
    if (!surface || !body) return;
    let frame: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    let pending: TimelineCamera | undefined, dy = 0, native = false, nativeBlocked = false, lastScale = 1, ignoreWheelUntil = 0;
    const flush = () => {
      frame = undefined;
      const o = latest.current;
      if (!o.blocked?.()) {
        if (pending && (pending.pxPerDay !== camera.current.pxPerDay || pending.panX !== camera.current.panX || pending.originDate !== camera.current.originDate)) { camera.current = pending; o.setCamera(pending); }
        if (dy) body.scrollTop += dy;
      }
      pending = undefined; dy = 0;
    };
    const idle = () => {
      clearTimeout(timer); timer = undefined;
      if (frame !== undefined) { cancelAnimationFrame(frame); flush(); }
      setActive(false);
      if (!latest.current.blocked?.()) latest.current.onIdle?.(camera.current, body.scrollTop);
    };
    const scheduleIdle = () => { clearTimeout(timer); timer = setTimeout(idle, 150); };
    const queue = (next: TimelineCamera, scroll: number) => {
      pending = next; dy = clamp(dy + scroll, 4000); setActive(true);
      if (frame === undefined) frame = requestAnimationFrame(flush);
      scheduleIdle();
    };
    const wheel = (event: WheelEvent) => {
      if (!eligible(event.target, event.clientX, event.clientY)) return;
      // Consume navigation during pointer preview; the gesture keeps its original camera/dates.
      event.preventDefault();
      if (latest.current.blocked?.() || native || (event.ctrlKey || event.metaKey) && performance.now() < ignoreWheelUntil) return;
      const change = wheelNavigation(event, body.clientHeight), current = pending ?? camera.current;
      const x = event.clientX - (latest.current.viewport.current?.getBoundingClientRect().left ?? 0);
      const next = change.scale === 1 ? { ...current, panX: clamp(current.panX - change.x, 20000) } : zoomAtPointer(current, change.scale, x);
      if (change.x || change.y || change.scale !== 1) queue(next, change.y);
    };
    const gestureStart = (event: Event) => {
      const e = event as GestureEvent;
      if (!eligible(e.target, e.clientX, e.clientY)) return;
      e.preventDefault();
      native = true; nativeBlocked = latest.current.blocked?.() ?? false;
      lastScale = Number.isFinite(e.scale) && e.scale > 0 ? e.scale : 1;
    };
    const gestureChange = (event: Event) => {
      const e = event as GestureEvent;
      if (!native) return;
      e.preventDefault();
      if (!Number.isFinite(e.scale) || e.scale <= 0) return;
      const scale = e.scale / lastScale; lastScale = e.scale;
      if (nativeBlocked || latest.current.blocked?.()) return;
      const x = e.clientX - (latest.current.viewport.current?.getBoundingClientRect().left ?? 0);
      queue(zoomAtPointer(pending ?? camera.current, scale, x), 0);
    };
    const gestureEnd = (event: Event) => {
      if (!native) return;
      gestureChange(event); native = false; ignoreWheelUntil = performance.now() + 100; idle();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { native = false; space.current = false; idle(); }
      if (event.code === "Space" && !event.altKey && !event.ctrlKey && !event.metaKey && latest.current.startPan && surface.matches(":hover")
        && event.target instanceof Element && !event.target.closest(`${excluded},button,a`)) { space.current = true; event.preventDefault(); }
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === "Space") space.current = false; };
    const blur = () => { space.current = false; native = false; idle(); };
    const scroll = () => { scheduleIdle(); };
    const safariGestures = "ongesturestart" in window || "GestureEvent" in window;
    surface.addEventListener("wheel", wheel, { passive: false });
    if (safariGestures) {
      surface.addEventListener("gesturestart", gestureStart, { passive: false });
      surface.addEventListener("gesturechange", gestureChange, { passive: false });
      // Finish a pinch that began here even when its last event is outside the canvas.
      window.addEventListener("gestureend", gestureEnd, { passive: false });
    }
    body.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("keydown", keyDown); window.addEventListener("keyup", keyUp); window.addEventListener("blur", blur); window.addEventListener("pagehide", blur);
    return () => {
      surface.removeEventListener("wheel", wheel);
      surface.removeEventListener("gesturestart", gestureStart); surface.removeEventListener("gesturechange", gestureChange); window.removeEventListener("gestureend", gestureEnd);
      body.removeEventListener("scroll", scroll);
      window.removeEventListener("keydown", keyDown); window.removeEventListener("keyup", keyUp); window.removeEventListener("blur", blur); window.removeEventListener("pagehide", blur);
      clearTimeout(timer); if (frame !== undefined) cancelAnimationFrame(frame);
      // Never apply queued navigation or write stale parent preferences after a mode/account switch.
    };
  }, [options.surface, options.viewport, options.body, eligible]);
  const onPointerDownCapture = (event: ReactPointerEvent) => {
    if (space.current && event.button === 0 && eligible(event.target, event.clientX, event.clientY)) latest.current.startPan?.(event);
  };
  return { active, onPointerDownCapture };
}
