import { expect, test } from "@playwright/test";
import { required } from "../../src/testing/required";
import {
  create,
  current,
  saved,
  box,
  drag,
  entity,
  scale,
  home,
  open,
} from "./helpers";
import type { Page } from "@playwright/test";
async function undo(page: Page, redo = false) {
  await page
    .getByRole("button", { name: redo ? "Повторить" : "Отменить", exact: true })
    .click();
  await saved(page);
}
async function show(page: Page) {
  await page.getByRole("button", { name: "Результаты", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "Весь проект", exact: true }).click();
  await saved(page);
}
async function resultTitle(page: Page, value: string) {
  await page.getByLabel("Название результата", { exact: true }).fill(value);
  await page.getByLabel("Название результата", { exact: true }).press("Enter");
  await saved(page);
}
async function history(page: Page) {
  return page.evaluate(
    async () =>
      new Promise<unknown>((resolve, reject) => {
        const r = indexedDB.open("timeline-workspace-v2");
        r.onerror = () => {
          reject(Error("db"));
        };
        r.onsuccess = () => {
          const db = r.result,
            q = db
              .transaction("history", "readonly")
              .objectStore("history")
              .getAll();
          q.onsuccess = () => {
            db.close();
            resolve(q.result);
          };
        };
      }),
  );
}
test.use({ viewport: { width: 1600, height: 1000 } });
test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await create(page, "Новые результаты");
});
test("shared result fields commit with Enter/blur, cancel with Esc, and selecting another object still opens it", async ({
  page,
}) => {
  const d = await current(page),
    p = required(d.processes[0]);
  await entity(page, p.id).click();
  await resultTitle(page, "Макет");
  await page
    .getByLabel("Описание результата", { exact: true })
    .fill("Общее описание");
  await show(page);
  await page
    .getByRole("button", { name: "Результат: Макет", exact: true })
    .click();
  await expect(
    page.getByLabel("Описание результата", { exact: true }),
  ).toHaveValue("Общее описание");
  await resultTitle(page, "Итог");
  await page
    .getByLabel("Название результата", { exact: true })
    .fill("Отменить");
  await page.getByLabel("Название результата", { exact: true }).press("Escape");
  await entity(page, p.id).click();
  await expect(
    page.getByLabel("Название результата", { exact: true }),
  ).toHaveValue("Итог");
  await page.getByLabel("Название", { exact: true }).fill("Процесс после blur");
  const other = required(d.processes[1]);
  await entity(page, other.id).click();
  await saved(page);
  await expect(
    page.getByRole("complementary", { name: "Свойства элемента" }),
  ).toHaveAttribute("data-selected-id", other.id);
  expect(required((await current(page)).processes[0]).title).toBe(
    "Процесс после blur",
  );
  await entity(page, p.id).locator(".bar-title").dblclick();
  await page.getByLabel("Название на полосе").fill("Полоса после blur");
  await page.getByRole("button", { name: "Этап: Этап 2", exact: true }).click();
  await saved(page);
  expect(required((await current(page)).processes[0]).title).toBe(
    "Полоса после blur",
  );
  await expect(
    page.getByRole("complementary", { name: "Свойства элемента" }),
  ).toHaveAttribute("data-selected-id", required(d.stages[1]).id);
});
test("columns add no dates, split calendar cells and retain view preferences after reload", async ({
  page,
}) => {
  const before = await current(page);
  await show(page);
  await expect(page.locator("[data-result-column]")).toHaveCount(2);
  expect(await current(page)).toEqual(before);
  const regions = page.locator(".stage-region"),
    a = await box(regions.nth(0)),
    b = await box(regions.nth(1));
  expect(b.x - a.x).toBeCloseTo(7 * (await scale(page)) + 260, 1);
  for (const step of ["1d", "2d", "3d", "1w", "2w", "1mo"]) {
    await page.getByLabel("Шаг", { exact: true }).selectOption(step);
    await saved(page);
    const gaps = await page
      .locator("[data-stage-result-header]")
      .evaluateAll((es) =>
        es.map((e) => ({
          x: (e as HTMLElement).offsetLeft,
          w: (e as HTMLElement).offsetWidth,
        })),
      );
    const cells = await page
      .locator(".calendar-cell,.calendar-month")
      .evaluateAll((es) =>
        es.map((e) => ({
          x: (e as HTMLElement).offsetLeft,
          w: (e as HTMLElement).offsetWidth,
        })),
      );
    for (const gap of gaps)
      for (const cell of cells)
        expect(
          cell.x + cell.w <= gap.x + 1 || cell.x >= gap.x + gap.w - 1,
        ).toBe(true);
  }
  await page
    .getByRole("button", { name: "Увеличить масштаб", exact: true })
    .click();
  await saved(page);
  const zoom = await scale(page);
  await page.reload();
  await saved(page);
  await expect(
    page.getByRole("button", { name: "Результаты", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await scale(page)).toBe(zoom);
  await show(page);
  await expect(page.locator("[data-result-column]")).toHaveCount(0);
  expect(await current(page)).toEqual(before);
});
test("linked and standalone tiles hide and restore without losing text; standalone deletion has one undo", async ({
  page,
}) => {
  const before = await current(page);
  await resultTitle(page, "Связанный");
  await show(page);
  await page
    .getByRole("button", { name: "Скрыть плашку результата", exact: true })
    .click();
  await saved(page);
  await resultTitle(page, "Скрытый связанный");
  await expect(page.locator("[data-result-id]")).toHaveCount(0);
  await page.reload();
  await saved(page);
  await expect(
    page.getByLabel("Название результата", { exact: true }),
  ).toHaveValue("Скрытый связанный");
  await page
    .getByRole("button", {
      name: "Добавить результат на таймлайн",
      exact: true,
    })
    .click();
  await saved(page);
  await expect(
    page.getByRole("button", {
      name: "Результат: Скрытый связанный",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Добавить результат этапа: Этап 1",
      exact: true,
    })
    .click();
  await saved(page);
  await resultTitle(page, "Самостоятельный");
  expect((await current(page)).processes).toHaveLength(before.processes.length);
  await page
    .getByRole("button", { name: "Скрыть плашку результата", exact: true })
    .click();
  await saved(page);
  await page.getByRole("button", { name: "Этап: Этап 1", exact: true }).click();
  await page
    .getByRole("button", { name: "Самостоятельный · скрыт", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Добавить результат на таймлайн",
      exact: true,
    })
    .click();
  await saved(page);
  await page
    .getByRole("button", {
      name: "Удалить самостоятельный результат",
      exact: true,
    })
    .click();
  await saved(page);
  expect((await current(page)).results).toHaveLength(1);
  await undo(page);
  expect((await current(page)).results).toHaveLength(2);
  await expect(
    page.getByRole("button", {
      name: "Результат: Самостоятельный",
      exact: true,
    }),
  ).toBeVisible();
});
test("vertical result drag is preview-only, Escape cancels, commit has one persisted undo", async ({
  page,
}) => {
  await resultTitle(page, "Плашка");
  await show(page);
  const before = await current(page),
    handle = page.getByRole("button", {
      name: "Переместить результат: Плашка",
      exact: true,
    }),
    b = await box(handle);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 50, b.y + 150, { steps: 8 });
  expect(await current(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await current(page)).toEqual(before);
  const b2 = await box(handle);
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.mouse.down();
  await page.mouse.move(b2.x + 80, b2.y + 160, { steps: 8 });
  await page.mouse.up();
  await saved(page);
  const moved = await current(page);
  expect(moved.project.revision).toBe(before.project.revision + 1);
  expect(required(moved.resultPlacements[0]).layoutMode).toBe("manual");
  await page.reload();
  await saved(page);
  await undo(page);
  expect(required((await current(page)).resultPlacements[0]).layoutMode).toBe(
    "auto",
  );
  await undo(page, true);
  expect(required((await current(page)).resultPlacements[0]).manualY).toBe(
    required(moved.resultPlacements[0]).manualY,
  );
});
test("local history survives F5 and closing/reopening the tab, with an independent project scope", async ({
  page,
  context,
}) => {
  await page
    .getByLabel("Название", { exact: true })
    .fill("Сохранённый процесс");
  await page.getByLabel("Название", { exact: true }).press("Enter");
  await saved(page);
  await page.reload();
  await saved(page);
  await undo(page);
  await expect(page.getByLabel("Название", { exact: true })).toHaveValue(
    "Процесс 1",
  );
  const url = page.url(),
    next = await context.newPage();
  await page.close();
  await next.goto(url);
  await saved(next);
  await undo(next, true);
  await expect(next.getByLabel("Название", { exact: true })).toHaveValue(
    "Сохранённый процесс",
  );
  await home(next);
  await create(next, "Другой проект");
  await expect(
    next.getByRole("button", { name: "Отменить", exact: true }),
  ).toBeDisabled();
  await home(next);
  await open(next, "Новые результаты");
  await undo(next);
  expect(required((await current(next)).processes[0]).title).toBe("Процесс 1");
});
test("free checkpoint drag previews/cancels/commits; an anchored checkpoint explains why it cannot be moved", async ({
  page,
}) => {
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  const before = await current(page),
    handle = page.getByRole("button", {
      name: "Чекпойнт: Дедлайн",
      exact: true,
    });
  await drag(page, handle, 2 * (await scale(page)), false);
  expect(await current(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await current(page)).toEqual(before);
  await drag(page, handle, 2 * (await scale(page)));
  await saved(page);
  expect(required((await current(page)).checkpoints[0]).timing).toEqual({
    anchor: "free",
    date: "2026-11-17",
  });
  await undo(page);
  expect(required((await current(page)).checkpoints[0]).timing).toEqual(
    required(before.checkpoints[0]).timing,
  );
  await handle.click();
  await page.getByLabel("Привязать к дате окончания проекта").check();
  await saved(page);
  const anchored = await current(page);
  await expect(handle).toHaveAttribute(
    "title",
    /Для ручного переноса снимите привязку/,
  );
  await drag(page, handle, -(await scale(page)));
  await saved(page);
  expect(await current(page)).toEqual(anchored);
});
test("Enter saves dates once; unchanged repeated saves preserve revisions and Redo through reload", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  const field = page.getByLabel("Конец", {
    exact: true,
  });
  const before = await current(page);
  await field.fill("18.11.2026");
  await field.press("Enter");
  await field.press("Enter");
  await saved(page);
  expect((await current(page)).project.revision).toBe(
    before.project.revision + 1,
  );
  await undo(page);
  const undone = await current(page),
    h = await history(page);
  await field.press("Enter");
  await field.press("Enter");
  await saved(page);
  expect(await current(page)).toEqual(undone);
  expect(await history(page)).toEqual(h);
  await page.reload();
  await saved(page);
  await expect(
    page.getByRole("button", { name: "Повторить", exact: true }),
  ).toBeEnabled();
  await undo(page, true);
  expect((await current(page)).project.endDateExclusive).toBe("2026-11-19");
});
test("work drop inside a result gap cancels; crossing the gap uses calendar days and one undo", async ({
  page,
}) => {
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  await show(page);
  const before = await current(page),
    p = required(before.processes[0]),
    handle = page.getByRole("button", {
      name: `Переместить: ${p.title}`,
      exact: true,
    });
  const b = await box(handle),
    g = await box(page.locator("[data-result-column]").first());
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    b.x + b.width / 2 + (await scale(page)),
    b.y + b.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(g.x + g.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.mouse.up();
  await saved(page);
  expect(await current(page)).toEqual(before);
  await expect(page.getByRole("alert")).toContainText(
    "внутри колонки результатов",
  );
  await drag(page, handle, 8 * (await scale(page)) + 260);
  await saved(page);
  const after = await current(page);
  expect(required(after.processes[0]).startDate).toBe("2026-11-10");
  expect(after.project.revision).toBe(before.project.revision + 1);
  await undo(page);
  expect(required((await current(page)).processes[0]).startDate).toBe(
    p.startDate,
  );
});
test("resize, stage boundary and checkpoint use the same inverse geometry through columns", async ({
  page,
}) => {
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  await show(page);
  const before = await current(page),
    p = required(before.processes[0]);
  await drag(
    page,
    page.getByRole("button", {
      name: `Изменить окончание: ${p.title}`,
      exact: true,
    }),
    6 * (await scale(page)) + 260,
  );
  await saved(page);
  expect(required((await current(page)).processes[0]).endDateExclusive).toBe(
    "2026-11-12",
  );
  await undo(page);
  await drag(
    page,
    page.getByRole("button", {
      name: "Перенести границу: Этап 2",
      exact: true,
    }),
    -2 * (await scale(page)) - 260,
  );
  await saved(page);
  expect(required((await current(page)).stages[1]).startDate).toBe(
    "2026-11-07",
  );
  await undo(page);
  await drag(
    page,
    page.getByRole("button", { name: "Чекпойнт: Дедлайн", exact: true }),
    -8 * (await scale(page)) - 260,
  );
  await saved(page);
  expect(required((await current(page)).checkpoints[0]).timing).toEqual({
    anchor: "free",
    date: "2026-11-07",
  });
  await undo(page);
  expect(required((await current(page)).checkpoints[0]).timing).toEqual(
    required(before.checkpoints[0]).timing,
  );
});
test("a second tab cannot undo or edit over newer content using its stale revision", async ({
  page,
  context,
}) => {
  await page.getByLabel("Название", { exact: true }).fill("Первый ввод");
  await page.getByLabel("Название", { exact: true }).press("Enter");
  await saved(page);
  const next = await context.newPage();
  await next.goto(page.url());
  await saved(next);
  await next
    .getByLabel("Название", { exact: true })
    .fill("Более новое изменение");
  await next.getByLabel("Название", { exact: true }).press("Enter");
  await saved(next);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await saved(page);
  await expect(page.getByRole("alert")).toContainText("Данные не перезаписаны");
  expect(required((await current(page)).processes[0]).title).toBe(
    "Более новое изменение",
  );
  await page.reload();
  await saved(page);
  await undo(page);
  expect(required((await current(page)).processes[0]).title).toBe(
    "Первый ввод",
  );
});
test("automatic tiles follow collapsed process rows without changing content or history", async ({
  page,
}) => {
  const before = await current(page),
    p = required(before.processes[1]);
  await entity(page, p.id).click();
  await resultTitle(page, "Автоматический");
  await show(page);
  const d = await current(page),
    tile = page.locator("[data-result-id]"),
    bar = entity(page, p.id);
  const top = async () =>
    bar.evaluate((e) => (e as HTMLElement).style.top.replace("px", ""));
  await expect(tile).toHaveAttribute("data-layout-y", await top());
  await entity(page, required(d.processes[0]).id)
    .getByRole("button", { name: "Свернуть: Процесс 1", exact: true })
    .click();
  await saved(page);
  await expect(tile).toHaveAttribute("data-layout-y", await top());
  expect(await current(page)).toEqual(d);
});
