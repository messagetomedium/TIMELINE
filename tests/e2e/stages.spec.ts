import { expect, test } from "@playwright/test";
import { required } from "../../src/testing/required";
import { create, current, saved, drag, scale, entity } from "./helpers";
import type { Page } from "@playwright/test";
function content(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(content);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .filter(
          ([k]) => !["revision", "updatedAt", "viewPreferences"].includes(k),
        )
        .map(([k, x]) => [k, content(x)]),
    );
  return v;
}
async function undo(page: Page, redo = false) {
  await page
    .getByRole("button", { name: redo ? "Повторить" : "Отменить", exact: true })
    .click();
  await saved(page);
}
async function applyDate(page: Page, label: string, date: string) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(date);
  await field
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Применить", exact: true })
    .click();
  await saved(page);
}
async function stage(page: Page, name = "Этап 1") {
  await page
    .getByRole("button", { name: `Этап: ${name}`, exact: true })
    .click();
}
async function confirm(page: Page) {
  await page
    .getByRole("dialog", { name: "Подтверждение операции с этапом" })
    .getByRole("button", { name: "Подтвердить", exact: true })
    .click();
  await saved(page);
}
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await create(page, "Этапы");
});
test("insert before first, between and after last has atomic undo/redo, stable ID and survives refresh", async ({
  page,
}) => {
  const source = await current(page);
  for (const button of [
    "Вставить этап перед: Этап 1",
    "Вставить этап перед: Этап 2",
    "Вставить этап в конец",
  ]) {
    await page.getByRole("button", { name: button, exact: true }).click();
    const form = page.getByRole("dialog", { name: "Вставка этапа" });
    await form.getByLabel("Название этапа").fill("Дополнительный");
    await form.getByLabel("Длительность, дней").fill("1");
    await form
      .getByRole("button", { name: "Вставить этап", exact: true })
      .click();
    await saved(page);
    const inserted = await current(page);
    expect(inserted.stages).toHaveLength(3);
    expect(inserted.project.endDateExclusive).toBe("2026-11-17");
    expect(inserted.checkpoints).toEqual(source.checkpoints);
    await undo(page);
    expect(content(await current(page))).toEqual(content(source));
    await undo(page, true);
    expect(content(await current(page))).toEqual(content(inserted));
    await undo(page);
  }
  await page.reload();
  await expect(page.locator(".stage-region")).toHaveCount(2);
  expect(content(await current(page))).toEqual(content(source));
});
test("cancel and invalid insertion leave the project untouched", async ({
  page,
}) => {
  const d = await current(page);
  await page
    .getByRole("button", { name: "Вставить этап в конец", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Длительность, дней").fill("0");
  await form
    .getByRole("button", { name: "Вставить этап", exact: true })
    .click();
  await expect(form).toBeVisible();
  expect(await current(page)).toEqual(d);
  await form.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(await current(page)).toEqual(d);
});
test("clear and delete restore exact content by one undo, normalize view IDs, and persist", async ({
  page,
}) => {
  const d = await current(page);
  await stage(page);
  await page
    .getByRole("button", { name: "Очистить этап", exact: true })
    .click();
  await confirm(page);
  let n = await current(page);
  expect(
    n.processes.filter((p) => p.stageId === required(d.stages[0]).id),
  ).toHaveLength(1);
  expect(n.tasks).toHaveLength(4);
  expect(n.project.endDateExclusive).toBe(d.project.endDateExclusive);
  await undo(page);
  expect(content(await current(page))).toEqual(content(d));
  await stage(page);
  await page.getByRole("button", { name: "Удалить этап", exact: true }).click();
  await confirm(page);
  n = await current(page);
  expect(n.stages).toHaveLength(1);
  expect(n.project.startDate).toBe("2026-11-02");
  expect(n.project.endDateExclusive).toBe("2026-11-09");
  expect(n.checkpoints).toEqual(d.checkpoints);
  await undo(page);
  expect(content(await current(page))).toEqual(content(d));
  await undo(page, true);
  await page.reload();
  await stage(page, "Этап 2");
  await expect(
    page.getByRole("button", { name: "Удалить этап", exact: true }),
  ).toBeDisabled();
  expect((await current(page)).tasks).toHaveLength(4);
});
test("merge preserves both descriptions and all dates and restores both stages through undo", async ({
  page,
}) => {
  await stage(page);
  await page.getByLabel("Описание", { exact: true }).fill("Первое описание");
  await page.getByLabel("Описание", { exact: true }).press("Tab");
  await saved(page);
  await stage(page, "Этап 2");
  await page.getByLabel("Описание", { exact: true }).fill("Второе описание");
  await page.getByLabel("Описание", { exact: true }).press("Tab");
  await saved(page);
  const before = await current(page);
  await page
    .getByRole("button", { name: "Объединить с предыдущим", exact: true })
    .click();
  await confirm(page);
  const n = await current(page);
  expect(n.stages).toHaveLength(1);
  expect(required(n.stages[0]).title).toBe("Этап 1");
  expect(required(n.stages[0]).description).toContain(
    "Первое описание\n\n—\n\nВторое описание",
  );
  expect(n.tasks).toEqual(before.tasks);
  expect(n.processes.map((p) => [p.startDate, p.endDateExclusive])).toEqual(
    before.processes.map((p) => [p.startDate, p.endDateExclusive]),
  );
  await undo(page);
  expect(content(await current(page))).toEqual(content(before));
  await undo(page, true);
  await page.reload();
  await expect(page.locator(".process-bar")).toHaveCount(4);
});
test("boundary input and drag use the same plan with full preview, no intermediate write and one undo", async ({
  page,
}) => {
  const d = await current(page);
  await stage(page, "Этап 2");
  await applyDate(page, "Начало этапа", "2026-11-11");
  const byForm = await current(page);
  expect(required(byForm.processes[2]).startDate).toBe("2026-11-11");
  await undo(page);
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  const handle = page.getByRole("button", {
    name: "Перенести границу: Этап 2",
    exact: true,
  });
  await drag(page, handle, (await scale(page)) * 2, false);
  expect(content(await current(page))).toEqual(content(d));
  await expect(page.locator(".stage-affected")).toHaveCount(2);
  await expect(page.getByLabel("Начало этапа",{exact:true})).toHaveValue("2026-11-11");
  await expect(entity(page, required(d.processes[2]).id)).toHaveAttribute(
    "data-start",
    "2026-11-11",
  );
  await expect(
    page.getByRole("button", { name: "Этап: Этап 2", exact: true }),
  ).toContainText("11.11.2026");
  await page.mouse.up();
  await saved(page);
  expect(content(await current(page))).toEqual(content(byForm));
  await undo(page);
  expect(content(await current(page))).toEqual(content(d));
});
test("boundary slack exhausts minimally and anchor follows the new project end; invalid and canceled drags do not write", async ({
  page,
}) => {
  const source = await current(page);
  await page
    .getByRole("button", { name: "Чекпойнт: Дедлайн", exact: true })
    .click();
  await page.getByLabel("Привязать к дате окончания проекта").check();
  await page.getByRole("button", { name: "Сохранить чекпойнт" }).click();
  await saved(page);
  const d = await current(page);
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  const handle = page.getByRole("button", {
    name: "Перенести границу: Этап 2",
    exact: true,
  });
  await drag(page, handle, (await scale(page)) * 5, false);
  await expect(page.locator(".checkpoint-line")).toHaveAttribute(
    "data-date",
    "2026-11-17",
  );
  expect(await current(page)).toEqual(d);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await current(page)).toEqual(d);
  await drag(page, handle, (await scale(page)) * -5);
  await expect(page.getByRole("alert")).toContainText("предыдущего этапа");
  expect(await current(page)).toEqual(d);
  await drag(page, handle, (await scale(page)) * 5);
  await saved(page);
  expect((await current(page)).project.endDateExclusive).toBe("2026-11-18");
  expect(required((await current(page)).tasks[4]).startDate).toBe("2026-11-14");
  await undo(page);
  expect(content(await current(page))).toEqual(content(d));
  expect(required(source.checkpoints[0]).timing.anchor).toBe("free");
});
test("project resize keeps work dates and free checkpoint; camera remains stable across refresh after left expansion", async ({
  page,
}) => {
  const d = await current(page);
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  const bar = entity(page, required(d.processes[0]).id);
  const x = required(await bar.boundingBox()).x;
  await applyDate(page, "Начало проекта", "2026-10-30");
  expect((await current(page)).processes).toEqual(d.processes);
  expect((await current(page)).checkpoints).toEqual(d.checkpoints);
  await saved(page);
  await page.reload();
  await expect(bar).toBeVisible();
  expect(required(await bar.boundingBox()).x).toBeCloseTo(x, 1);
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await applyDate(page, "Окончание проекта включительно", "2026-11-18");
  expect((await current(page)).project.endDateExclusive).toBe("2026-11-19");
  expect((await current(page)).tasks).toEqual(d.tasks);
  await applyDate(page, "Окончание проекта включительно", "2026-11-03");
  await expect(page.getByRole("alert")).toBeVisible();
  expect((await current(page)).project.endDateExclusive).toBe("2026-11-19");
});
test("stale structural command fails rather than deleting newer work", async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  await other.goto(page.url());
  await stage(other);
  await other.getByLabel("Описание", { exact: true }).fill("Из другой вкладки");
  await other.getByLabel("Описание", { exact: true }).press("Tab");
  await saved(other);
  await stage(page);
  await page.getByRole("button", { name: "Удалить этап", exact: true }).click();
  await confirm(page);
  await expect(page.getByRole("alert")).toContainText("другой вкладке");
  expect((await current(page)).stages).toHaveLength(2);
  expect(required((await current(page)).stages[0]).description).toBe(
    "Из другой вкладки",
  );
  await other.close();
});
