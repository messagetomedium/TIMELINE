import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { box, create, current, documents, entity, home, saved } from "./helpers";

async function wheel(target: Locator, dx: number, dy: number, modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}, focus = 220) {
  return target.evaluate((el, data) => {
    const rect = el.getBoundingClientRect();
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: rect.left + data.focus, clientY: rect.top + 10, deltaX: data.dx, deltaY: data.dy, ...data.modifiers });
    el.dispatchEvent(event); return event.defaultPrevented;
  }, { dx, dy, modifiers, focus });
}
async function camera(target: Locator) {
  return { zoom: Number(await target.getAttribute("data-px-per-day")), x: Number(await target.getAttribute("data-pan-x")) };
}
async function nativeGesture(viewport: Locator, type: string, scale: number) {
  return viewport.evaluate((el, data) => {
    const rect = el.getBoundingClientRect(), event = new Event(data.type, { bubbles: true, cancelable: true });
    Object.assign(event, { scale: data.scale, clientX: rect.left + 100, clientY: rect.top + 10 });
    (data.type === "gestureend" ? window : el).dispatchEvent(event); return event.defaultPrevented;
  }, { type, scale });
}
test.use({ viewport: { width: 1440, height: 640 } });
test.beforeEach(async ({ page }) => {
  // Safari signal path is exercised synthetically in both engines, including duplicate Ctrl+wheel.
  await page.addInitScript(() => { if (!("ongesturestart" in window)) Object.defineProperty(window, "ongesturestart", { value: null, configurable: true }); });
  await page.goto("./");
});
test("trackpad: diagonal pan, anchored pinch including result gaps, coalescing and F5 keep content untouched", async ({ page }) => {
  await create(page); const before = await current(page), scene = page.getByRole("main", { name: "Редактор таймлайна" });
  await page.getByRole("button", { name: "Уменьшить масштаб", exact: true }).click();
  await page.getByRole("button", { name: "Уменьшить масштаб", exact: true }).click();
  const viewport = page.locator('.calendar-time'), body = page.getByLabel("Производственный план", { exact: true });
  await viewport.scrollIntoViewIfNeeded();
  const start = await camera(scene), bounds = await box(viewport);
  await page.mouse.move(bounds.x + 220, bounds.y + 10); await page.mouse.wheel(24, 50);
  await expect.poll(async () => (await camera(scene)).x).toBeCloseTo(start.x - 24, 5);
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBe(50);
  const anchor = 220, beforePinch = await camera(scene);
  const datePosition = (anchor - beforePinch.x) / beforePinch.zoom;
  await wheel(viewport, 0, -20, { ctrlKey: true }, anchor);
  await expect.poll(async () => (await camera(scene)).zoom).toBeGreaterThan(beforePinch.zoom);
  let c = await camera(scene); expect((anchor - c.x) / c.zoom).toBeCloseTo(datePosition, 8);
  await wheel(viewport, 0, 20, { metaKey: true }, anchor);
  await expect.poll(async () => (await camera(scene)).zoom).toBeCloseTo(beforePinch.zoom, 8);
  expect((await camera(scene)).x).toBeCloseTo(beforePinch.x, 8);
  await page.getByRole("button", { name: "Результаты", exact: true }).click();
  const gap = page.locator('.result-calendar-gap').first(), viewportBounds = await box(viewport);
  const gapBounds = await box(gap);
  await wheel(viewport, gapBounds.x + 30 - viewportBounds.x - 100, 0);
  await expect.poll(async () => (await box(gap)).x).toBeCloseTo(viewportBounds.x + 70, 5);
  const focus = 100, oldLeft = (await box(gap)).x, gapZoom = (await camera(scene)).zoom;
  await wheel(viewport, 0, -12, { ctrlKey: true }, focus);
  await expect.poll(async () => (await camera(scene)).zoom).toBeGreaterThan(gapZoom);
  await expect.poll(async () => (await box(gap)).x).toBeCloseTo(oldLeft, 5);
  await wheel(viewport, 0, 12, { ctrlKey: true }, focus);
  await expect.poll(async () => (await camera(scene)).zoom).toBeCloseTo(gapZoom, 8);
  await expect.poll(async () => (await box(gap)).x).toBeCloseTo(oldLeft, 5);
  const prior = await camera(scene);
  const native = (type: string, scale: number) => nativeGesture(viewport, type, scale);
  expect(await native("gesturestart", 1)).toBe(true); await native("gesturechange", 1.2);
  await wheel(viewport, 0, -30, { ctrlKey: true });
  await native("gestureend", 1.2);
  await expect.poll(async () => (await camera(scene)).zoom).toBeCloseTo(prior.zoom * 1.2, 8); // no double signal
  c = await camera(scene);
  const pan = c.x;
  const updates = await viewport.evaluate(async el => {
    const r = el.getBoundingClientRect();
    let count = 0, resolveFirst: (() => void) | undefined;
    const firstChange = new Promise<void>(resolve => { resolveFirst = resolve; });
    const observer = new MutationObserver(records => { count += records.length; resolveFirst?.(); });
    const scene = el.closest('main'); if (!scene) throw Error("Missing scene");
    observer.observe(scene, { attributes: true, attributeFilter: ['data-pan-x'] });
    try {
      for (let i = 0; i < 40; i++) el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: r.left + 100, clientY: r.top + 10, deltaX: .5, deltaY: .25 }));
      // WebKit can schedule its first frame beyond 75 ms on a busy CI runner.
      // Wait for an actual camera mutation, then two frames to catch extra commits.
      await Promise.race([
        firstChange,
        new Promise<never>((_, reject) => { setTimeout(() => { reject(Error("Batched pan produced no camera update")); }, 3000); }),
      ]);
      await new Promise<void>(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
      return count;
    } finally { observer.disconnect(); }
  });
  expect(updates).toBe(1);
  await expect.poll(async () => (await camera(scene)).x).toBeCloseTo(pan - 20, 5);
  await page.waitForTimeout(200);
  const final = await camera(scene), y = await body.evaluate(el => el.scrollTop);
  expect(y).toBeGreaterThan(0);
  const persistedY = () => page.evaluate(id => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("timeline-workspace-v2");
    request.onerror = () => { reject(Error("Preferences DB unavailable")); };
    request.onsuccess = () => {
      const db = request.result, read = db.transaction("preferences").objectStore("preferences").get(`editor:${id}`);
      read.onerror = () => { db.close(); reject(Error("Preferences read failed")); };
      read.onsuccess = () => { const row = read.result as { value?: { cameraY?: number } } | undefined; db.close(); resolve(row?.value?.cameraY ?? -1); };
    };
  }), before.project.id);
  await expect.poll(persistedY).toBe(y); // Prove that F5 starts with the nonzero saved preference.
  expect(await current(page)).toEqual(before);
  await page.reload(); await saved(page);
  expect((await camera(scene)).zoom).toBeCloseTo(final.zoom, 8); expect((await camera(scene)).x).toBeCloseTo(final.x, 8);
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBe(y);
  expect(await persistedY()).toBe(y);
  const navigatedY = y - 15;
  await body.evaluate((el, next) => { el.scrollTop = next; }, navigatedY);
  await page.setViewportSize({ width: 1420, height: 640 });
  await expect.poll(persistedY).toBe(navigatedY);
  expect(await body.evaluate(el => el.scrollTop)).toBe(navigatedY); // Later layout must not restore over user navigation.
});
test("trackpad: clicks, inline rename, Space pan and wheel during captured edit preserve command boundaries", async ({ page }) => {
  await create(page); const d = await current(page), process = d.processes[0]; if (!process) throw Error("Missing process");
  const bar = entity(page, process.id), scene = page.getByRole("main", { name: "Редактор таймлайна" }), viewport = page.locator('.calendar-time');
  await bar.click(); await expect(bar).toHaveAttribute("data-selected", "true");
  await bar.click({ button: "right" }); expect((await current(page)).project.revision).toBe(0);
  await bar.locator('.bar-title').dblclick();
  const input = page.getByLabel("Название на полосе", { exact: true });
  expect(await wheel(input, 0, -20, { ctrlKey: true }, 10)).toBe(false);
  await input.fill("Имя трекпадом"); await input.press("Enter"); await page.locator('h1').click(); await saved(page);
  expect((await current(page)).project.revision).toBe(1);
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  const inspector = page.getByLabel("Название", { exact: true }), oldCamera = await camera(scene);
  expect(await wheel(inspector, 0, -20, { ctrlKey: true }, 10)).toBe(false); expect(await camera(scene)).toEqual(oldCamera);
  const handle = bar.locator('.move-handle');
  for (const control of [handle, bar.locator('.resize-handle.end')]) {
    const bounds = await box(control);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 8); await page.mouse.down();
    await wheel(viewport, 30, 50); await wheel(viewport, 0, -20, { ctrlKey: true });
    expect(await nativeGesture(viewport, "gesturestart", 1)).toBe(true);
    expect(await nativeGesture(viewport, "gesturechange", 1.3)).toBe(true);
    await nativeGesture(viewport, "gestureend", 1.3);
    await page.keyboard.press("Escape"); await page.mouse.up();
    expect(await camera(scene)).toEqual(oldCamera); expect((await current(page)).project.revision).toBe(1);
  }
  await page.getByRole("button", { name: "+ Процесс", exact: true }).click();
  const dialog = page.getByRole("dialog");
  expect(await wheel(dialog.locator('input').first(), 0, -20, { ctrlKey: true }, 10)).toBe(false);
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await bar.click(); // Space pan also works after normal selection leaves keyboard focus on a bar.
  const h = await box(handle); await page.mouse.move(h.x + h.width / 2, h.y + 8);
  await page.keyboard.down("Space"); await page.mouse.down(); await page.mouse.move(h.x + h.width / 2 + 35, h.y + 8); await page.mouse.up(); await page.keyboard.up("Space");
  await expect.poll(async () => (await camera(scene)).x).toBeCloseTo(oldCamera.x + 35, 5);
  expect((await current(page)).project.revision).toBe(1);
  await page.getByRole("button", { name: "Отменить", exact: true }).click(); await saved(page);
  expect((await current(page)).processes[0]?.title).toBe(process.title); // navigation added no content Undo
});
test("trackpad: portfolio pan and pinch persist locally without shifting projects", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  await create(page); const before = await current(page); await home(page);
  await page.getByRole("button", { name: "Таймлайн", exact: true }).click();
  const scene = page.getByLabel("Общий таймлайн проектов", { exact: true }), viewport = scene.locator('.calendar-time');
  const start = await camera(scene);
  await wheel(viewport, 0, 24, { shiftKey: true }); await wheel(viewport, 0, 30); await wheel(viewport, 0, -15, { ctrlKey: true });
  await expect.poll(async () => (await camera(scene)).zoom).toBeGreaterThan(start.zoom);
  await page.waitForTimeout(200); const final = await camera(scene);
  expect(await scene.locator('.portfolio-body').evaluate(el => el.scrollTop)).toBe(30);
  expect(final.x).not.toBe(start.x);
  await page.reload(); await saved(page); expect(await camera(scene)).toEqual(final);
  expect(await scene.locator('.portfolio-body').evaluate(el => el.scrollTop)).toBe(30);
  expect(await documents(page)).toEqual([before]);
  // Switching mode before the idle timer fires must never restore stale "timeline" preferences.
  const x = (await camera(scene)).x; await wheel(viewport, 1, 0);
  await expect.poll(async () => (await camera(scene)).x).toBeCloseTo(x - 1, 5);
  await page.getByRole("button", { name: "Карточки", exact: true }).click();
  await expect(scene).toHaveCount(0); await expect(page.locator('.saved-project-card')).toHaveCount(1);
});

