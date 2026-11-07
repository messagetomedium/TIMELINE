import { expect, test } from "@playwright/test";
import { box, create, current, entity, home, saved } from "./helpers";
import { PROCESS_PALETTE } from "../../src/features/timeline/processPalette";

test.use({ viewport: { width: 1440, height: 900 } });
test("PLINE folder composition keeps navigation, calendar axis and inspector controls in their new zones", async ({ page }) => {
  await page.goto('./'); await create(page); const original = await current(page);
  await home(page);
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const title = await box(page.getByRole('heading', { name: 'Проекты', exact: true })), toggle = await box(page.getByRole('group', { name: 'Представление проектов' }));
    expect(toggle.x).toBeGreaterThan(title.x + title.width); expect(Math.abs(toggle.y + toggle.height / 2 - title.y - title.height / 2)).toBeLessThan(5);
    const grid = page.getByLabel('Карточки проектов'), children = await grid.locator(':scope > *').evaluateAll(nodes => nodes.map(n => n.getAttribute("class")));
    expect(children[0]).toBe('new-project-card');
    const frame = await box(page.locator('.app-content')), archive = await box(page.getByRole('button', { name: 'Архив', exact: true }));
    expect(archive.y + archive.height).toBeLessThanOrEqual(frame.y + 2);
    expect(archive.x).toBeGreaterThan(width / 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator('.saved-project-card').getByRole('button', { name: 'Открыть', exact: true }).click(); await saved(page);
  const scene = await box(page.locator('.timeline-surface')), inspector = await box(page.getByRole('complementary', { name: 'Свойства элемента' }));
  expect(inspector.x).toBeGreaterThanOrEqual(scene.x + scene.width - 1);
  expect(inspector.width / (scene.width + inspector.width)).toBeGreaterThan(.23);
  expect(inspector.width / (scene.width + inspector.width)).toBeLessThan(.27);
  const checkpoints = await box(page.locator('.checkpoint-row')), people = await box(page.getByRole('region', { name: 'Занятость исполнителей' })), toolbar = await box(page.getByRole('toolbar', { name: 'Вид таймлайна' }));
  expect(checkpoints.y).toBeLessThan(people.y); expect(toolbar.y).toBeGreaterThan(people.y);
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(inspector.x);
  const dates = await box(page.locator('.project-dates')), heading = await box(page.locator('.editor-heading h1'));
  expect(dates.y).toBeGreaterThan(heading.y + heading.height);
  expect(await current(page)).toEqual(original);
});

test("PLINE fixed palette keeps legacy color, commits once, supports keyboard and persistent Undo/Redo", async ({ page }) => {
  await page.goto('./'); await create(page); const original = await current(page), process = original.processes[0];
  if (!process) throw Error('Missing process');
  expect(PROCESS_PALETTE.some(c => c.value === process.color)).toBe(false);
  await entity(page, process.id).click();
  const trigger = page.getByRole('button', { name: 'Цвет процесса', exact: true });
  await trigger.click(); await expect(page.getByText('Текущий цвет (из старого проекта)', { exact: true })).toBeVisible();
  expect(await current(page)).toEqual(original); await expect(page.locator('input[type="color"]')).toHaveCount(0);
  const blue = page.getByRole('button', { name: 'Голубой', exact: true }); await blue.focus(); await blue.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Розовый', exact: true })).toBeFocused();
  expect(await current(page)).toEqual(original);
  await page.keyboard.press('Enter'); await saved(page);
  await expect(page.getByRole('group', { name: 'Палитра процессов' })).toHaveCount(0);
  const colored = await current(page); expect(colored.processes[0]?.color).toBe('#EAB2CB'); expect(colored.project.revision).toBe(original.project.revision + 1);
  await trigger.click(); await expect(page.getByRole('button', { name: 'Розовый', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Розовый', exact: true }).click(); expect(await current(page)).toEqual(colored);
  await page.reload(); await saved(page); expect((await current(page)).processes[0]?.color).toBe('#EAB2CB');
  await page.getByRole('button', { name: 'Отменить', exact: true }).click(); await saved(page); expect((await current(page)).processes[0]?.color).toBe(process.color);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click(); await saved(page); expect((await current(page)).processes[0]?.color).toBe('#EAB2CB');
  await expect(entity(page, original.tasks[0]?.id ?? '').locator('.bar-title')).toBeVisible();
  expect(await entity(page, original.tasks[0]?.id ?? '').evaluate(el => el.style.getPropertyValue('--bar-color'))).toBe('#EAB2CB');
});
