import { required } from "../../src/testing/required";
import { expect, test } from "@playwright/test";
import { create, current, box, saved } from "./helpers";
test.use({
  viewport: { width: 1440, height: 900 },
  timezoneId: "America/New_York",
});
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-31T12:00:00Z") });
  await page.goto("./");
  await create(page, "Календарь", "2026-10-26");
});
test("all six calendar grid steps leave content dates, revision and history unchanged", async ({
  page,
}) => {
  const d = await current(page);
  const counts = [];
  for (const step of ["1d", "2d", "3d", "1w", "2w", "1mo"]) {
    await page.getByLabel("Шаг", { exact: true }).selectOption(step);
    await saved(page);
    counts.push(await page.locator(".calendar-cell").count());
    expect(await current(page)).toEqual(d);
    await expect(
      page.getByRole("button", { name: "Отменить", exact: true }),
    ).toBeDisabled();
  }
  expect(new Set(counts).size).toBe(6);
});
test("pan, zoom anchor, today and fit change view alone and retain fixed gutter", async ({
  page,
}) => {
  const d = await current(page);
  const gutter = await box(page.locator(".calendar-gutter"));
  const canvas = await box(page.locator(".timeline-canvas"));
  const editor = page.getByRole("main", { name: "Редактор таймлайна" });
  const pan = Number(await editor.getAttribute("data-pan-x"));
  for (const button of ["left", "middle"] as const) {
    await page.mouse.move(canvas.x + canvas.width - 40, canvas.y + 420);
    await page.mouse.down({ button });
    await page.mouse.move(canvas.x + canvas.width - 90, canvas.y + 420, {
      steps: 5,
    });
    await page.mouse.up({ button });
  }
  expect(Number(await editor.getAttribute("data-pan-x"))).toBeCloseTo(
    pan - 100,
  );
  const width = (await box(page.locator(".calendar-time"))).width;
  const before =
    (width / 2 - Number(await editor.getAttribute("data-pan-x"))) /
    Number(await editor.getAttribute("data-px-per-day"));
  await page
    .getByRole("button", { name: "Увеличить масштаб", exact: true })
    .click();
  expect(
    (width / 2 - Number(await editor.getAttribute("data-pan-x"))) /
      Number(await editor.getAttribute("data-px-per-day")),
  ).toBeCloseTo(before, 5);
  await page.getByRole("button", { name: "Сегодня", exact: true }).click();
  await page.getByRole("button", { name: "Весь проект", exact: true }).click();
  await saved(page);
  expect(await current(page)).toEqual(d);
  expect((await box(page.locator(".calendar-gutter"))).x).toBe(gutter.x);
});
test("stage, work and checkpoint share calendar coordinates; stages occupy neighboring regions", async ({
  page,
}) => {
  const d = await current(page);
  const editor = page.getByRole("main", { name: "Редактор таймлайна" });
  const zoom = Number(await editor.getAttribute("data-px-per-day")),
    pan = Number(await editor.getAttribute("data-pan-x"));
  const regions = page.locator(".stage-region");
  expect(await regions.count()).toBe(2);
  const a = await box(regions.nth(0)),
    b = await box(regions.nth(1));
  expect(a.y).toBe(b.y);
  expect(b.x - a.x).toBeCloseTo(7 * zoom, 1);
  const first = page.locator(
      `[data-entity-id="${required(d.processes[0]).id}"]`,
    ),
    third = page.locator(`[data-entity-id="${required(d.processes[2]).id}"]`);
  expect((await box(first)).y).toBe((await box(third)).y);
  const left = await page
    .locator(".checkpoint-line")
    .evaluate((el) => Number.parseFloat((el as HTMLElement).style.left));
  expect(left).toBeCloseTo(pan + 14 * zoom, 1);
});
test("weekends, month labels and midnight follow local dates without schedule edits", async ({
  page,
}) => {
  const d = await current(page);
  await expect(page.locator(".today-line").first()).toHaveAttribute(
    "data-today",
    "2026-10-31",
  );
  await expect(
    page.locator('.weekend-shade[data-date="2026-11-01"]').first(),
  ).toBeAttached();
  await page.getByRole("button", { name: "Выходные", exact: true }).click();
  await expect(page.locator(".weekend-shade")).toHaveCount(0);
  await page.clock.runFor(24 * 60 * 60 * 1000);
  await expect(page.locator(".today-line").first()).toHaveAttribute(
    "data-today",
    "2026-11-01",
  );
  expect(await current(page)).toEqual(d);
});
test("view preferences survive refresh and resize without changing content", async ({
  page,
}) => {
  const d = await current(page);
  await page.getByLabel("Шаг", { exact: true }).selectOption("2w");
  await page
    .getByRole("button", { name: "Увеличить масштаб", exact: true })
    .click();
  await saved(page);
  const zoom = await page
    .getByRole("main", { name: "Редактор таймлайна" })
    .getAttribute("data-px-per-day");
  await page.reload();
  await expect(page.getByLabel("Шаг", { exact: true })).toHaveValue("2w");
  await expect(
    page.getByRole("main", { name: "Редактор таймлайна" }),
  ).toHaveAttribute("data-px-per-day", zoom ?? "");
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect(await current(page)).toEqual(d);
});
