import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { create, current, saved, entity, box, home, scale } from "./helpers";
import { required } from "../../src/testing/required";
import { applyCommand } from "../../src/domain/v2/commands";
import { laneIdSchema, dateOnly } from "../../src/domain";
import type { Snapshot } from "../../src/domain/v2/model";
import { snapshotSchema } from "../../src/domain/v2/model";
import { semantic } from "../../src/application/v2/history";
async function undo(page: Page, redo = false) {
  await page
    .getByRole("button", { name: redo ? "Повторить" : "Отменить", exact: true })
    .click();
  await saved(page);
}
async function move(
  page: Page,
  id: string,
  dx: number,
  dy: number,
  finish = true,
) {
  const b = await box(entity(page, id).locator(".move-handle"));
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {
    steps: 8,
  });
  if (finish) await page.mouse.up();
}
async function seed(page: Page, d: Snapshot) {
  snapshotSchema.parse(d);
  await page.evaluate(
    async (d) =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("timeline-workspace-v2");
        r.onerror = () => {
          reject(Error("db"));
        };
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
            reject(Error("fixture failed"));
          };
        };
      }),
    d,
  );
  await page.reload();
  await saved(page);
}
async function addForm(page: Page, title: string, start: string, end: string) {
  const f = page.getByRole("dialog");
  await f.getByLabel("Название работы").fill(title);
  await f.getByLabel("Начало работы").fill(start);
  await f.getByLabel("Окончание работы").fill(end);
  await f.getByRole("button", { name: "Добавить", exact: true }).click();
  await saved(page);
  await expect(f).toBeHidden();
}
test.use({ viewport: { width: 1600, height: 1000 } });
test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await create(page, "Проект А");
});
test("Ctrl, Meta and Shift select only compatible works without changing dates/history or creating a stack", async ({
  page,
}) => {
  const d = await current(page),
    a = required(d.tasks[0]),
    b = required(d.tasks[1]),
    other = required(d.tasks[2]);
  await entity(page, a.id).click();
  await entity(page, b.id).click({ modifiers: ["Control"] });
  await expect(page.locator(".task-bar[data-selected=true]")).toHaveCount(2);
  expect(await current(page)).toEqual(d);
  await entity(page, other.id).click({ modifiers: ["Control"] });
  await expect(page.getByRole("alert")).toContainText("одного");
  await expect(page.locator(".task-bar[data-selected=true]")).toHaveCount(2);
  await entity(page, b.id).click({ modifiers: ["Meta"] });
  await expect(page.locator(".task-bar[data-selected=true]")).toHaveCount(1);
  await entity(page, b.id).click({ modifiers: ["Shift"] });
  await expect(page.locator(".task-bar[data-selected=true]")).toHaveCount(2);
  expect(await current(page)).toEqual(d);
  await expect(
    page.getByRole("button", { name: "Отменить", exact: true }),
  ).toBeDisabled();
  expect(await entity(page, a.id).getAttribute("data-start")).toBe(a.startDate);
});
test("horizontal group move previews, cancels and commits once with persistent Undo/Redo and shared rows", async ({
  page,
}) => {
  const d = await current(page),
    a = required(d.tasks[0]),
    b = required(d.tasks[1]);
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  await entity(page, a.id).click();
  await entity(page, b.id).click({ modifiers: ["Control"] });
  await move(page, a.id, 2 * (await scale(page)), 0, false);
  expect(await current(page)).toEqual(d);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await current(page)).toEqual(d);
  await move(page, a.id, 2 * (await scale(page)), 0);
  await saved(page);
  const n = await current(page);
  expect(n.project.revision).toBe(d.project.revision + 1);
  expect(n.tasks.slice(0, 2).map((t) => t.startDate)).toEqual([
    "2026-11-04",
    "2026-11-06",
  ]);
  expect(n.tasks[0]?.laneId).toBe(n.tasks[1]?.laneId);
  await page.reload();
  await saved(page);
  await undo(page);
  expect(semantic(await current(page))).toBe(semantic(d));
  await undo(page, true);
  expect(semantic(await current(page))).toBe(semantic(n));
});
test("vertical stack retains two rows for three works, compacts the source, and changes no dates", async ({
  page,
}) => {
  let d = await current(page);
  const p = required(d.processes[0]);
  for (const title of ["Вторая строка", "Оставшаяся строка"])
    d = applyCommand(d, {
      type: "CreateWork",
      kind: "task",
      id: crypto.randomUUID(),
      newLaneId: laneIdSchema.parse(crypto.randomUUID()),
      laneId: null,
      parentId: p.id,
      title,
      startDate: dateOnly("2026-11-02"),
      endDateExclusive: dateOnly("2026-11-03"),
    });
  await seed(page, d);
  const selected = [
      required(d.tasks[0]),
      required(d.tasks[1]),
      required(d.tasks.at(-2)),
    ],
    remaining = required(d.tasks.at(-1));
  await entity(page, required(selected[0]).id).click();
  for (const t of selected.slice(1))
    await entity(page, t.id).click({ modifiers: ["Control"] });
  await move(page, required(selected[0]).id, 0, 20, false);
  expect(await current(page)).toEqual(d);
  await page.mouse.up();
  await saved(page);
  const n = await current(page);
  expect(n.tasks.map((t) => [t.id, t.startDate, t.endDateExclusive])).toEqual(
    d.tasks.map((t) => [t.id, t.startDate, t.endDateExclusive]),
  );
  expect(
    new Set(
      n.tasks
        .filter((t) => selected.some((s) => s.id === t.id))
        .map((t) => t.laneId),
    ).size,
  ).toBe(2);
  const rows = n.lanes
    .filter((l) => l.kind === "task" && l.processId === p.id)
    .sort((a, b) => a.sortIndex - b.sortIndex);
  expect(rows[0]?.id).toBe(remaining.laneId);
  await undo(page);
  expect(semantic(await current(page))).toBe(semantic(d));
});
test("task group moves to another process, keeping dates and fields with one reversible command", async ({
  page,
}) => {
  const d = await current(page),
    a = required(d.tasks[0]),
    b = required(d.tasks[1]),
    target = required(d.processes[1]);
  await entity(page, a.id).click();
  await entity(page, b.id).click({ modifiers: ["Control"] });
  const from = await box(entity(page, a.id).locator(".move-handle")),
    to = await box(entity(page, required(d.tasks[2]).id));
  await move(page, a.id, 0, to.y + 12 - (from.y + from.height / 2));
  await saved(page);
  const n = await current(page);
  expect(
    n.tasks
      .filter((t) => [a.id, b.id].includes(t.id))
      .every((t) => t.processId === target.id),
  ).toBe(true);
  expect(n.tasks.map((t) => t.startDate)).toEqual(
    d.tasks.map((t) => t.startDate),
  );
  expect(n.project.revision).toBe(d.project.revision + 1);
  await undo(page);
  expect(semantic(await current(page))).toBe(semantic(d));
});
test("create, duplicate and delete work are available in the UI and keep linked results through Undo", async ({
  page,
}) => {
  const d = await current(page);
  await page.getByRole("button", { name: "+ Процесс", exact: true }).click();
  await addForm(page, "Новый процесс", "2026-11-02", "2026-11-04");
  let n = await current(page);
  expect(n.processes).toHaveLength(5);
  const p = required(n.processes.at(-1));
  await entity(page, p.id).click();
  await page.getByRole("button", { name: "Добавить задачу в процесс" }).click();
  await addForm(page, "Новая задача", "2026-11-02", "2026-11-03");
  await page
    .getByLabel("Название результата", { exact: true })
    .fill("Итог нового");
  await page.getByLabel("Название результата", { exact: true }).press("Enter");
  await saved(page);
  n = await current(page);
  const before = structuredClone(n);
  await page
    .getByRole("button", { name: "Дублировать процесс", exact: true })
    .click();
  await saved(page);
  n = await current(page);
  const copy = required(n.processes.at(-1));
  expect(n.tasks.filter((t) => t.processId === copy.id)).toHaveLength(1);
  expect(
    n.results.some((r) => r.processId === copy.id && r.title === "Итог нового"),
  ).toBe(true);
  expect(n.processes.slice(0, -1)).toEqual(before.processes);
  await page
    .getByRole("button", { name: "Удалить процесс", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Удаление работы" })
    .getByRole("button", { name: "Удалить", exact: true })
    .click();
  await saved(page);
  expect((await current(page)).processes.some((x) => x.id === p.id)).toBe(
    false,
  );
  await undo(page);
  expect((await current(page)).results.some((r) => r.processId === p.id)).toBe(
    true,
  );
  expect((await current(page)).processes).toHaveLength(d.processes.length + 2);
});
test("task copying falls below when blocked, then uses free space on the right without shifting neighbours", async ({
  page,
}) => {
  const d = await current(page),
    a = required(d.tasks[0]),
    b = required(d.tasks[1]);
  await entity(page, a.id).click();
  await page
    .getByRole("button", { name: "Дублировать задачу", exact: true })
    .click();
  await saved(page);
  let n = await current(page),
    copy = required(n.tasks.at(-1));
  expect(copy.startDate).toBe(a.startDate);
  expect(copy.laneId).not.toBe(a.laneId);
  expect(n.tasks.slice(0, -1)).toEqual(d.tasks);
  await undo(page);
  await entity(page, b.id).click();
  await page
    .getByRole("button", { name: "Удалить задачу", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Удалить", exact: true })
    .click();
  await saved(page);
  await entity(page, a.id).click();
  await page
    .getByRole("button", { name: "Дублировать задачу", exact: true })
    .click();
  await saved(page);
  n = await current(page);
  copy = required(n.tasks.at(-1));
  expect(copy.startDate).toBe("2026-11-04");
  expect(copy.laneId).toBe(a.laneId);
});
test("folder navigation and left Home remain available across home, editor, Back and F5 with stable project order", async ({
  page,
}) => {
  const a = await current(page);
  await home(page);
  await create(page, "Проект Б");
  const nav = page.getByRole("navigation", {
      name: "Проекты рабочего пространства",
    }),
    tabs = nav.locator("[data-project-tab]"),
    order = await tabs.evaluateAll((es) =>
      es.map((e) => e.getAttribute("data-project-tab")),
    );
  await nav
    .getByRole("button", { name: "Открыть проект: Проект А", exact: true })
    .click();
  await saved(page);
  expect((await current(page)).project.id).toBe(a.project.id);
  expect(
    await tabs.evaluateAll((es) =>
      es.map((e) => e.getAttribute("data-project-tab")),
    ),
  ).toEqual(order);
  await home(page);
  await expect(
    nav.getByRole("button", { name: "Домой", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(tabs).toHaveCount(2);
  await page.getByRole("button", { name: "Таймлайн", exact: true }).click();
  await saved(page);
  await nav
    .getByRole("button", { name: "Открыть проект: Проект Б", exact: true })
    .click();
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Таймлайн", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await saved(page);
  await expect(
    nav.getByRole("button", { name: "Домой", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(tabs).toHaveCount(2);
  const h = await box(nav.getByRole("button", { name: "Домой", exact: true })),
    t = await box(tabs.first());
  expect(h.x + h.width).toBeLessThan(t.x);
});
test("project rename updates its tab immediately; Home stays fixed while many tabs scroll", async ({
  page,
}) => {
  const d = await current(page);
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  await page
    .getByLabel("Название", { exact: true })
    .fill("Очень длинное новое название проекта");
  await page.getByLabel("Название", { exact: true }).press("Enter");
  await saved(page);
  const nav = page.getByRole("navigation", {
    name: "Проекты рабочего пространства",
  });
  await expect(
    nav.getByRole("button", {
      name: "Открыть проект: Очень длинное новое название проекта",
      exact: true,
    }),
  ).toHaveAttribute("title", "Очень длинное новое название проекта");
  await home(page);
  for (let i = 0; i < 6; i++) {
    await create(page, `Длинное название папки ${String(i)}`);
    await home(page);
  }
  const button = nav.getByRole("button", { name: "Домой", exact: true }),
    b = await box(button);
  await page.getByTestId("folder-tabs").evaluate((e) => {
    e.scrollLeft = e.scrollWidth;
  });
  expect((await box(button)).x).toBe(b.x);
  await expect(button).toBeVisible();
  expect(
    await nav.getByRole("button", { name: "Домой", exact: true }).count(),
  ).toBe(1);
  expect(d.project.id).toBeTruthy();
});
test("collapsing the inspector commits text, keeps selection/view/history and persists through project switches/F5", async ({
  page,
}) => {
  const d = await current(page),
    p = required(d.processes[0]);
  await page.getByRole("button", { name: "Результаты", exact: true }).click();
  await page
    .getByRole("button", { name: "Уменьшить масштаб", exact: true })
    .click();
  await saved(page);
  const zoom = await scale(page),
    width = (await box(page.locator(".calendar-time"))).width;
  await page
    .getByLabel("Название", { exact: true })
    .fill("Сохраняется при сворачивании");
  await page
    .getByRole("button", { name: "Свернуть свойства", exact: true })
    .click();
  await saved(page);
  await expect(
    page.getByRole("button", { name: "Развернуть свойства", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await box(page.locator(".calendar-time"))).width)
    .toBeGreaterThan(width + 200);
  expect(await scale(page)).toBe(zoom);
  const n = await current(page);
  expect(n.project.revision).toBe(d.project.revision + 1);
  await page.reload();
  await saved(page);
  await expect(
    page.getByRole("button", { name: "Развернуть свойства", exact: true }),
  ).toBeVisible();
  await home(page);
  await create(page, "Другой");
  await expect(
    page.getByRole("button", { name: "Развернуть свойства", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Открыть проект: Проект А", exact: true })
    .click();
  await saved(page);
  await page
    .getByRole("button", { name: "Развернуть свойства", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Свойства элемента" }),
  ).toHaveAttribute("data-selected-id", p.id);
  await expect(page.getByLabel("Название", { exact: true })).toHaveValue(
    "Сохраняется при сворачивании",
  );
  expect(await current(page)).toEqual(n);
});
test("a selected group crosses result columns by calendar days and rejects drop inside a column", async ({
  page,
}) => {
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  await page.getByRole("button", { name: "Результаты", exact: true }).click();
  await page.getByRole("button", { name: "Весь проект", exact: true }).click();
  await saved(page);
  const d = await current(page),
    a = required(d.tasks[0]),
    b = required(d.tasks[1]);
  await entity(page, a.id).click();
  await entity(page, b.id).click({ modifiers: ["Control"] });
  const from = await box(entity(page, a.id).locator(".move-handle")),
    gap = await box(page.locator("[data-result-column]").first());
  await move(page, a.id, gap.x + gap.width / 2 - (from.x + from.width / 2), 0);
  await saved(page);
  expect(await current(page)).toEqual(d);
  await expect(page.getByRole("alert")).toContainText("внутри колонки");
  await move(page, a.id, 8 * (await scale(page)) + 260, 0);
  await saved(page);
  const n = await current(page);
  expect(n.tasks.slice(0, 2).map((t) => t.startDate)).toEqual([
    "2026-11-10",
    "2026-11-12",
  ]);
  expect(n.project.revision).toBe(d.project.revision + 1);
  await undo(page);
  expect(semantic(await current(page))).toBe(semantic(d));
});
test('process group shifts children once; vertical process ordering leaves every calendar date unchanged',async({page})=>{
 const d=await current(page),a=required(d.processes[0]),b=required(d.processes[1]);await page.getByLabel('Шаг',{exact:true}).selectOption('1d');await entity(page,a.id).click();await entity(page,b.id).click({modifiers:['Control']});
 await move(page,a.id,2*await scale(page),0);await saved(page);let n=await current(page);expect(n.processes.slice(0,2).map(p=>p.startDate)).toEqual(['2026-11-04','2026-11-04']);expect(n.tasks.slice(0,4).map(t=>t.startDate)).toEqual(['2026-11-04','2026-11-06','2026-11-04','2026-11-06']);await undo(page);
 const before=await current(page);await entity(page,a.id).click();await move(page,a.id,0,80);await saved(page);n=await current(page);expect(n.tasks).toEqual(before.tasks);expect(n.processes.map(p=>[p.id,p.startDate,p.endDateExclusive])).toEqual(before.processes.map(p=>[p.id,p.startDate,p.endDateExclusive]));const rows=n.lanes.filter(l=>l.kind==='process'&&l.stageId===a.stageId).sort((a,b)=>a.sortIndex-b.sortIndex);expect(rows[0]?.id).toBe(b.laneId);expect(n.project.revision).toBe(before.project.revision+1);await undo(page);expect(semantic(await current(page))).toBe(semantic(d));
});
test('task reparent at the shared boundary chooses the starting process on a shared row',async({page})=>{
 let d=await current(page);const early=required(d.processes[0]),targetId=crypto.randomUUID();d=applyCommand(d,{type:'CreateWork',kind:'process',id:targetId,parentId:early.stageId,title:'Следующий в строке',startDate:dateOnly('2026-11-06'),endDateExclusive:dateOnly('2026-11-09'),laneId:early.laneId,newLaneId:laneIdSchema.parse(crypto.randomUUID())});await seed(page,d);
 await page.getByLabel('Шаг',{exact:true}).selectOption('1d');const task=required(d.tasks[2]);await entity(page,task.id).click();const b=await box(entity(page,task.id).locator('.move-handle')),target=await box(entity(page,required(d.tasks[0]).id)),x=b.x+b.width/2,y=b.y+b.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-10,{steps:2});await page.mouse.move(x+4*await scale(page),target.y+12,{steps:8});await page.mouse.up();await saved(page);
 const moved=required((await current(page)).tasks.find(t=>t.id===task.id));expect(moved.processId).toBe(targetId);expect(moved.startDate).toBe('2026-11-06');await undo(page);expect(semantic(await current(page))).toBe(semantic(d));
});
