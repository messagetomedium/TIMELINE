import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { addDays, dateOnly } from '../../src/domain/dates';
import { snapDate } from '../../src/domain/timeline';

test.use({ viewport: { width: 1440, height: 900 } });
const processId = '00000014-0000-4000-8000-000000000001';
const taskId = '00000015-0000-4000-8000-000000000001';
const fourthTask = '00000015-0000-4000-8000-000000000004';
const entity = (page: Page, id: string) => page.locator(`[data-entity-id="${id}"]`);

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error('Expected visible element geometry');
  return value;
}
async function dateAttribute(locator: Locator, name: 'data-start' | 'data-end') {
  const value = await locator.getAttribute(name);
  if (!value) throw new Error('Missing calendar date');
  return dateOnly(value);
}
async function pixelsPerDay(page: Page) {
  return (await box(entity(page, taskId))).width / 42;
}
async function drag(page: Page, handle: Locator, dx: number, finish = true) {
  const bounds = await box(handle);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + dx, bounds.y + bounds.height / 2, { steps: 8 });
  if (finish) await page.mouse.up();
}
async function schedule(page: Page) {
  return page.locator('[data-entity-id]').evaluateAll((elements) => elements.map((element) => [element.getAttribute('data-entity-id'), element.getAttribute('data-start'), element.getAttribute('data-end')]));
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Открыть', exact: true }).first().click();
  await expect(page.getByRole('main', { name: 'Редактор таймлайна' })).toBeVisible();
  await expect(entity(page, processId)).toBeVisible();
  // Preserve the V1 gesture suite in an explicit overview where both edges fit.
  await page.getByRole('button', { name: 'Весь проект', exact: true }).click();
});

