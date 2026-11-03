import { expect, test } from "@playwright/test";
import { create, current, entity, saved } from "./helpers";
import { semantic } from "../../src/application/v2/history";
test.use({ viewport: { width: 1600, height: 1100 } });
for (const effect of ["clip", "deactivate"] as const) {
  test(`V1.6A.1 ${effect}: completed range choice is one durable operation, cancel preserves data`, async ({ page }) => {
    await page.goto("./");
    await create(page, "Активность");
    const before = await current(page);
    await page.getByRole("button", { name: "Проект", exact: true }).click();
    const end = page.getByLabel("Конец", { exact: true });
    if (effect === "clip") {
      await end.fill("10.11.2026"); await end.press("Enter");
    } else {
      await page.getByRole("button", { name: "Календарь: Границы проекта" }).click();
      const calendar = page.getByRole("dialog", { name: "Календарь диапазона" });
      await calendar.locator('[data-range-day="2026-11-15"]').click();
      await calendar.locator('[data-range-day="2026-11-10"]').click();
      await calendar.getByRole("button", { name: "Подтвердить", exact: true }).click();
    }
    const dialog = page.getByRole("dialog", { name: "Сокращение границ проекта" });
    await expect(dialog).toContainText("Процесс 3");
    expect(semantic(await current(page))).toBe(semantic(before));
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    expect(semantic(await current(page))).toBe(semantic(before));
    // Reopen using blur to exercise the same decision flow for manual completion.
    if (effect === "deactivate") await page.getByRole("dialog", { name: "Календарь диапазона" }).getByRole("button", { name: "Отмена", exact: true }).click();
    await end.fill("10.11.2026"); await end.press("Tab");
    await dialog.getByRole("button", { name: effect === "clip" ? "Обрезать работы по границе" : "Не обрезать — сделать затронутые работы неактивными", exact: true }).click();
    await expect(dialog).toHaveCount(0); await saved(page);
    const changed = await current(page);
    expect(changed.project.revision).toBe(before.project.revision + 1);
    expect(changed.project.endDateExclusive).toBe("2026-11-11");
    expect(changed.processes).toHaveLength(before.processes.length);
    expect(changed.tasks).toHaveLength(before.tasks.length);
    if (effect === "deactivate") {
      for (const p of before.processes) expect(changed.processes.find((w) => w.id === p.id)).toMatchObject({ startDate: p.startDate, endDateExclusive: p.endDateExclusive });
      expect(changed.processes[2]?.isActive).toBe(false);
    } else expect(changed.processes[2]?.endDateExclusive).toBe("2026-11-11");
    await page.reload(); await saved(page);
    expect(semantic(await current(page))).toBe(semantic(changed));
    await page.getByRole("button", { name: "Отменить", exact: true }).click(); await saved(page);
    expect(semantic(await current(page))).toBe(semantic(before));
    await page.getByRole("button", { name: "Повторить", exact: true }).click(); await saved(page);
    expect(semantic(await current(page))).toBe(semantic(changed));
  });
}
test("V1.6A.1 checkbox supports Space/Enter and invalid reactivation keeps dates and state", async ({ page }) => {
  await page.goto("./"); const before = await create(page, "Флаг"), p = before.processes[0];
  if (!p) throw Error("Missing process");
  await entity(page, p.id).click();
  const inactive = page.getByRole("checkbox", { name: "Неактивно", exact: true });
  await inactive.focus(); await inactive.press("Space"); await saved(page);
  expect((await current(page)).project.revision).toBe(before.project.revision + 1);
  await expect(entity(page, p.id)).toContainText("Неактивно");
  await inactive.press("Enter"); await saved(page);
  await expect(inactive).not.toBeChecked();
  expect((await current(page)).project.revision).toBe(before.project.revision + 2);
  await inactive.click(); await expect(inactive).toBeChecked(); await saved(page);
  await page.getByLabel("Начало работы", { exact: true }).fill("01.10.2026");
  await page.getByLabel("Начало работы", { exact: true }).press("Enter"); await saved(page);
  const outside = await current(page);
  expect(outside.project.startDate).toBe(before.project.startDate);
  expect(outside.processes[0]?.startDate).toBe("2026-10-01");
  await inactive.click();
  await expect(page.getByRole("alert")).toContainText("Нельзя включить");
  await expect(inactive).toBeChecked();
  expect(semantic(await current(page))).toBe(semantic(outside));
  await page.reload(); await saved(page);
  expect(semantic(await current(page))).toBe(semantic(outside));
});
test("V1.6A.1 stage boundary leaves an inactive process and its tasks at their saved dates", async ({ page }) => {
  await page.goto("./"); const before = await create(page, "Этапы"), p = before.processes[2];
  if (!p) throw Error("Missing process");
  await entity(page, p.id).click();
  await page.getByRole("checkbox", { name: "Неактивно", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Неактивно", exact: true })).toBeChecked();
  await page.getByLabel("Конец работы", { exact: true }).fill("01.12.2026");
  await page.getByLabel("Конец работы", { exact: true }).press("Enter"); await saved(page);
  const outside = await current(page);
  await page.getByRole("button", { name: "Этап: Этап 2", exact: true }).click();
  await page.getByLabel("Начало этапа", { exact: true }).fill("2026-11-10");
  await page.getByLabel("Начало этапа", { exact: true }).press("Enter"); await saved(page);
  const changed = await current(page);
  expect(changed.project.revision).toBe(outside.project.revision + 1);
  expect(changed.processes.find((w) => w.id === p.id)).toMatchObject({ startDate: "2026-11-09", endDateExclusive: "2026-12-02", isActive: false });
  expect(changed.tasks.filter((t) => t.processId === p.id)).toEqual(outside.tasks.filter((t) => t.processId === p.id));
  await page.getByRole("button", { name: "Отменить", exact: true }).click(); await saved(page);
  expect(semantic(await current(page))).toBe(semantic(outside));
});
