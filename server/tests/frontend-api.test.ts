import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, expect as browserExpect } from "@playwright/test";
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
  await browserExpect(page.getByRole("status")).toContainText("Письмо подтверждения отправлено");
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
    await browserExpect(page.getByRole("status")).toContainText("письмо со ссылкой восстановления отправлено");
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
    const stale = await read(id);
    const command = { commandId: randomUUID(), version: 1, workspaceId: stale.project.workspaceId, projectId: id, expectedRevision: stale.project.revision,
      command: { type: "Describe", kind: "project", id, value: "Из другого устройства" } };
    expect((await page.request.post(`${origin}/api/v1/projects/${id}/commands`, { headers: { origin }, data: command })).status()).toBe(200);
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