test('opens a populated Russian editor, without external requests or console errors', async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => { if (!['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)) external.push(request.url()); });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.locator('.process-bar')).toHaveCount(8);
  await expect(page.locator('.stage-region')).toHaveCount(4);
  await expect(page.locator('.stage-grip')).toHaveCount(5);
  await expect(page.locator('.task-bar')).toHaveCount(8);
  await expect(page.locator('.performer-row')).toHaveCount(8);
  await expect(page.getByLabel('Свойства элемента')).toBeVisible();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Разработка персонажей');
  await expect(page.locator('.calendar-month').first()).toBeAttached();
  await expect(page.locator('.today-line').first()).toBeAttached();
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('keeps multiple processes expanded and switches projects without losing session edits', async ({ page }) => {
  await page.getByRole('button', { name: 'Свернуть: Разработка персонажей', exact: true }).click();
  await expect(entity(page, taskId)).toHaveCount(0);
  await entity(page, processId).click();
  await expect(entity(page, taskId)).toBeVisible();
  await page.getByRole('button', { name: 'Процесс: Сценарий и режиссура', exact: true }).click();
  await expect(page.locator('.process-container')).toHaveCount(3);
  await expect(entity(page, taskId)).toBeVisible();
  const title = page.getByLabel('Название', { exact: true });
  await title.fill('Сценарий: новая версия'); await title.press('Enter');
  await expect(page.getByRole('button', { name: 'Процесс: Сценарий: новая версия', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Проекты', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Процесс: Сценарий: новая версия', exact: true })).toBeVisible();
});

test('double-click edits a title; Esc cancels; ordinary title dragging never changes dates', async ({ page }) => {
  const task = entity(page, taskId);
  const before = await dateAttribute(task, 'data-start');
  await drag(page, task.locator('.bar-title'), 50);
  await expect(task).toHaveAttribute('data-start', before);
  await task.locator('.bar-title').dblclick();
  await page.getByRole('textbox', { name: 'Название на полосе' }).fill('Эскизы героев');
  await page.getByRole('textbox', { name: 'Название на полосе' }).press('Enter');
  await expect(task.locator('.bar-title')).toHaveText('Эскизы героев');
  await task.locator('.bar-title').dblclick();
  await page.getByRole('textbox', { name: 'Название на полосе' }).fill('Не сохранять');
  await page.getByRole('textbox', { name: 'Название на полосе' }).press('Escape');
  await expect(task.locator('.bar-title')).toHaveText('Эскизы героев');
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Эскизы героев');
});

test('zoom, grid and both pan gestures preserve dates and align assignments', async ({ page }) => {
  const task = entity(page, taskId);
  const segment = page.locator(`.performer-segment[data-target-id="${taskId}"]`);
  const before = await schedule(page);
  const beforeWidth = (await box(task)).width;
  await page.getByRole('button', { name: 'Увеличить масштаб' }).click();
  expect((await box(task)).width).toBeCloseTo(beforeWidth * 1.25, 0);
  await page.getByRole('button', { name: 'Уменьшить масштаб' }).click();
  expect((await box(task)).width).toBeCloseTo(beforeWidth, 0);
  await page.getByRole('button', { name: 'Увеличить масштаб' }).click();
  for (const step of ['1d', '2d', '3d', '1w', '2w', '1mo']) {
    await page.getByLabel('Шаг', { exact: true }).selectOption(step);
    expect(await schedule(page)).toEqual(before);
    expect((await box(task)).width).toBeCloseTo(beforeWidth * 1.25, 0);
  }
  expect(await schedule(page)).toEqual(before);
  expect((await box(task)).x).toBeCloseTo((await box(segment)).x, 1);
  const canvas = await box(page.locator('.timeline-body'));
  const startX = canvas.x + canvas.width - 80;
  const startY = canvas.y + 30;
  const x = (await box(task)).x;
  await page.mouse.move(startX, startY); await page.mouse.down();
  await page.mouse.move(startX - 45, startY, { steps: 5 }); await page.mouse.up();
  expect((await box(task)).x).toBeCloseTo(x - 45, 0);
  const nextX = (await box(task)).x;
  await page.mouse.move(startX, startY); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(startX + 30, startY, { steps: 5 }); await page.mouse.up({ button: 'middle' });
  expect((await box(task)).x).toBeCloseTo(nextX + 30, 0);
  expect((await box(task)).x).toBeCloseTo((await box(segment)).x, 1);
  expect(await schedule(page)).toEqual(before);
  await page.getByRole('button', { name: 'Выходные', exact: true }).click();
  await expect(page.locator('.weekend-shade')).toHaveCount(0);
  expect(await schedule(page)).toEqual(before);
});

test('moves a process by its handle, previews without committing, shifts children once', async ({ page }) => {
  await page.getByLabel('Шаг', { exact: true }).selectOption('1d');
  const process = entity(page, processId);
  const task = entity(page, taskId);
  const original = await dateAttribute(process, 'data-start');
  const childOriginal = await dateAttribute(task, 'data-start');
  const stages = await page.locator('.stage-grip').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-date')));
  await drag(page, process.locator('.move-handle'), 7 * await pixelsPerDay(page), false);
  await expect(process).toHaveAttribute('data-start', addDays(original, 7));
  await expect(page.getByRole('main')).toHaveAttribute('data-project-revision', '0');
  await page.mouse.up();
  await expect(page.getByRole('main')).toHaveAttribute('data-project-revision', '1');
  await expect(task).toHaveAttribute('data-start', addDays(childOriginal, 7));
  expect(await page.locator('.stage-grip').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-date')))).toEqual(stages);
});

test('resizes both task edges, grows its parent, and cancels with Esc or pointercancel', async ({ page }) => {
  await page.getByLabel('Шаг', { exact: true }).selectOption('1d');
  const px = await pixelsPerDay(page);
  const task = entity(page, fourthTask);
  const end = await dateAttribute(task, 'data-end');
  await drag(page, task.locator('.resize-handle.end'), 20 * px);
  await expect(task).toHaveAttribute('data-end', addDays(end, 20));
  await expect(entity(page, processId)).toHaveAttribute('data-end', addDays(end, 20));
  const first = entity(page, taskId);
  const start = await dateAttribute(first, 'data-start');
  await drag(page, first.locator('.resize-handle.start'), -10 * px);
  await expect(first).toHaveAttribute('data-start', addDays(start, -10));
  await expect(entity(page, processId)).toHaveAttribute('data-start', addDays(start, -10));
  const revision = await page.getByRole('main').getAttribute('data-project-revision');
  const snapshot = await schedule(page);
  await drag(page, entity(page, processId).locator('.move-handle'), 7 * px, false);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await schedule(page)).toEqual(snapshot);
  await expect(page.getByRole('main')).toHaveAttribute('data-project-revision', revision ?? '');
  await drag(page, entity(page, processId).locator('.move-handle'), 7 * px, false);
  await page.locator('.timeline-surface').dispatchEvent('pointercancel'); await page.mouse.up();
  expect(await schedule(page)).toEqual(snapshot);
});

test('task handle uses Monday snapping and commits one edit; blur cancels a later gesture', async ({ page }) => {
  const task = entity(page, fourthTask);
  const before = await dateAttribute(task, 'data-start');
  const px = await pixelsPerDay(page);
  await drag(page, task.locator('.move-handle'), 7 * px);
  await expect(task).toHaveAttribute('data-start', snapDate(addDays(before, 7), '1w'));
  await expect(page.getByRole('main')).toHaveAttribute('data-project-revision', '1');
  const snapshot = await schedule(page);
  await drag(page, task.locator('.move-handle'), 14 * px, false);
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); });
  await page.mouse.up();
  expect(await schedule(page)).toEqual(snapshot);
  await expect(page.getByRole('main')).toHaveAttribute('data-project-revision', '1');
});

test('rejects a colliding resize and moves a stage independently', async ({ page }) => {
  await page.getByLabel('Шаг', { exact: true }).selectOption('1d');
  const before = await schedule(page);
  const px = await pixelsPerDay(page);
  await drag(page, entity(page, taskId).locator('.resize-handle.end'), 7 * px);
  await expect(page.getByRole('alert')).toContainText('уже есть работа');
  expect(await schedule(page)).toEqual(before);
  const marker = page.locator('.stage-grip').nth(1);
  const original = await marker.getAttribute('data-date');
  if (!original) throw new Error('Missing stage date');
  await drag(page, marker, 7 * px);
  await expect(marker).toHaveAttribute('data-date', addDays(dateOnly(original), 7));
  await expect(page.locator('.stage-date').nth(1)).toHaveText(addDays(dateOnly(original), 7).split('-').reverse().join('.'));
  expect(await schedule(page)).toEqual(before);
});

test('hover highlights linked people and edits persist after reload', async ({ page }) => {
  await entity(page, taskId).hover();
  await expect(page.locator('.performer-row[data-highlighted="true"]')).toHaveCount(1);
  await expect(page.locator(`.performer-segment[data-target-id="${taskId}"]`)).toHaveClass(/linked/);
  await expect(page.getByText('Изменения сохраняются в этом браузере.', { exact: false })).toBeVisible();
  await entity(page, taskId).locator('.bar-title').dblclick();
  await page.getByRole('textbox', { name: 'Название на полосе' }).fill('Изменение в сеансе');
  await page.getByRole('textbox', { name: 'Название на полосе' }).press('Enter');
  await expect(entity(page, taskId).locator('.bar-title')).toHaveText('Изменение в сеансе');
  await page.reload();
  await expect(entity(page, taskId).locator('.bar-title')).toHaveText('Изменение в сеансе');
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBeGreaterThan(0);
});

test('captures the real workspace at 1440×900 and 1920×1080', async ({ page }) => {
  await mkdir('docs/screenshots', { recursive: true });
  await page.reload();
  await page.mouse.move(10, 10);
  await page.screenshot({ path: 'test-results/editor-regression-work-1440.png' });
  await page.getByRole('button', { name: 'Весь проект', exact: true }).click();
  await page.screenshot({ path: 'test-results/editor-regression-project-1440.png' });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.reload();
  await expect(page.getByLabel('Свойства элемента')).toBeVisible();
  await page.screenshot({ path: 'test-results/editor-regression-work-1920.png' });
});
