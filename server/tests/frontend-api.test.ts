import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, webkit, expect as browserExpect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { Pool, escapeIdentifier, escapeLiteral } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { createApp } from "../app";
import { readConfig } from "../config";
import { MemoryMailer } from "../mailer";
import { migrateDatabase } from "../db/migrate";
import { bootstrapOwner } from "../access";
import { connect } from "../db/connection";
import { snapshotSchema } from "../../src/domain/v2/model";
import { create as createLocal, current as currentLocal } from "../../tests/e2e/helpers";

const password = "Temporary browser test password!";
const email = "frontend@example.test";
const role = `timeline_browser_${randomBytes(8).toString("hex")}`;
let admin: Pool, runtime: Awaited<ReturnType<typeof createApp>>, browser: Browser, context: BrowserContext, page: Page, mailer: MemoryMailer;
let origin: string, runtimeUrl: string;
async function login() {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}
async function saved() { await browserExpect(page.getByRole("status", { name: "Состояние хранения" })).toHaveText("Сохранено на сервере"); }
async function registerOwner() {
  await page.goto(origin);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByLabel("Имя", { exact: true }).fill("Тест интерфейса");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
  await browserExpect(page.getByRole("status")).toContainText("Запрос подтверждения принят");
  const url = mailer.messages.findLast((m) => m.to === email && m.subject.includes("подтверждение"))?.text;
  if (!url) throw Error("Verification mail missing");
  await page.goto(url);
  await browserExpect(page.getByRole("status")).toContainText("Email подтверждён");
  const operator = connect(admin.options.connectionString ?? "");
  try { await operator.db.transaction((db) => bootstrapOwner(db, email)); }
  finally { await operator.pool.end(); }
  await login();
  await browserExpect(page.getByRole("heading", { name: "Проекты", exact: true })).toBeVisible();
  await saved();
}
async function createProject() {
  await page.getByRole("button", { name: "+ Новый проект", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Название проекта", { exact: true }).fill("Серверный проект");
  await browserExpect(page.getByRole("dialog").getByLabel("Название проекта", { exact: true })).toHaveValue("Серверный проект");
  await page.getByLabel("Начальная дата").fill("2026-11-02");
  await page.getByRole("button", { name: "Создать проект", exact: true }).click();
  await browserExpect(page.getByRole("main", { name: "Редактор таймлайна" })).toBeVisible();
  await saved();
  return page.url().split("/").at(-1) ?? "";
}
async function read(id: string) {
  const response = await page.request.get(`${origin}/api/v1/projects/${id}`);
  expect(response.status()).toBe(200);
  return snapshotSchema.parse(await response.json() as unknown);
}
async function nameField() {
  await page.getByRole("button", { name: "Этап: Этап 1", exact: true }).click();
  return page.getByLabel("Название", { exact: true });
}

async function renderProbe(targetContext: BrowserContext) {
  await targetContext.addInitScript(() => {
        interface Fiber { child: Fiber | null; sibling: Fiber | null; return: Fiber | null; stateNode?: unknown; memoizedState?: unknown; alternate: Fiber | null; tag: number }
        const probe = { commits: 0, appRenders: 0, saving: 0, panning: false };
        const target = window as unknown as { __timelineProbe: typeof probe; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
        target.__timelineProbe = probe;
        target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, inject: () => 1, onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
          probe.commits++;
          const find = (node: Fiber | null): Fiber | null => {
            if (!node) return null;
            if (node.stateNode instanceof Element && node.stateNode.classList.contains("app-shell")) return node.return;
            return find(node.child) ?? find(node.sibling);
          };
          let component = find(root.current);
          while (component && component.tag !== 0) component = component.return;
          if (component && (!component.alternate || component.memoizedState !== component.alternate.memoizedState)) probe.appRenders++;
        } };
        new MutationObserver(() => {
          const status = document.querySelector('[aria-label="Состояние хранения"]');
          if (/Сохраняется|Запись выполняется/.test(status?.textContent ?? "")) probe.saving++;
        }).observe(document, { subtree: true, childList: true, characterData: true });
      });
}

describe("V2.0A browser with real PostgreSQL", () => {
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith("_test")) throw Error("Only isolated TEST_DATABASE_URL *_test is allowed");
    admin = new Pool({ connectionString: url });
    await migrateDatabase(admin);
    const appPassword = randomBytes(32).toString("base64url");
    await admin.query(`create role ${escapeIdentifier(role)} login password ${escapeLiteral(appPassword)} nosuperuser nocreatedb nocreaterole nobypassrls`);
    await admin.query(`grant usage on schema public, drizzle to ${escapeIdentifier(role)}`);
    await admin.query(`grant select, insert, update, delete on all tables in schema public to ${escapeIdentifier(role)}`);
    await admin.query(`grant select on all tables in schema drizzle to ${escapeIdentifier(role)}`);
    const appUrl = new URL(url); appUrl.username = role; appUrl.password = appPassword; runtimeUrl = appUrl.toString();
    const socket = createServer(); await new Promise<void>((done) => { socket.listen(0, "127.0.0.1", done); });
    const address = socket.address(); if (!address || typeof address === "string") throw Error("Missing test port");
    origin = `http://127.0.0.1:${String(address.port)}`; await new Promise<void>((done) => { socket.close(() => { done(); }); });
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  });
  beforeEach(async () => {
    await admin.query("truncate table auth_users, auth_verifications, auth_rate_limits cascade");
    mailer = new MemoryMailer();
    runtime = await createApp(readConfig({ DATABASE_URL: runtimeUrl, BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), APP_ORIGIN: origin, NODE_ENV: "test", STATIC_ROOT: resolve("dist"), MAILER_MODE: "memory" }), mailer);
    await runtime.app.listen({ port: Number(new URL(origin).port), host: "127.0.0.1" });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); page = await context.newPage();
    page.on("dialog", (dialog) => { void dialog.accept(); });
  });
  afterEach(async () => { await context.close(); await runtime.app.close(); });
  afterAll(async () => {
    await browser.close();
    { await admin.query(`drop owned by ${escapeIdentifier(role)}`); await admin.query(`drop role ${escapeIdentifier(role)}`); await admin.end(); }
  });
  for (const engine of ["chromium", "webkit"] as const) {
    it(`V2.0C ${engine}: 60s local view, bounded command reads, UI timings and durable content recovery`, async () => {
      await page.setViewportSize({ width: 1440, height: 640 });
      const extra = engine === "webkit" ? await webkit.launch({ headless: true }) : null;
      if (extra) { await context.close(); context = await extra.newContext({ viewport: { width: 1440, height: 640 } }); page = await context.newPage(); page.on("dialog", (d) => { void d.accept(); }); }
      await renderProbe(context);
      const writes: { url: string; body: string }[] = [], reads: string[] = [];
      page.on("request", (request) => {
        if (!request.url().includes("/api/v1/")) return;
        if (request.method() === "GET") reads.push(request.url());
        else writes.push({ url: request.url(), body: request.postData() ?? "" });
      });
      try {
        await registerOwner(); const id = await createProject();
        // Expand actual rows and use a short real viewport so both engines can scroll.
        for (const toggle of await page.locator('.process-bar .expand-handle').all()) await toggle.click();
        const expand = page.getByRole("button", { name: /^Раскрыть:/ });
        for (const toggle of await expand.all()) await toggle.click();
        const body = page.getByLabel("Производственный план", { exact: true });
        await browserExpect(body).toBeVisible();
        await page.getByRole("button", { name: "Увеличить масштаб", exact: true }).click();
        await page.getByLabel("Шаг", { exact: true }).selectOption("2w");
        await page.waitForTimeout(250);
        expect((await page.evaluate(() => (window as unknown as { __timelineProbe: { appRenders: number } }).__timelineProbe.appRenders))).toBeGreaterThan(0);
        writes.length = 0; reads.length = 0;
        const scrolling = page.evaluate(async () => {
          const el = document.querySelector<HTMLDivElement>('.timeline-body');
          if (!el || el.scrollHeight <= el.clientHeight) throw Error("Fixture requires native vertical scrolling");
          const probe = (window as unknown as { __timelineProbe: { commits: number; appRenders: number; saving: number; panning: boolean } }).__timelineProbe;
          probe.commits = 0; probe.appRenders = 0; probe.saving = 0;
          const panning = () => probe.panning;
          const started = performance.now(); let frames = 0, drift = 0;
          while (performance.now() - started < 60_000) {
            if (panning()) { await new Promise<void>((done) => { requestAnimationFrame(() => { done(); }); }); continue; }
            const wanted = (frames % 40) / 39 * (el.scrollHeight - el.clientHeight);
            el.scrollTop = wanted;
            await new Promise<void>((done) => { requestAnimationFrame(() => { requestAnimationFrame(() => { done(); }); }); });
            if (!panning() && Math.abs(el.scrollTop - wanted) > 1.5) drift++;
            frames++;
          }
          return { milliseconds: performance.now() - started, frames, drift, ...probe };
        });
        for (let turn = 0; turn < 6; turn++) {
          await page.waitForTimeout(8_000);
          await page.evaluate(() => { (window as unknown as { __timelineProbe: { panning: boolean } }).__timelineProbe.panning = true; });
          const bounds = await body.boundingBox(); if (!bounds) throw Error("Missing scroll viewport");
          const editor = page.getByRole("main", { name: "Редактор таймлайна" });
          const pan = await editor.getAttribute("data-pan-x");
          const x = bounds.x + 176 + (bounds.width - 176) / 2, y = bounds.y + 40;
          await page.mouse.move(x, y); await page.mouse.down({ button: "middle" });
          await page.mouse.move(x + (turn % 2 ? 70 : -70), y, { steps: 8 }); await page.mouse.up({ button: "middle" });
          expect(await editor.getAttribute("data-pan-x")).not.toBe(pan);
          await page.evaluate(() => { (window as unknown as { __timelineProbe: { panning: boolean } }).__timelineProbe.panning = false; });
        }
        const scrollResult = await scrolling;
        expect(scrollResult.milliseconds).toBeGreaterThanOrEqual(60_000); expect(scrollResult.frames).toBeGreaterThan(100);
        expect(scrollResult.drift).toBe(0); expect(scrollResult.appRenders).toBe(0); expect(scrollResult.saving).toBe(0);
        await page.waitForTimeout(200);
        expect(writes).toHaveLength(0); expect(reads).toHaveLength(0);
        const y = await body.evaluate((el) => el.scrollTop);
        await page.reload(); await saved();
        await browserExpect(body).toHaveJSProperty("scrollTop", y);
        await browserExpect(page.getByLabel("Шаг", { exact: true })).toHaveValue("2w");
        expect((await read(id)).project.revision).toBe(0);
        process.stdout.write(`V2.0C ${engine} scroll ${JSON.stringify(scrollResult)}\n`);
      } finally { if (extra) await extra.close(); }
    }, 180_000);
    it(`V2.0C ${engine}: measurements of confirmed content actions`, async () => {
      await page.setViewportSize({ width: 1440, height: 640 });
      const extra = engine === "webkit" ? await webkit.launch({ headless: true }) : null;
      if (extra) { await context.close(); context = await extra.newContext({ viewport: { width: 1440, height: 640 } }); page = await context.newPage(); }
      await renderProbe(context);
      const writes: { url: string; body: string }[] = [], reads: string[] = [];
      page.on("request", (r) => {
        if (!r.url().includes("/api/v1/")) return;
        if (r.method() === "GET") reads.push(r.url()); else writes.push({ url: r.url(), body: r.postData() ?? "" });
      });
      try {
        await registerOwner(); const id = await createProject();
        for (const toggle of await page.locator('.process-bar .expand-handle').all()) await toggle.click();
        const body = page.getByLabel("Производственный план", { exact: true });
        await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
        const timings: Record<string, number[]> = { rename: [], date: [], checkpoint: [], move: [] };
        const requestCounts: Record<string, number[]> = {};
        const renders: Record<string, { commits: number; appRenders: number }[]> = {};
        const measure = async (kind: keyof typeof timings, operation: () => Promise<void>) => {
          writes.length = 0; reads.length = 0;
          await page.evaluate(() => {
            const probe = (window as unknown as { __timelineProbe: { commits: number; appRenders: number } }).__timelineProbe;
            probe.commits = 0; probe.appRenders = 0;
          });
          const started = performance.now(); await operation(); await saved();
          timings[kind]?.push(performance.now() - started);
          (renders[kind] ??= []).push(await page.evaluate(() => {
            const probe = (window as unknown as { __timelineProbe: { commits: number; appRenders: number } }).__timelineProbe;
            return { commits: probe.commits, appRenders: probe.appRenders };
          }));
          (requestCounts[kind] ??= []).push(writes.length + reads.length);
          expect(writes, `${kind}: one content request`).toHaveLength(1); expect(reads, `${kind}: one project refresh`).toHaveLength(1);
          expect(writes[0]?.url).toContain("/commands"); expect(reads[0]).toContain(`/projects/${id}`);
        };
        await page.getByRole("button", { name: "Этап: Этап 1", exact: true }).click();
        for (let n = 0; n < 5; n++) {
          await measure("rename", async () => {
            await page.getByLabel("Название", { exact: true }).fill(`Этап ${String(n)}`);
            await page.getByLabel("Название", { exact: true }).press("Enter");
          });
          await measure("checkpoint", async () => { await page.getByRole("button", { name: "+ Чекпойнт", exact: true }).click(); });
          const field = page.getByLabel("Дата чекпойнта");
          await measure("date", async () => { await field.focus(); await field.press("ArrowLeft"); await field.fill(`2026-11-${String(20 + n)}`); await field.press("Enter"); });
          // The same UI command boundary is used by task drag; exercise the actual pointer below.
          const task = page.locator('.task-bar').first(); await body.evaluate((el) => { el.scrollTop = 0; });
          const box = await task.boundingBox(); if (!box) throw Error("Missing task after expansion");
          const handle = task.locator('.move-handle'); const handleBox = await handle.boundingBox();
          if (!handleBox) throw Error("Missing drag handle");
          const px = Number(await page.getByRole("main", { name: "Редактор таймлайна" }).getAttribute("data-px-per-day"));
          await measure("move", async () => {
            await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
            await page.mouse.down(); await page.mouse.move(handleBox.x + handleBox.width / 2 + px * (n % 2 ? -1.9 : 2.1), handleBox.y + handleBox.height / 2, { steps: 8 }); await page.mouse.up();
          });
        }
        const stats = Object.fromEntries(Object.entries(timings).map(([kind, values]) => {
          const ordered = [...values].sort((a, b) => a - b);
          return [kind, { samples: values.length, p50ms: Math.round(ordered[Math.floor(ordered.length * .5)] ?? 0), p95ms: Math.round(ordered[Math.ceil(ordered.length * .95) - 1] ?? 0), requests: requestCounts[kind], renders: renders[kind] }];
        }));
        process.stdout.write(`V2.0C ${engine} measurements ${JSON.stringify({ operations: stats })}\n`);
      } finally { if (extra) await extra.close(); }
    }, 60_000);
  }
  it("registers, verifies, signs in; saves edits once and restores projects after reload; resets password and signs out", async () => {
    await registerOwner();
    const id = await createProject(), before = await read(id);
    const field = await nameField(); await field.fill("Сохранённый этап"); await field.press("Enter"); await saved();
    const after = await read(id);
    expect(after.project.revision).toBe(before.project.revision + 1);
    expect(after.stages.some((s) => s.title === "Сохранённый этап")).toBe(true);
    await page.reload(); await saved();
    expect((await read(id)).stages).toEqual(after.stages);
    await browserExpect(page.getByRole("button", { name: "Отменить", exact: true })).toHaveCount(0);
    const process = after.processes[0]; if (!process) throw Error("Process missing");
    await page.locator(`[data-entity-id="${process.id}"]`).click();
    await page.getByRole("checkbox", { name: "Неактивно", exact: true }).click(); await saved();
    await page.getByLabel("Начало работы", { exact: true }).fill("01.10.2026");
    await page.getByLabel("Начало работы", { exact: true }).press("Enter"); await saved();
    expect((await read(id)).processes.find((p) => p.id === process.id)).toMatchObject({ isActive: false, startDate: "2026-10-01" });
    await page.getByRole("button", { name: "Чекпойнт: Дедлайн", exact: true }).click();
    const checkpointDate = page.getByLabel("Дата чекпойнта");
    await checkpointDate.focus(); await checkpointDate.press("ArrowLeft"); await checkpointDate.fill("2026-11-20"); await checkpointDate.press("Enter"); await saved();
    expect((await read(id)).checkpoints[0]?.timing).toEqual({ anchor: "free", date: "2026-11-20" });
    await page.getByRole("button", { name: "Исполнители", exact: true }).click();
    await page.getByRole("button", { name: "Добавить исполнителя", exact: true }).click();
    const person = page.getByRole("dialog", { name: "Новый исполнитель", exact: true });
    await person.getByLabel("Имя", { exact: true }).fill("Анна");
    await person.getByRole("button", { name: "Сохранить карточку", exact: true }).click(); await saved();
    const catalog: unknown = await (await page.request.get(`${origin}/api/v1/people`)).json();
    expect(catalog).toMatchObject({ revision: 1, people: [{ firstName: "Анна" }] });
    await page.getByRole("dialog", { name: "Исполнители пространства" }).getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.getByRole("button", { name: "Домой", exact: true }).click(); await saved();
    await page.getByLabel("Действия: Серверный проект", { exact: true }).click();
    await page.getByRole("menuitem", { name: "Дублировать", exact: true }).click(); await saved();
    await browserExpect(page.locator(".saved-project-card")).toHaveCount(2);
    await page.getByLabel("Действия: Серверный проект", { exact: true }).click();
    await page.getByRole("menuitem", { name: "Удалить", exact: true }).click();
    await page.getByRole("button", { name: "В архив", exact: true }).click(); await saved();
    await browserExpect(page.locator(".saved-project-card")).toHaveCount(1);
    expect((await read(id)).project.archivedAt).not.toBeNull();
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page.getByRole("button", { name: "Забыли пароль?" }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Отправить ссылку" }).click();
    await browserExpect(page.getByRole("status")).toContainText("запрос восстановления принят");
    const url = mailer.messages.findLast((m) => m.to === email && m.subject.includes("восстановление"))?.text;
    if (!url) throw Error("Reset mail missing");
    await page.goto(url);
    await browserExpect(page.getByRole("heading", { name: "Новый пароль" })).toBeVisible();
    expect(new URL(page.url()).search).toBe("");
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Изменить пароль" }).click();
    await login(); await saved();
  }, 60_000);
  it("retains an uncertain write through reload, retries one receipt, exposes conflicts and denied access without data loss", async () => {
    await registerOwner(); const id = await createProject();
    const before = await read(id), bodies: string[] = [];
    await page.route(`**/api/v1/projects/${id}/commands`, async (route) => {
      bodies.push(route.request().postData() ?? "");
      if (bodies.length === 1) { await route.fetch(); await route.abort("failed"); }
      else await route.continue();
    });
    let field = await nameField(); await field.fill("Не потерять"); await field.press("Enter");
    await browserExpect(page.getByRole("button", { name: "Повторить исходный запрос" })).toBeVisible();
    expect((await read(id)).project.revision).toBe(before.project.revision + 1);
    await page.reload();
    await page.getByRole("button", { name: "Повторить исходный запрос" }).click(); await saved();
    expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
    expect((await read(id)).project.revision).toBe(before.project.revision + 1);
    await page.unroute(`**/api/v1/projects/${id}/commands`);
    await page.getByRole("button", { name: "Этап: Не потерять", exact: true }).click();
    const other = await context.newPage();
    await other.goto(page.url());
    await browserExpect(other.getByRole("status", { name: "Состояние хранения" })).toHaveText("Сохранено на сервере");
    await other.getByLabel("Шаг", { exact: true }).selectOption("1mo");
    await browserExpect(page.getByLabel("Шаг", { exact: true })).toHaveValue("1w");
    await other.getByRole("button", { name: "Проект", exact: true }).click();
    await other.getByLabel("Описание", { exact: true }).fill("Из другого устройства");
    await other.getByLabel("Описание", { exact: true }).press("Enter");
    await browserExpect(other.getByRole("status", { name: "Состояние хранения" })).toHaveText("Сохранено на сервере");
    await other.close();
    field = page.getByLabel("Название", { exact: true }); await field.fill("После конфликта"); await field.press("Tab");
    await browserExpect(page.getByRole("button", { name: "Сверить конфликт" })).toBeVisible();
    await page.getByRole("button", { name: "Загрузить с сервера" }).click();
    await page.getByRole("button", { name: "Сверить конфликт" }).click();
    await page.getByRole("button", { name: "Подтвердить повтор к новой ревизии" }).click(); await saved();
    expect((await read(id)).project.description).toBe("Из другого устройства");
    await page.getByRole("button", { name: "Этап: После конфликта", exact: true }).click();
    await admin.query("update workspace_memberships set revoked_at = now() where user_id in (select id from auth_users where email = $1)", [email]);
    field = page.getByLabel("Название", { exact: true }); await field.fill("Сохранить при отказе доступа"); await field.press("Enter");
    await browserExpect(page.getByRole("alert")).toContainText("Нет доступа");
    await page.getByText("Сохранённый черновик", { exact: true }).click();
    const stored = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith("timeline-api-draft-v1:")));
    expect(JSON.stringify(stored)).toContain("Сохранить при отказе доступа");
  }, 60_000);
  it("V2.0C chromium: account switch isolates local view and 401 drafts; original command retries once", async () => {
    await registerOwner(); const id = await createProject();
    await page.getByRole("button", { name: "Увеличить масштаб", exact: true }).click();
    const zoom = await page.getByRole("main", { name: "Редактор таймлайна" }).getAttribute("data-px-per-day");
    const bobId = randomUUID(), name = "bob@example.test";
    const owner = await admin.query<{ id: string }>("select id from auth_users where email=$1", [email]);
    await admin.query("insert into auth_users(id,name,email,email_verified) values($1,'Bob',$2,true)", [bobId, name]);
    await admin.query("insert into auth_accounts(id,user_id,account_id,provider_id,password) select $1,$2,$2,provider_id,password from auth_accounts where user_id=$3 and provider_id='credential'", [randomUUID(), bobId, owner.rows[0]?.id]);
    await admin.query("insert into workspace_memberships(workspace_id,user_id,role) select id,$1,'admin' from workspaces", [bobId]);
    await page.request.post(`${origin}/api/auth/sign-out`, { headers: { origin }, data: {} });
    const sent: string[] = [];
    page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith(`/projects/${id}/commands`)) sent.push(r.postData() ?? ""); });
    const field = await nameField(); await field.fill("Черновик Alice"); await field.press("Enter");
    await browserExpect(page.getByRole("button", { name: "Войти снова", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Войти снова", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill(name); await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click(); await saved();
    await browserExpect(page.getByLabel("Несохранённая правка")).toHaveCount(0);
    expect(await page.getByRole("main", { name: "Редактор таймлайна" }).getAttribute("data-px-per-day")).not.toBe(zoom);
    expect((await read(id)).project.revision).toBe(0);
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await page.waitForTimeout(11_000); // The protected login endpoint limits one NAT IP.
    await login();
    await browserExpect(page.getByRole("button", { name: "Повторить исходный запрос", exact: true })).toBeVisible();
    expect(await page.getByRole("main", { name: "Редактор таймлайна" }).getAttribute("data-px-per-day")).toBe(zoom);
    await page.getByRole("button", { name: "Повторить исходный запрос", exact: true }).click(); await saved();
    expect(sent).toHaveLength(2); expect(sent[0]).toBe(sent[1]); expect((await read(id)).project.revision).toBe(1);
  }, 60_000);
  it("V2.0C chromium: a confirmed creation is not repeated when its follow-up read fails", async () => {
    await registerOwner(); let creates = 0;
    page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/api/v1/projects")) creates++; });
    await page.route("**/api/v1/projects?*", (route) => route.abort("failed"));
    await page.getByRole("button", { name: "+ Новый проект", exact: true }).click();
    await page.getByLabel("Название проекта", { exact: true }).fill("Подтверждено");
    await page.getByRole("button", { name: "Создать проект", exact: true }).click();
    await browserExpect(page.getByRole("dialog", { name: "Новый проект" })).toHaveCount(0);
    await browserExpect(page.getByRole("button", { name: "Загрузить с сервера", exact: true })).toBeVisible();
    expect(creates).toBe(1);
    expect((await admin.query<{ count: string }>("select count(*) from projects")).rows[0]?.count).toBe("1");
    await page.unroute("**/api/v1/projects?*");
    await page.getByRole("button", { name: "Загрузить с сервера", exact: true }).click(); await saved();
    await browserExpect(page.getByRole("main", { name: "Редактор таймлайна" })).toBeVisible(); expect(creates).toBe(1);
  }, 30_000);
  it("keeps existing local projects untouched when switching to server mode and back", async () => {
    await page.route(origin + "/", async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('name="timeline-storage" content="server"', 'name="timeline-storage" content="local"') }); });
    await page.goto(origin); const local = await createLocal(page, "Локальный проект");
    await page.unroute(origin + "/"); await page.reload();
    await browserExpect(page.getByRole("heading", { name: "Вход в TIMELINE" })).toBeVisible();
    expect(await currentLocal(page)).toEqual(local);
    await page.route(origin + "/", async (route) => { const response = await route.fetch(); await route.fulfill({ response, body: (await response.text()).replace('name="timeline-storage" content="server"', 'name="timeline-storage" content="local"') }); });
    await page.reload();
    await browserExpect(page.getByRole("main", { name: "Редактор таймлайна" })).toBeVisible();
    expect(await currentLocal(page)).toEqual(local);
  }, 60_000);
});