for (const mode of ["editor", "portfolio"] as const) {
  test(`trackpad: ${mode} restores the saved view after delayed scroll layout without saving zero`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 500 });
    await create(page); const before = await current(page);
    if (mode === "portfolio") {
      await home(page); await page.getByRole("button", { name: "Таймлайн", exact: true }).click();
    }
    const selector = mode === "editor" ? ".timeline-body" : ".portfolio-body";
    const scene = mode === "editor" ? page.getByRole("main", { name: "Редактор таймлайна" }) : page.getByLabel("Общий таймлайн проектов", { exact: true });
    const body = page.locator(selector), viewport = scene.locator('.calendar-time');
    const key = mode === "editor" ? `editor:${before.project.id}` : "workspace";
    const persistedY = () => page.evaluate(key => new Promise<number>((resolve, reject) => {
      const request = indexedDB.open("timeline-workspace-v2");
      request.onerror = () => { reject(Error("Preferences DB unavailable")); };
      request.onsuccess = () => {
        const db = request.result, read = db.transaction("preferences").objectStore("preferences").get(key);
        read.onerror = () => { db.close(); reject(Error("Preferences read failed")); };
        read.onsuccess = () => {
          const row = read.result as { value?: { cameraY?: number; portfolio?: { cameraY?: number } } } | undefined;
          db.close(); resolve(row?.value?.cameraY ?? row?.value?.portfolio?.cameraY ?? -1);
        };
      };
    }), key);
    await wheel(viewport, 24, 30); await wheel(viewport, 0, -15, { ctrlKey: true });
    await expect(body).toHaveJSProperty("scrollTop", 30);
    await expect.poll(persistedY).toBe(30);
    const final = await camera(scene);
    // Calendar width is measurable while the scroll viewport is still unlaid out.
    // This deterministically exposes the Safari race instead of extending timeouts.
    await page.addInitScript(selector => {
      const style = document.createElement("style"); style.id = "delayed-scroll-layout";
      style.textContent = `${selector} { display: none !important; }`;
      document.addEventListener("DOMContentLoaded", () => { document.head.append(style); }, { once: true });
    }, selector);
    await page.reload(); await saved(page); await expect(body).toBeAttached();
    await body.evaluate(async el => {
      await new Promise<void>(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
      if (el.clientHeight !== 0) throw Error("Delayed layout fixture must not have a scroll viewport yet");
    });
    expect(await persistedY()).toBe(30);
    await page.evaluate(() => { document.getElementById("delayed-scroll-layout")?.remove(); });
    await expect(body).toHaveJSProperty("scrollTop", 30);
    expect(await camera(scene)).toEqual(final);
    await body.evaluate(el => { el.scrollTop = 15; });
    await page.setViewportSize({ width: 1420, height: 500 });
    await expect.poll(persistedY).toBe(15);
    expect(await body.evaluate(el => el.scrollTop)).toBe(15);
    expect(await documents(page)).toEqual([before]);
  });
}
