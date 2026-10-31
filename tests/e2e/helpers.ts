import { required } from "../../src/testing/required";
import { expect } from "@playwright/test";
import type { Page, Locator } from "@playwright/test";
import { snapshotSchema } from "../../src/domain/v2/model";
export async function saved(page: Page) {
  await expect(
    page.getByRole("status", { name: "Состояние хранения" }),
  ).toHaveText("Локально в этом браузере");
}
export async function home(page: Page) {
  await page.getByRole("button", { name: "Проекты", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Проекты", exact: true }),
  ).toBeVisible();
  await saved(page);
}
export async function create(
  page: Page,
  name = "Нейтральный",
  start = "2026-11-02",
) {
  await page
    .getByRole("button", { name: "+ Новый проект", exact: true })
    .click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Название проекта", { exact: true }).fill(name);
  await form.getByLabel("Начальная дата").fill(start);
  await form
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await expect(
    page.getByRole("main", { name: "Редактор таймлайна" }),
  ).toBeVisible();
  await saved(page);
  return required((await documents(page)).find((d) => d.project.name === name));
}
export async function documents(page: Page) {
  const rows = await page.evaluate(
    async () =>
      new Promise<unknown[]>((resolve, reject) => {
        const r = indexedDB.open("timeline-workspace-v2");
        r.onerror = () => {
          reject(new Error("DB failed"));
        };
        r.onsuccess = () => {
          const db = r.result;
          const q = db
            .transaction("documents", "readonly")
            .objectStore("documents")
            .getAll();
          q.onsuccess = () => {
            db.close();
            resolve(q.result as unknown[]);
          };
          q.onerror = () => {
            reject(new Error("Read failed"));
          };
        };
      }),
  );
  return snapshotSchema.array().parse(rows);
}
export async function current(page: Page) {
  const id = page.url().split("/").at(-1);
  return required((await documents(page)).find((d) => d.project.id === id));
}
export function entity(page: Page, id: string) {
  return page.locator(`[data-entity-id="${id}"]`);
}
export async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw Error("Missing geometry");
  return b;
}
export async function drag(
  page: Page,
  handle: Locator,
  dx: number,
  finish = true,
) {
  const b = await box(handle);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, {
    steps: 8,
  });
  if (finish) await page.mouse.up();
}
export async function rename(page: Page, title: string) {
  const field = page.getByLabel("Название", { exact: true });
  await field.fill(title);
  await field.press("Enter");
  await saved(page);
}
export async function action(page: Page, name: string, action: string) {
  const card = page
    .locator(".saved-project-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await card.locator("summary").click();
  await card.getByRole("menuitem", { name: action, exact: true }).click();
  await saved(page);
}
export async function open(page: Page, name: string) {
  await page
    .locator(".saved-project-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .getByRole("button", { name: "Открыть", exact: true })
    .click();
  await expect(
    page.getByRole("main", { name: "Редактор таймлайна" }),
  ).toBeVisible();
}

export async function scale(page:Page){return Number(await page.getByRole('main',{name:'Редактор таймлайна'}).getAttribute('data-px-per-day'));}
