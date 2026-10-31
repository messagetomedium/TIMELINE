import { required } from "../../src/testing/required";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  create,
  home,
  saved,
  documents,
  action,
  open,
  drag,
} from "./helpers";
import { productionDemo } from "../../src/infrastructure/demo/production";
import {
  backupSchema,
  defaultPreferences,
} from "../../src/application/workspace/model";
test.use({
  viewport: { width: 1440, height: 900 },
  timezoneId: "Europe/Moscow",
});
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-31T22:30:00Z") });
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Проекты", exact: true }),
  ).toBeVisible();
});
test("fresh storage is empty; local today and chosen date create neutral independent templates", async ({
  page,
}) => {
  await expect(page.locator(".saved-project-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "+ Новый проект", exact: true })
    .click();
  await expect(page.getByLabel("Начальная дата")).toHaveValue("2026-11-01");
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  const d = await create(page, "А", "2028-02-26");
  expect(d.stages).toHaveLength(2);
  expect(d.processes).toHaveLength(4);
  expect(d.tasks).toHaveLength(8);
  expect(d.checkpoints).toHaveLength(1);
  expect(d.project.endDateExclusive).toBe("2028-03-11");
  await expect(page.locator(".process-bar")).toHaveCount(4);
  await expect(page.locator(".task-bar")).toHaveCount(8);
  await expect(page.locator(".performer-row")).toHaveCount(0);
  await expect(page.locator(".checkpoint-line")).toHaveAttribute(
    "data-date",
    "2028-03-10",
  );
  await home(page);
  const b = await create(page, "Б");
  expect(b.project.id).not.toBe(d.project.id);
  expect(required(b.stages[0]).id).not.toBe(required(d.stages[0]).id);
  expect(
    (await documents(page)).find((x) => x.project.id === d.project.id),
  ).toEqual(d);
});
test("cards, portfolio, back and refresh retain shared project data and view", async ({
  page,
}) => {
  await create(page, "А");
  await home(page);
  await create(page, "Б");
  await home(page);
  await page.getByRole("button", { name: "Таймлайн", exact: true }).click();
  await expect(page.locator(".portfolio-row")).toHaveCount(2);
  await expect(page.locator(".result-gap")).toHaveCount(0);
  await page.getByLabel("Шаг", { exact: true }).selectOption("2w");
  await saved(page);
  await page.getByRole("button", { name: "Проект: А", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "Таймлайн", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByLabel("Шаг", { exact: true })).toHaveValue("2w");
});
test("duplicate remaps links and editing the copy leaves source unchanged", async ({
  page,
}) => {
  const d = await create(page, "А");
  await home(page);
  await action(page, "А", "Дублировать");
  await expect(page.locator(".saved-project-card")).toHaveCount(2);
  const copy = required(
    (await documents(page)).find((x) => x.project.id !== d.project.id),
  );
  expect(required(copy.processes[0]).stageId).toBe(required(copy.stages[0]).id);
  expect(required(copy.tasks[0]).processId).toBe(
    required(copy.processes[0]).id,
  );
  await open(page, "А — копия");
  await page.getByRole("button", { name: "Этап: Этап 1", exact: true }).click();
  await page.getByLabel("Название", { exact: true }).fill("Копия");
  await page.getByLabel("Название", { exact: true }).press("Enter");
  await saved(page);
  expect(
    (await documents(page)).find((x) => x.project.id === d.project.id),
  ).toEqual(d);
});
test("portfolio shift commits once, includes stages and free checkpoint, and Esc cancels", async ({
  page,
}) => {
  const d = await create(page, "А");
  await home(page);
  await page.getByRole("button", { name: "Таймлайн", exact: true }).click();
  await page.getByLabel("Шаг", { exact: true }).selectOption("1d");
  await drag(
    page,
    page.getByRole("button", { name: "Переместить проект: А", exact: true }),
    14 * 2,
    false,
  );
  expect((await documents(page))[0]).toEqual(d);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await documents(page))[0]).toEqual(d);
  await drag(
    page,
    page.getByRole("button", { name: "Переместить проект: А", exact: true }),
    14 * 2,
  );
  await saved(page);
  const moved = required((await documents(page))[0]);
  expect(moved.project.startDate).toBe("2026-11-04");
  expect(required(moved.tasks[0]).startDate).toBe("2026-11-04");
  expect(required(moved.stages[1]).startDate).toBe("2026-11-11");
  expect(required(moved.checkpoints[0]).timing).toEqual({
    anchor: "free",
    date: "2026-11-17",
  });
});
test("V2 JSON backup rejects invalid imports and imports collisions as independent copies", async ({
  page,
}) => {
  await create(page, "А");
  await home(page);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Экспортировать резервную копию JSON" })
    .click();
  const file = await (await download).path();
  if (!file) throw Error("No backup");
  const text = await readFile(file, "utf8");
  const backup = JSON.parse(text) as {
    version: number;
  };
  expect(backup.version).toBe(2);
  await page
    .getByLabel("Файл резервной копии")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
  await expect(page.getByRole("alert")).toContainText("JSON-бэкап V2");
  expect(await documents(page)).toHaveLength(1);
  await page
    .getByLabel("Файл резервной копии")
    .setInputFiles({
      name: "good.json",
      mimeType: "application/json",
      buffer: Buffer.from(text),
    });
  await page
    .getByRole("button", { name: "Импортировать как копии", exact: true })
    .click();
  await saved(page);
  expect(await documents(page)).toHaveLength(2);
});
test("V1 namespace remains logically identical and its original JSON export is available", async ({
  page,
}) => {
  const legacy = {
    documents: [
      {
        id: productionDemo.project.id,
        revision: productionDemo.project.revision,
        updatedAt: productionDemo.project.updatedAt,
        value: productionDemo,
      },
    ],
    preferences: [{ key: "workspace", value: defaultPreferences }],
    metadata: [
      { key: "initialized", value: true },
      { key: "schemaVersion", value: 1 },
    ],
  };
  await page.evaluate(
    async (data) =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("timeline-workspace", 10);
        r.onupgradeneeded = () => {
          const db = r.result;
          db.createObjectStore("documents", { keyPath: "id" });
          db.createObjectStore("preferences", { keyPath: "key" });
          db.createObjectStore("metadata", { keyPath: "key" });
        };
        r.onerror = () => {
          reject(new Error("fixture failed"));
        };
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction(
              ["documents", "preferences", "metadata"],
              "readwrite",
            );
          for (const [table, rows] of Object.entries(data))
            for (const row of rows) tx.objectStore(table).put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    legacy,
  );
  await page.reload();
  await expect(page.getByRole("note")).toContainText("без изменений");
  await create(page, "Новый");
  const getLegacy = () =>
    page.evaluate(
      async () =>
        new Promise<Record<string, unknown[]>>((resolve) => {
          const r = indexedDB.open("timeline-workspace");
          r.onsuccess = () => {
            const db = r.result,
              tx = db.transaction(
                ["documents", "preferences", "metadata"],
                "readonly",
              ),
              result: Record<string, unknown[]> = {};
            for (const table of ["documents", "preferences", "metadata"]) {
              const q = tx.objectStore(table).getAll();
              q.onsuccess = () => {
                result[table] = q.result as unknown[];
              };
            }
            tx.oncomplete = () => {
              db.close();
              resolve(result);
            };
          };
        }),
    );
  expect(await getLegacy()).toEqual(legacy);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Экспортировать прежние данные JSON" })
    .click();
  const path = await (await download).path();
  if (!path) throw Error("Missing export");
  expect(
    backupSchema.parse(JSON.parse(await readFile(path, "utf8"))).documents,
  ).toEqual([productionDemo]);
  expect(await getLegacy()).toEqual(legacy);
});
test("storage failure and missing routes show errors without resetting data", async ({
  page,
}) => {
  const d = await create(page, "А");
  await page.goto("./#/projects/00000000-0000-4000-8000-000000000099");
  await expect(
    page.getByRole("heading", { name: "Проект не найден" }),
  ).toBeVisible();
  expect(required((await documents(page))[0]).project.id).toBe(d.project.id);
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new Error("Storage denied");
    };
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Хранилище недоступно" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Storage denied");
});
