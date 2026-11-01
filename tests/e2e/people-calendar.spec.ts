import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  create,
  current,
  saved,
  entity,
  box,
  drag,
  scale,
  home,
} from "./helpers";
import { required } from "../../src/testing/required";
import { semantic } from "../../src/application/v2/history";
import { catalogSchema } from "../../src/domain/v2/peopleModel";
import { snapshotSchema } from "../../src/domain/v2/model";
import type { Snapshot } from "../../src/domain/v2/model";
import { addDays } from "../../src/domain";
async function undo(page: Page, redo = false) {
  await page
    .getByRole("button", { name: redo ? "Повторить" : "Отменить", exact: true })
    .click();
  await saved(page);
}
async function catalog(page: Page) {
  const value = await page.evaluate(
    async () =>
      new Promise<unknown>((resolve, reject) => {
        const r = indexedDB.open("timeline-workspace-v2");
        r.onerror = () => {
          reject(Error("db"));
        };
        r.onsuccess = () => {
          const db = r.result,
            q = db
              .transaction("workspaceData")
              .objectStore("workspaceData")
              .get("people");
          q.onsuccess = () => {
            db.close();
            resolve((q.result as { value: unknown } | undefined)?.value);
          };
        };
      }),
  );
  return catalogSchema.parse(value);
}
async function seed(page: Page, d: Snapshot) {
  snapshotSchema.parse(d);
  await saved(page);
  await page.evaluate(
    async (d) =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("timeline-workspace-v2");
        r.onsuccess = () => {
          const db = r.result,
            t = db.transaction(["documents", "preferences"], "readwrite");
          t.objectStore("documents").put(d);
          t.objectStore("preferences").put({
            key: `editor:${d.project.id}`,
            value: d.viewPreferences,
          });
          t.oncomplete = () => {
            db.close();
            resolve();
          };
          t.onerror = () => {
            reject(Error("fixture"));
          };
        };
      }),
    d,
  );
  await page.reload();
  await saved(page);
}
async function addPerson(page: Page, name = "Анна", last = "Иванова") {
  await page
    .getByRole("button", { name: "Создать исполнителя", exact: true })
    .click();
  const f = page.getByRole("dialog", {
    name: "Новый исполнитель",
    exact: true,
  });
  await f.getByLabel("Имя", { exact: true }).fill(name);
  await f.getByLabel("Фамилия", { exact: true }).fill(last);
  await f.getByLabel("Основная роль", { exact: true }).fill("Дизайнер");
  await f.getByLabel("Контакты", { exact: true }).fill("anna@example.test");
  await f.getByLabel("Примечание", { exact: true }).fill("Общая карточка");
  await f
    .getByRole("button", { name: "Сохранить карточку", exact: true })
    .click();
  await expect(f).toBeHidden();
  await saved(page);
}
async function choosePerson(page: Page, query = "иван") {
  await page
    .getByRole("combobox", { name: "Поиск исполнителя", exact: true })
    .fill(query);
  await page.getByRole("listbox").getByRole("option").first().click();
  await saved(page);
}
test.use({ viewport: { width: 1600, height: 1100 } });
test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await create(page, "V1.5A");
});
test("project range inputs apply both dates atomically, reject cropping, preserve Redo on no-op and survive F5", async ({
  page,
}) => {
  const before = await current(page);
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page.getByLabel("Начало", { exact: true }).fill("01.11.2026");
  await page.getByLabel("Конец", { exact: true }).fill("20.11.2026");
  await page.getByLabel("Конец", { exact: true }).press("Enter");
  await saved(page);
  const changed = await current(page);
  expect(changed.project.startDate).toBe("2026-11-01");
  expect(changed.project.endDateExclusive).toBe("2026-11-21");
  expect(changed.project.revision).toBe(before.project.revision + 1);
  expect(changed.processes).toEqual(before.processes);
  expect(changed.tasks).toEqual(before.tasks);
  await page.getByLabel("Конец", { exact: true }).press("Enter");
  await saved(page);
  expect(await current(page)).toEqual(changed);
  await page.reload();
  await saved(page);
  await undo(page);
  expect(semantic(await current(page))).toBe(semantic(before));
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page.getByLabel("Конец", { exact: true }).press("Enter");
  await saved(page);
  await expect(
    page.getByRole("button", { name: "Повторить", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Начало", { exact: true }).fill("03.11.2026");
  await page.getByLabel("Начало", { exact: true }).press("Enter");
  await expect(page.getByRole("alert")).toContainText("обрезают");
  expect(semantic(await current(page))).toBe(semantic(before));
  await page.getByLabel("Начало", { exact: true }).press("Escape");
  await expect(page.getByLabel("Начало", { exact: true })).toHaveValue(
    "02.11.2026",
  );
  await undo(page, true);
  expect(semantic(await current(page))).toBe(semantic(changed));
});
test("range popup clears endpoints independently, normalizes reverse picks, navigates years and confirms only once", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  const before = await current(page),
    open = page.getByRole("button", { name: "Календарь: Границы проекта" });
  await open.click();
  const popup = page.getByRole("dialog", { name: "Календарь диапазона" }),
    day = (d: string) => popup.locator(`[data-range-day="${d}"]`);
  await day("2026-11-02").click();
  await expect(day("2026-11-02")).toHaveAttribute("aria-pressed", "false");
  await expect(day("2026-11-15")).toHaveAttribute("aria-pressed", "true");
  await expect(
    popup.getByRole("button", { name: "Подтвердить", exact: true }),
  ).toBeDisabled();
  await day("2026-11-01").click();
  await expect(popup.locator("[data-in-range=true]")).toHaveCount(15);
  await day("2026-11-15").click();
  await expect(day("2026-11-01")).toHaveAttribute("aria-pressed", "true");
  await day("2026-11-20").click();
  await expect(popup.locator("[data-in-range=true]")).toHaveCount(20);
  expect(await current(page)).toEqual(before);
  await popup.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(await current(page)).toEqual(before);
  await open.click();
  await day("2026-11-10").click();
  await expect(day("2026-11-15")).toHaveAttribute("aria-pressed", "false");
  await day("2026-11-01").click();
  await expect(day("2026-11-01")).toHaveClass(/range-start/);
  await expect(day("2026-11-10")).toHaveClass(/range-end/);
  await popup.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(popup.getByRole("alert")).toContainText("обрезают");
  await expect(popup).toBeVisible();
  expect(await current(page)).toEqual(before);
  await day("2026-11-01").click();
  await day("2026-11-01").click();
  await day("2026-11-10").click();
  await popup.getByRole("button", { name: "Следующий месяц" }).click();
  await expect(popup).toContainText("Декабрь 2026");
  await popup.getByRole("button", { name: "Следующий месяц" }).click();
  await expect(popup).toContainText("Январь 2027");
  await day("2027-01-31").click();
  await expect(popup).toBeVisible();
  expect(await current(page)).toEqual(before);
  await popup.getByRole("button", { name: "Предыдущий месяц" }).click();
  await expect(popup).toContainText("Декабрь 2026");
  await popup.getByRole("button", { name: "Следующий месяц" }).click();
  await popup.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(popup).toBeHidden();
  await saved(page);
  const next = await current(page);
  expect(next.project.startDate).toBe("2026-11-01");
  expect(next.project.endDateExclusive).toBe("2027-02-01");
  expect(next.project.revision).toBe(before.project.revision + 1);
  await undo(page);
  expect(semantic(await current(page))).toBe(semantic(before));
});
test("actual top checkpoint circle drags without pan, previews only, cancels and restores after reload", async ({
  page,
}) => {
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  await saved(page);
  const before = await current(page),
    main = page.getByRole("main", { name: "Редактор таймлайна" }),
    pan = await main.getAttribute("data-pan-x"),
    handle = page.getByRole("button", {
      name: "Чекпойнт: Дедлайн",
      exact: true,
    }),
    h = await box(handle),
    body = await box(page.getByLabel("Производственный план"));
  expect(h.y + h.height).toBeLessThan(body.y);
  expect(await handle.evaluate((e) => getComputedStyle(e).borderRadius)).toBe(
    "50%",
  );
  await drag(page, handle, 2 * (await scale(page)), false);
  await expect(handle).toHaveAttribute("data-date", "2026-11-17");
  expect(await current(page)).toEqual(before);
  expect(await main.getAttribute("data-pan-x")).toBe(pan);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(handle).toHaveAttribute("data-date", "2026-11-15");
  expect(await current(page)).toEqual(before);
  await drag(page, handle, 2 * (await scale(page)));
  await saved(page);
  expect((await current(page)).project.revision).toBe(
    before.project.revision + 1,
  );
  await page.reload();
  await saved(page);
  await expect(handle).toHaveAttribute("data-date", "2026-11-17");
  await undo(page);
  expect(semantic(await current(page))).toBe(semantic(before));
  await handle.click();
  await page.getByLabel("Привязать к дате окончания проекта").check();
  await page.getByRole("button", { name: "Сохранить чекпойнт" }).click();
  await saved(page);
  const anchored = await current(page);
  await expect(handle).toHaveAttribute("title", /снимите привязку/);
  const p = await main.getAttribute("data-pan-x");
  await drag(page, handle, -(await scale(page)));
  expect(await current(page)).toEqual(anchored);
  expect(await main.getAttribute("data-pan-x")).toBe(p);
});
test("project and checkpoint day fills share all temporal layers, exclude result gaps and follow zoom/pan/inspector resize", async ({
  page,
}) => {
  const before = await current(page);
  await page.getByRole("button", { name: "Результаты", exact: true }).click();
  await page.getByRole("button", { name: "Весь проект", exact: true }).click();
  await saved(page);
  const check = async () => {
    const px = await scale(page),
      gaps = await page
        .locator("[data-stage-result-header]")
        .evaluateAll((es) =>
          es.map((e) => ({
            x: (e as HTMLElement).offsetLeft,
            w: (e as HTMLElement).offsetWidth,
          })),
        );
    for (const selector of [
      ".calendar-ruler",
      ".foundation-stage-band",
      ".timeline-canvas",
      ".performers-time-background",
    ]) {
      const fills = page.locator(selector).locator(".project-range-shade");
      await expect(fills).toHaveCount(2);
      const geometry = await fills.evaluateAll((es) =>
        es.map((e) => ({
          x: Number(e.getAttribute("x")),
          w: Number(e.getAttribute("width")),
        })),
      );
      expect(geometry.reduce((s, f) => s + f.w, 0)).toBeCloseTo(14 * px, 2);
      for (const f of geometry)
        for (const g of gaps)
          expect(f.x + f.w <= g.x + 0.1 || f.x >= g.x + g.w - 0.1).toBe(true);
      const red = page.locator(selector).locator(".checkpoint-day-shade");
      await expect(red).toHaveCount(1);
      await expect(red).toHaveAttribute("data-date", "2026-11-15");
      expect(Number(await red.getAttribute("width"))).toBeCloseTo(px, 2);
    }
  };
  await check();
  await page.getByRole("button", { name: "Увеличить масштаб" }).click();
  await saved(page);
  await check();
  const empty = await box(page.locator(".calendar-ruler"));
  await page.mouse.move(empty.x + empty.width / 2, empty.y + 12);
  await page.mouse.down();
  await page.mouse.move(empty.x + empty.width / 2 + 50, empty.y + 12, {
    steps: 6,
  });
  await page.mouse.up();
  await saved(page);
  await check();
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page
    .getByRole("button", { name: "Календарь: Границы проекта" })
    .click();
  await page.getByRole("button", { name: "Свернуть свойства" }).click();
  await expect(
    page.getByRole("main", { name: "Редактор таймлайна" }),
  ).toHaveClass(/inspector-collapsed/);
  await saved(page);
  await check();
  await page.getByRole("button", { name: "Развернуть свойства" }).click();
  await expect(
    page.getByRole("dialog", { name: "Календарь диапазона" }),
  ).toBeVisible();
  await check();
  expect(await current(page)).toEqual(before);
});
test("multiple checkpoint labels reserve separate non-overlapping header rows; CRUD is persistent and undoable", async ({
  page,
}) => {
  await page.getByRole("button", { name: "+ Чекпойнт", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "Дублировать чекпойнт" }).click();
  await saved(page);
  const labels = page.locator(".checkpoint-header-label");
  await expect(labels).toHaveCount(3);
  const bs = await labels.evaluateAll((es) =>
    es.map((e) => {
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }),
  );
  for (const [i, a] of bs.entries())
    for (const b of bs.slice(i + 1))
      expect(
        a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y,
      ).toBe(true);
  const before = await current(page);
  await page.getByRole("button", { name: "Удалить чекпойнт" }).click();
  await saved(page);
  expect((await current(page)).checkpoints).toHaveLength(2);
  await page.reload();
  await saved(page);
  await undo(page);
  expect(semantic(await current(page))).toBe(semantic(before));
});
test("people autocomplete, role-only assignments and shared occupancy survive reload with one atomic creation Undo", async ({
  page,
}) => {
  const before = await current(page),
    p = required(before.processes[0]),
    t = required(before.tasks[0]);
  await entity(page, p.id).click();
  await addPerson(page);
  const c = await catalog(page),
    pid = required(c.people[0]).id;
  expect(c.undo).toHaveLength(0);
  expect((await current(page)).project.revision).toBe(
    before.project.revision + 1,
  );
  await page.reload();
  await saved(page);
  await undo(page);
  expect((await catalog(page)).people).toHaveLength(0);
  expect((await current(page)).assignments).toHaveLength(0);
  await undo(page, true);
  await entity(page, t.id).click();
  await choosePerson(page);
  expect(
    (await current(page)).assignments.every((a) => a.personId === pid),
  ).toBe(true);
  const rows = page.locator(`.performer-row[data-person-id="${pid}"]`);
  await expect(rows).toHaveCount(1);
  await expect(rows.locator("[data-overlap=true]").first()).toBeVisible();
  const segment = rows.locator(".performer-segment").first(),
    state = await current(page);
  await segment.hover();
  await expect(entity(page, p.id)).toHaveClass(/highlighted/);
  await expect(entity(page, t.id)).toHaveClass(/highlighted/);
  await drag(page, segment, 50);
  await saved(page);
  expect(await current(page)).toEqual(state);
  await page.getByLabel("Статус", { exact: true }).selectOption("В работе");
  await saved(page);
  await page.getByLabel("Роль в работе", { exact: true }).fill("Редактор");
  await page.getByLabel("Роль в работе", { exact: true }).press("Enter");
  await saved(page);
  const rev = (await current(page)).project.revision;
  await page.getByLabel("Роль в работе", { exact: true }).press("Enter");
  await saved(page);
  expect((await current(page)).project.revision).toBe(rev);
  await page.reload();
  await saved(page);
  await entity(page, t.id).click();
  await expect(page.getByLabel("Статус", { exact: true })).toHaveValue(
    "В работе",
  );
  await expect(page.getByLabel("Роль в работе", { exact: true })).toHaveValue(
    "Редактор",
  );
  await page
    .getByRole("button", { name: "Снять назначение", exact: true })
    .click();
  await saved(page);
  await page.getByLabel("Роль в работе", { exact: true }).fill("Вакансия");
  await page.getByLabel("Роль в работе", { exact: true }).press("Enter");
  await saved(page);
  await expect(
    page.locator(".performer-row").filter({ hasText: "Не назначен" }),
  ).toHaveCount(1);
});
test("global rename requires confirmation, can fork only this assignment, and archive frees cross-project assignments with fixed names", async ({
  page,
}) => {
  const a = await current(page);
  await addPerson(page);
  const pid = required((await catalog(page)).people[0]).id;
  await home(page);
  const b = await create(page, "Второй проект");
  await choosePerson(page);
  await page.getByRole("button", { name: "Карточка", exact: true }).click();
  let f = page.getByRole("dialog", {
    name: "Карточка исполнителя",
    exact: true,
  });
  await f.getByLabel("Имя", { exact: true }).fill("Анастасия");
  await f.getByLabel("Имя", { exact: true }).press("Enter");
  await expect(
    page.getByRole("alertdialog", { name: "Изменение общего имени" }),
  ).toBeVisible();
  expect(required((await catalog(page)).people[0]).firstName).toBe("Анна");
  await page
    .getByRole("button", { name: "Изменить общую карточку", exact: true })
    .click();
  await expect(f).toBeHidden();
  await saved(page);
  expect(required((await catalog(page)).people[0]).firstName).toBe("Анастасия");
  await page.getByRole("button", { name: "Карточка", exact: true }).click();
  f = page.getByRole("dialog", { name: "Карточка исполнителя", exact: true });
  await f.getByLabel("Имя", { exact: true }).fill("Ольга");
  await f.getByLabel("Имя", { exact: true }).press("Enter");
  await page
    .getByRole("button", {
      name: "Создать нового исполнителя для этого назначения",
      exact: true,
    })
    .click();
  await expect(f).toBeHidden();
  await saved(page);
  expect((await catalog(page)).people).toHaveLength(2);
  expect(required((await current(page)).assignments[0]).personId).not.toBe(pid);
  await undo(page);
  expect((await catalog(page)).people).toHaveLength(1);
  expect(required((await current(page)).assignments[0]).personId).toBe(pid);
  await page.getByRole("button", { name: "Исполнители", exact: true }).click();
  const cat = page.getByRole("dialog", {
    name: "Исполнители пространства",
    exact: true,
  });
  await cat.getByRole("button", { name: "В архив", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Архивирование исполнителя" })
    .getByRole("button", { name: "Архивировать", exact: true })
    .click();
  await saved(page);
  expect((await catalog(page)).retiredAssignments).toHaveLength(2);
  await cat.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.locator(".assigned-person")).toHaveCount(0);
  await page.getByText("Прежние назначения · 1", { exact: true }).click();
  await expect(page.locator(".assignment-records")).toContainText(
    "Анастасия Иванова",
  );
  await page.reload();
  await saved(page);
  await page.getByRole("button", { name: "Исполнители", exact: true }).click();
  await cat
    .getByRole("button", { name: "Отменить в справочнике", exact: true })
    .click();
  await saved(page);
  await cat.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.locator(".assigned-person")).toContainText(
    "Анастасия Иванова",
  );
  await page.getByRole("button", { name: "Исполнители", exact: true }).click();
  await cat
    .getByRole("button", { name: "Повторить в справочнике", exact: true })
    .click();
  await saved(page);
  await cat.getByLabel("Показать архивных").check();
  await cat.getByRole("button", { name: "Восстановить", exact: true }).click();
  await saved(page);
  await cat.getByRole("button", { name: "Изменить", exact: true }).click();
  f = page.getByRole("dialog", { name: "Карточка исполнителя", exact: true });
  await f.getByLabel("Имя", { exact: true }).fill("Новое имя");
  await f.getByLabel("Имя", { exact: true }).press("Enter");
  await page
    .getByRole("button", { name: "Изменить общую карточку", exact: true })
    .click();
  await expect(f).toBeHidden();
  await saved(page);
  await cat.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.locator(".assignment-records")).toContainText(
    "Анастасия Иванова",
  );
  await expect(page.locator(".assigned-person")).toHaveCount(0);
  expect((await current(page)).project.id).toBe(b.project.id);
  await page
    .getByRole("button", {
      name: `Открыть проект: ${a.project.name}`,
      exact: true,
    })
    .click();
  await expect(page.locator(".assigned-person")).toHaveCount(0);
});
test("decorative gaps keep real dates across adjacent task/process bars and reachable resize targets", async ({
  page,
}) => {
  const d = await current(page),
    a = required(d.processes[0]),
    b = required(d.processes[2]);
  a.endDateExclusive = b.startDate;
  d.viewPreferences = { ...d.viewPreferences, expandedProcessIds: [] };
  await seed(page, d);
  await page.getByRole("button", { name: "Весь проект", exact: true }).click();
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  await saved(page);
  const ga = await box(entity(page, a.id)),
    gb = await box(entity(page, b.id));
  expect(gb.x - ga.x - ga.width).toBeCloseTo(8, 1);
  expect(await entity(page, a.id).getAttribute("data-time-end")).toBe(
    await entity(page, b.id).getAttribute("data-time-start"),
  );
  const ah = await box(entity(page, a.id).locator(".resize-handle.end")),
    bh = await box(entity(page, b.id).locator(".resize-handle.start"));
  expect(ah.x + ah.width).toBeLessThan(bh.x);
  const before = await current(page);
  await drag(
    page,
    entity(page, a.id).locator(".resize-handle.end"),
    await scale(page),
  );
  await saved(page);
  expect(required((await current(page)).processes[0]).endDateExclusive).toBe(
    addDays(a.endDateExclusive, 1),
  );
  await undo(page);
  expect(semantic(await current(page))).toBe(semantic(before));
  // Selecting the resize handle already opens the process.
  await expect(entity(page, a.id).locator(".expand-handle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const t0 = required(d.tasks[0]),
    t1 = required(d.tasks[1]);
  await expect(entity(page, t1.id)).toBeVisible();
  const ta = await box(entity(page, t0.id)),
    tb = await box(entity(page, t1.id));
  expect(tb.x - ta.x - ta.width).toBeCloseTo(8, 1);
  await drag(
    page,
    entity(page, t1.id).locator(".resize-handle.start"),
    await scale(page),
  );
  await saved(page);
  expect(required((await current(page)).tasks[1]).startDate).toBe(
    addDays(t1.startDate, 1),
  );
  await undo(page);
  expect(semantic(await current(page))).toBe(semantic(before));
});
test("work inspector applies two date edges with the complete cascade in one persisted Undo", async ({
  page,
}) => {
  const before = await current(page),
    t = required(before.tasks[0]);
  await entity(page, t.id).click();
  await page.getByLabel("Начало работы", { exact: true }).fill("01.11.2026");
  await page.getByLabel("Конец работы", { exact: true }).fill("05.11.2026");
  await page.getByLabel("Конец работы", { exact: true }).press("Enter");
  await saved(page);
  const next = await current(page);
  expect(next.project.revision).toBe(before.project.revision + 1);
  expect(required(next.tasks[0]).startDate).toBe("2026-11-01");
  expect(required(next.tasks[0]).endDateExclusive).toBe("2026-11-06");
  expect(required(next.tasks[1]).startDate).toBe("2026-11-06");
  expect(required(next.processes[0]).startDate).toBe("2026-11-01");
  await page.reload();
  await saved(page);
  await undo(page);
  expect(semantic(await current(page))).toBe(semantic(before));
  await undo(page, true);
  expect(semantic(await current(page))).toBe(semantic(next));
  const beforeColor=await current(page);
  const process = required(beforeColor.processes[0]);
  await entity(page, process.id).click();
  const color = page.getByLabel("Цвет процесса", { exact: true });
  const preview = async (value: string) => {
    await color.evaluate((el, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  };
  await color.focus();
  await preview("#224466");
  await preview("#334477");
  expect(await current(page)).toEqual(beforeColor);
  await color.press("Escape");
  expect(await current(page)).toEqual(beforeColor);
  await color.focus();
  await preview("#445588");
  await preview("#556699");
  await color.press("Enter");
  await saved(page);
  const colored = await current(page);
  expect(required(colored.processes[0]).color).toBe("#556699");
  expect(colored.project.revision).toBe(beforeColor.project.revision + 1);
  await color.press("Enter");
  await saved(page);
  expect(await current(page)).toEqual(colored);
  await page.reload();
  await saved(page);
  await undo(page);
  expect(semantic(await current(page))).toBe(semantic(next));
});
test("person names require confirmation after blur, Esc cancels and no-op saves retain workspace Redo", async ({
  page,
}) => {
  await addPerson(page);
  const before = await catalog(page);
  await page.getByRole("button", { name: "Карточка", exact: true }).click();
  let f = page.getByRole("dialog", {
    name: "Карточка исполнителя",
    exact: true,
  });
  await f.getByLabel("Имя", { exact: true }).fill("Не сохранять");
  await f.getByLabel("Фамилия", { exact: true }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Изменение общего имени" }),
  ).toBeVisible();
  expect(await catalog(page)).toEqual(before);
  await f.getByLabel("Фамилия", { exact: true }).press("Escape");
  await expect(f).toBeHidden();
  expect(await catalog(page)).toEqual(before);
  await page.getByRole("button", { name: "Исполнители", exact: true }).click();
  const c = page.getByRole("dialog", {
    name: "Исполнители пространства",
    exact: true,
  });
  await c.getByRole("button", { name: "Изменить", exact: true }).click();
  f = page.getByRole("dialog", { name: "Карточка исполнителя", exact: true });
  await f.getByLabel("Контакты", { exact: true }).fill("new@example.test");
  await f.getByLabel("Контакты", { exact: true }).press("Enter");
  await expect(f).toBeHidden();
  await saved(page);
  await c
    .getByRole("button", { name: "Отменить в справочнике", exact: true })
    .click();
  await saved(page);
  const undone = await catalog(page);
  await c.getByRole("button", { name: "Изменить", exact: true }).click();
  await f
    .getByRole("button", { name: "Сохранить карточку", exact: true })
    .click();
  await expect(f).toBeHidden();
  await saved(page);
  expect(await catalog(page)).toEqual(undone);
  await expect(
    c.getByRole("button", { name: "Повторить в справочнике", exact: true }),
  ).toBeEnabled();
});
