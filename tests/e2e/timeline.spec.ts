import { required } from "../../src/testing/required";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  create,
  current,
  entity,
  rename,
  saved,
  drag,
  home,
  open,
  documents,
  scale,
} from "./helpers";
test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await create(page);
});
test("renames all four entity kinds and descriptions persist after refresh", async ({
  page,
}) => {
  const d = await current(page);
  await page.getByRole("button", { name: "Этап: Этап 1", exact: true }).click();
  await rename(page, "Подготовка");
  await page.getByLabel("Описание", { exact: true }).fill("Описание этапа");
  await page.getByLabel("Описание", { exact: true }).press("Tab");
  await saved(page);
  await entity(page, required(d.processes[0]).id).click();
  await rename(page, "Разработка");
  await entity(page, required(d.tasks[0]).id).click();
  await rename(page, "Первый шаг");
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await rename(page, "Новое имя");
  await page.reload();
  await expect(page.locator(".header-project")).toContainText("Новое имя");
  const next = await current(page);
  expect(required(next.stages[0]).title).toBe("Подготовка");
  expect(required(next.stages[0]).description).toBe("Описание этапа");
  expect(required(next.processes[0]).title).toBe("Разработка");
  expect(required(next.tasks[0]).title).toBe("Первый шаг");
});
test("Undo/Redo by button and keyboard stays per-project through navigation and clears redo on new command", async ({
  page,
}) => {
  const a = await current(page);
  await entity(page, required(a.processes[0]).id).click();
  await rename(page, "Имя А");
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await saved(page);
  expect(required((await current(page)).processes[0]).title).toBe("Процесс 1");
  await page.keyboard.press("Control+Shift+z");
  await saved(page);
  expect(required((await current(page)).processes[0]).title).toBe("Имя А");
  await home(page);
  const b = await create(page, "Другой");
  await entity(page, required(b.processes[0]).id).click();
  await rename(page, "Имя Б");
  await home(page);
  await open(page, "Нейтральный");
  await page.keyboard.press("Control+z");
  await saved(page);
  expect(required((await current(page)).processes[0]).title).toBe("Процесс 1");
  expect(
    required(
      required(
        (await documents(page)).find((x) => x.project.id === b.project.id),
      ).processes[0],
    ).title,
  ).toBe("Имя Б");
  await rename(page, "Новая ветка истории");
  await expect(
    page.getByRole("button", { name: "Повторить", exact: true }),
  ).toBeDisabled();
});
test("checkpoint title, free date, anchor, note and undo/redo persist correctly", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Чекпойнт: Дедлайн", exact: true })
    .click();
  await page.getByLabel("Название", { exact: true }).fill("Сдача");
  await page.getByLabel("Дата чекпойнта").fill("2026-11-20");
  await page.getByLabel("Заметка", { exact: true }).fill("Проверить");
  await page.getByRole("button", { name: "Сохранить чекпойнт" }).click();
  await saved(page);
  await expect(page.locator(".checkpoint-line")).toHaveAttribute(
    "data-date",
    "2026-11-20",
  );
  await page.getByLabel("Привязать к дате окончания проекта").check();
  await page.getByRole("button", { name: "Сохранить чекпойнт" }).click();
  await saved(page);
  await expect(page.locator(".checkpoint-line")).toHaveAttribute(
    "data-date",
    "2026-11-15",
  );
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await saved(page);
  await expect(page.locator(".checkpoint-line")).toHaveAttribute(
    "data-date",
    "2026-11-20",
  );
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await saved(page);
  await page.reload();
  await expect(page.locator(".checkpoint-line")).toHaveAttribute(
    "data-date",
    "2026-11-15",
  );
  expect(required((await current(page)).checkpoints[0]).note).toBe("Проверить");
});
test("focused text uses native undo without invoking project history", async ({
  page,
}) => {
  const d = await current(page);
  await rename(page, "Сохранено");
  const rev = (await current(page)).project.revision;
  const field = page.getByLabel("Название", { exact: true });
  await field.focus();
  await field.press("End");
  await field.pressSequentially(" черновик");
  await field.press("Control+z");
  expect((await current(page)).project.revision).toBe(rev);
  expect(required((await current(page)).processes[0]).title).toBe("Сохранено");
  expect(required(d.processes[0]).title).toBe("Процесс 1");
});
test("inline rename and Esc work, body drag is inert and process expansion is independent", async ({
  page,
}) => {
  const d = await current(page),
    bar = entity(page, required(d.processes[0]).id);
  await drag(page, bar.locator(".bar-title"), 28);
  expect((await current(page)).project.revision).toBe(0);
  await bar.locator(".bar-title").dblclick();
  await page.getByLabel("Название на полосе").fill("Не сохранять");
  await page.getByLabel("Название на полосе").press("Escape");
  expect((await current(page)).project.revision).toBe(0);
  await bar.locator(".bar-title").dblclick();
  await page.getByLabel("Название на полосе").fill("На полосе");
  await page.getByLabel("Название на полосе").press("Enter");
  await saved(page);
  await expect(bar.locator(".bar-title")).toHaveText("На полосе");
  await page
    .getByRole("button", { name: "Свернуть: На полосе", exact: true })
    .click();
  await expect(entity(page, required(d.tasks[0]).id)).toHaveCount(0);
  await expect(entity(page, required(d.tasks[2]).id)).toBeVisible();
  await bar.click();
  await expect(entity(page, required(d.tasks[0]).id)).toBeVisible();
});
test("preview never writes; Esc, pointercancel and blur cancel; one valid move shifts children once and one Undo restores", async ({
  page,
}) => {
  const d = await current(page);
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  await saved(page);
  const handle = entity(page, required(d.processes[0]).id).getByRole("button", {
    name: "Переместить: Процесс 1",
    exact: true,
  });
  for (const mode of ["Escape", "pointercancel", "blur"]) {
    await drag(page, handle, await scale(page), false);
    expect((await current(page)).project.revision).toBe(0);
    if (mode === "Escape") await page.keyboard.press("Escape");
    else if (mode === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else
      await page
        .locator(".timeline-surface")
        .dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    expect((await current(page)).project.revision).toBe(0);
  }
  await drag(page, handle, await scale(page));
  await saved(page);
  const moved = await current(page);
  expect(required(moved.processes[0]).startDate).toBe("2026-11-03");
  expect(required(moved.tasks[0]).startDate).toBe("2026-11-03");
  expect(moved.project.revision).toBe(1);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await saved(page);
  expect(required((await current(page)).processes[0]).startDate).toBe(
    required(d.processes[0]).startDate,
  );
});
test("cross-stage moves and task collisions are rejected without commit", async ({
  page,
}) => {
  const d = await current(page);
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  await drag(
    page,
    entity(page, required(d.processes[0]).id).getByRole("button", {
      name: "Переместить: Процесс 1",
      exact: true,
    }),
    (await scale(page)) * 5,
  );
  await expect(page.getByRole("alert")).toContainText("своём этапе");
  expect((await current(page)).project.revision).toBe(0);
  await drag(
    page,
    entity(page, required(d.tasks[0]).id).getByRole("button", {
      name: "Переместить: Задача 1",
      exact: true,
    }),
    await scale(page),
  );
  await expect(page.getByRole("alert")).toContainText("дорожке");
  expect((await current(page)).project.revision).toBe(0);
});
test("task resize grows its process within stage, rejects crossing stage and undo restores one operation", async ({
  page,
}) => {
  const d = await current(page);
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  const handle = entity(page, required(d.tasks[1]).id).getByRole("button", {
    name: "Изменить окончание: Задача 2",
    exact: true,
  });
  await drag(page, handle, await scale(page));
  await saved(page);
  expect(required((await current(page)).tasks[1]).endDateExclusive).toBe(
    "2026-11-07",
  );
  expect(required((await current(page)).processes[0]).endDateExclusive).toBe(
    "2026-11-07",
  );
  await drag(page, handle, (await scale(page)) * 4);
  expect((await current(page)).project.revision).toBe(1);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await saved(page);
  expect(required((await current(page)).tasks[1]).endDateExclusive).toBe(
    required(d.tasks[1]).endDateExclusive,
  );
});
test("external revisions cause an explicit conflict and never get overwritten by stale commands", async ({
  page,
  context,
}) => {
  const d = await current(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await other
    .getByRole("button", { name: "Этап: Этап 1", exact: true })
    .click();
  await rename(other, "Другая вкладка");
  await page.getByRole("button", { name: "Этап: Этап 1", exact: true }).click();
  await rename(page, "Устаревшая запись");
  await expect(page.getByRole("alert")).toContainText("другой вкладке");
  expect(required((await current(page)).stages[0]).title).toBe(
    "Другая вкладка",
  );
  expect((await current(page)).project.id).toBe(d.project.id);
  await other.close();
});
test("captures the actual template and checkpoint inspector at 1440 and 1920", async ({
  page,
}) => {
  await mkdir("docs/screenshots", { recursive: true });
  await page
    .getByRole("button", { name: "Чекпойнт: Дедлайн", exact: true })
    .click();
  await page.mouse.move(10, 10);
  await page.screenshot({ path: "docs/screenshots/v1-3a-editor-1440.png" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: "docs/screenshots/v1-3a-editor-1920.png" });
});
