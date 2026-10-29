import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Moscow' });
const today = '2026-10-29';
const boundary = '00000012-0000-4000-8000-000000000002';
const taskId = '00000015-0000-4000-8000-000000000001';
const processId = '00000014-0000-4000-8000-000000000001';

async function rect(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error('Expected calendar geometry');
  return value;
}
async function x(locator: Locator) { return locator.evaluate((element) => element.getBoundingClientRect().x); }
async function schedule(page: Page) {
  return page.locator('[data-entity-id]').evaluateAll((elements) => elements.map((element) => [element.getAttribute('data-entity-id'), element.getAttribute('data-start'), element.getAttribute('data-end')]));
}
async function checkColumns(page: Page) {
  const date = await page.locator('.calendar-cell').nth(2).getAttribute('data-start');
  if (!date) throw new Error('Missing calendar cell');
  const header = await x(page.locator(`.calendar-cell[data-start="${date}"]`));
  for (const layer of ['.stage-band', '.timeline-canvas', '.performers-time-background']) {
    expect(Math.abs(await x(page.locator(`${layer} .calendar-column-line[data-date="${date}"]`)) - header)).toBeLessThanOrEqual(1);
  }
  const task = page.locator(`[data-entity-id="${taskId}"]`);
  const assignment = page.locator(`.performer-segment[data-target-id="${taskId}"]`);
  expect(Math.abs(await x(task) - await x(assignment))).toBeLessThanOrEqual(1);
  const marker = page.locator(`[data-stage-id="${boundary}"]`);
  const markerBox = await rect(marker);
  const markerDate = await marker.getAttribute('data-date');
  for (const layer of ['.stage-band', '.timeline-canvas', '.performers-time-background']) {
    expect(Math.abs(await x(page.locator(`${layer} .stage-line[data-date="${markerDate ?? ''}"]`)) - markerBox.x - markerBox.width / 2)).toBeLessThanOrEqual(1);
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T09:00:00Z') });
  await page.goto('./');
  await expect(page.getByRole('main')).toHaveAttribute('data-px-per-day', '14');
});

test('starts with readable weeks, real months and a separate fixed gutter', async ({ page }) => {
  const viewport = await rect(page.locator('.calendar-time'));
  const cells = page.locator('.calendar-cell');
  expect((await rect(cells.nth(1))).width).toBeGreaterThanOrEqual(75);
  expect((await rect(cells.nth(1))).width).toBeCloseTo(98, 1);
  expect(await page.locator('.calendar-cell[data-labelled="true"]').count()).toBeGreaterThanOrEqual(6);
  await expect(page.locator('.calendar-month').filter({ hasText: 'Октябрь 2026' })).toBeVisible();
  await expect(page.locator('.calendar-month').filter({ hasText: 'Ноябрь 2026' })).toBeVisible();
  const todayX = await x(page.locator('.timeline-canvas .today-line'));
  expect((todayX - viewport.x) / viewport.width).toBeCloseTo(0.32, 2);
  const gutter = await rect(page.locator('.calendar-gutter'));
  expect(viewport.x).toBeCloseTo(gutter.x + gutter.width, 1);
  expect((await rect(page.locator('.timeline-canvas'))).x).toBeCloseTo(viewport.x, 1);
  expect((await rect(page.locator('.performers-time-background'))).x).toBeCloseTo(viewport.x, 1);
  await expect(page.locator('.process-container')).toHaveCount(2);
  await expect(page.getByLabel('Свойства элемента')).toBeVisible();
  await checkColumns(page);
});

test('all six grid steps change actual header cells and lines without editing dates or zoom', async ({ page }) => {
  const original = await schedule(page);
  const counts: number[] = [];
  for (const step of ['1d', '2d', '3d', '1w', '2w', '1mo']) {
    await page.getByLabel('Шаг', { exact: true }).selectOption(step);
    const count = await page.locator('.calendar-cell').count();
    counts.push(count);
    await expect(page.locator('.timeline-canvas .calendar-column-line')).toHaveCount(count);
    await expect(page.locator('.stage-band .calendar-column-line')).toHaveCount(count);
    await expect(page.locator('.performers-time-background .calendar-column-line')).toHaveCount(count);
    await expect(page.getByRole('main')).toHaveAttribute('data-px-per-day', '14');
    expect(await schedule(page)).toEqual(original);
    if (step === '1d') await expect(page.locator(`.calendar-cell[data-start="${today}"]`)).toHaveText('29');
    if (step === '1w') await expect(page.locator('.calendar-cell[data-start="2026-10-26"]')).toContainText('26 окт — 1 ноя');
    if (step === '1mo') await expect(page.locator('.calendar-cell[data-start="2026-11-01"]')).toContainText('Ноябрь');
  }
  expect(new Set(counts).size).toBe(6);
});

test('pan and zoom align every layer, preserve the center date and leave the gutter fixed', async ({ page }) => {
  const original = await schedule(page);
  const gutterX = await x(page.locator('.calendar-gutter'));
  const canvas = await rect(page.locator('.timeline-canvas'));
  const startX = canvas.x + canvas.width - 80;
  const startY = canvas.y + 10;
  const initialPan = Number(await page.getByRole('main').getAttribute('data-pan-x'));
  await page.mouse.move(startX, startY); await page.mouse.down();
  await page.mouse.move(startX - 70, startY, { steps: 5 }); await page.mouse.up();
  expect(Number(await page.getByRole('main').getAttribute('data-pan-x'))).toBeCloseTo(initialPan - 70, 1);
  await checkColumns(page);
  await page.mouse.move(startX, startY); await page.mouse.down({ button: 'middle' });
  await page.mouse.move(startX + 35, startY, { steps: 5 }); await page.mouse.up({ button: 'middle' });
  expect(Number(await page.getByRole('main').getAttribute('data-pan-x'))).toBeCloseTo(initialPan - 35, 1);
  const width = (await rect(page.locator('.calendar-time'))).width;
  const pan = Number(await page.getByRole('main').getAttribute('data-pan-x'));
  const centerOffset = (width / 2 - pan) / 14;
  await page.getByRole('button', { name: 'Увеличить масштаб' }).click();
  const zoom = Number(await page.getByRole('main').getAttribute('data-px-per-day'));
  const nextPan = Number(await page.getByRole('main').getAttribute('data-pan-x'));
  expect((width / 2 - nextPan) / zoom).toBeCloseTo(centerOffset, 5);
  await checkColumns(page);
  expect(await x(page.locator('.calendar-gutter'))).toBe(gutterX);
  expect(await schedule(page)).toEqual(original);
});

test('Today and Fit Project only change the camera, and resize never resets it', async ({ page }) => {
  const original = await schedule(page);
  const width = (await rect(page.locator('.calendar-time'))).width;
  await page.getByRole('button', { name: 'Весь проект', exact: true }).click();
  const fit = Number(await page.getByRole('main').getAttribute('data-px-per-day'));
  expect(fit).toBeCloseTo((width - 48) / 365, 3);
  const start = await rect(page.locator('.stage-grip').first());
  const end = await rect(page.locator('.stage-grip').last());
  const viewport = await rect(page.locator('.calendar-time'));
  expect(start.x).toBeGreaterThan(viewport.x);
  expect(end.x + end.width).toBeLessThan(viewport.x + viewport.width);
  for (let step = 0; step < 9; step++) await page.getByRole('button', { name: 'Увеличить масштаб' }).click();
  expect(Number(await page.getByRole('main').getAttribute('data-px-per-day')) * 7).toBeGreaterThan(75);
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
  const todayX = await x(page.locator('.timeline-canvas .today-line'));
  expect(todayX - viewport.x).toBeCloseTo(width / 2, 1);
  const pan = await page.getByRole('main').getAttribute('data-pan-x');
  const zoom = await page.getByRole('main').getAttribute('data-px-per-day');
  for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size);
    await expect(page.getByRole('main')).toHaveAttribute('data-pan-x', pan ?? '');
    await expect(page.getByRole('main')).toHaveAttribute('data-px-per-day', zoom ?? '');
    expect((await rect(page.locator('.calendar-time'))).x + (await rect(page.locator('.calendar-time'))).width).toBeLessThanOrEqual((await rect(page.getByLabel('Свойства элемента'))).x + 1);
  }
  expect(await schedule(page)).toEqual(original);
});

test('weekends span the October/November boundary and toggle in all three grids', async ({ page }) => {
  const original = await schedule(page);
  for (const date of ['2026-10-31', '2026-11-01']) {
    await expect(page.locator(`.weekend-shade[data-date="${date}"]`)).toHaveCount(3);
    const headerX = await x(page.locator('.calendar-time'));
    const positions = await page.locator(`.weekend-shade[data-date="${date}"]`).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().x));
    expect(positions.every((position) => Math.abs(position - (positions[0] ?? headerX)) <= 1)).toBe(true);
    expect((await rect(page.locator(`.timeline-canvas .weekend-shade[data-date="${date}"]`))).width).toBeCloseTo(14, 1);
  }
  await expect(page.locator('.weekend-shade[data-date="2026-11-02"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Выходные', exact: true }).click();
  await expect(page.locator('.weekend-shade')).toHaveCount(0);
  await page.getByRole('button', { name: 'Выходные', exact: true }).click();
  await expect(page.locator('.weekend-shade[data-date="2026-11-01"]')).toHaveCount(3);
  expect(await schedule(page)).toEqual(original);
});

test('stage date input and drag share validation and update the same date and line', async ({ page }) => {
  await page.getByLabel('Шаг', { exact: true }).selectOption('1d');
  const marker = page.locator(`[data-stage-id="${boundary}"]`);
  const original = await schedule(page);
  const startX = (await rect(marker)).x;
  await marker.click();
  const dialog = page.getByRole('dialog', { name: 'Дата границы этапа' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Дата границы', { exact: true }).fill('2027-03-01');
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('соседний этап');
  await expect(marker).toHaveAttribute('data-date', '2026-11-01');
  await dialog.getByLabel('Дата границы', { exact: true }).fill('2026-11-08');
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(marker).toHaveAttribute('data-date', '2026-11-08');
  expect((await rect(marker)).x - startX).toBeCloseTo(98, 1);
  await expect(page.locator('.stage-date').nth(1)).toHaveText('08.11.2026');
  await checkColumns(page);
  const position = await rect(marker);
  await page.mouse.move(position.x + 6, position.y + 6); await page.mouse.down();
  await page.mouse.move(position.x + 6 - 98, position.y + 6, { steps: 5 }); await page.mouse.up();
  await expect(marker).toHaveAttribute('data-date', '2026-11-01');
  await expect(page.locator('.stage-date').nth(1)).toHaveText('01.11.2026');
  expect(await schedule(page)).toEqual(original);
});

test('a working-scale process handle shifts children once despite a clipped original start', async ({ page }) => {
  await page.getByLabel('Шаг', { exact: true }).selectOption('1d');
  const handle = page.locator(`[data-entity-id="${processId}"] .move-handle`);
  const position = await rect(handle);
  expect(position.x).toBeGreaterThan((await rect(page.locator('.calendar-gutter'))).width);
  await page.mouse.move(position.x + 7, position.y + 10); await page.mouse.down();
  await page.mouse.move(position.x + 7 + 98, position.y + 10, { steps: 5 }); await page.mouse.up();
  await expect(page.locator(`[data-entity-id="${processId}"]`)).toHaveAttribute('data-start', '2026-09-16');
  await expect(page.locator(`[data-entity-id="${taskId}"]`)).toHaveAttribute('data-start', '2026-09-16');
  await expect(page.getByRole('main')).toHaveAttribute('data-project-revision', '1');
  await checkColumns(page);
});

test('local midnight updates Today without resetting the view', async ({ page }) => {
  const pan = await page.getByRole('main').getAttribute('data-pan-x');
  const before = await x(page.locator('.timeline-canvas .today-line'));
  await page.clock.fastForward(13 * 60 * 60 * 1000);
  await expect(page.locator('.timeline-canvas .today-line')).toHaveAttribute('data-today', '2026-10-30');
  expect(await x(page.locator('.timeline-canvas .today-line')) - before).toBeCloseTo(14, 1);
  await expect(page.getByRole('main')).toHaveAttribute('data-pan-x', pan ?? '');
});

test('1280, 1440 and 1920 layouts keep readable cells, aligned month boundaries and an unobstructed inspector', async ({ page }) => {
  for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size);
    await page.reload();
    await expect(page.getByRole('main')).toHaveAttribute('data-px-per-day', '14');
    const viewport = await rect(page.locator('.calendar-time'));
    const inspector = await rect(page.getByLabel('Свойства элемента'));
    expect(viewport.x + viewport.width).toBeLessThanOrEqual(inspector.x + 1);
    expect(await page.locator('.calendar-cell[data-labelled="true"]').count()).toBeGreaterThanOrEqual(6);
    const monthX = await x(page.locator('.calendar-month[data-start="2026-11-01"]'));
    for (const layer of ['.stage-band', '.timeline-canvas', '.performers-time-background']) {
      expect(Math.abs(await x(page.locator(`${layer} .calendar-month-line[data-date="2026-11-01"]`)) - monthX)).toBeLessThanOrEqual(1);
    }
    const top = (await rect(page.locator('.calendar-time'))).y;
    await page.locator('.timeline-body').evaluate((element) => { element.scrollTop = 100; });
    expect((await rect(page.locator('.calendar-time'))).y).toBe(top);
    const cellLabelsFit = await page.locator('.calendar-cell[data-labelled="true"] .calendar-cell-label').evaluateAll((labels) => labels.every((element) => element.scrollWidth <= element.clientWidth + 1));
    expect(cellLabelsFit).toBe(true);
  }
});

test('outside the project, initial focus uses the project start and Today still navigates without changing the schedule', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2030-06-15T09:00:00Z'));
  await page.reload();
  const original = await schedule(page);
  const viewport = await rect(page.locator('.calendar-time'));
  const start = await rect(page.locator('.stage-grip').first());
  expect(start.x + start.width / 2 - viewport.x).toBeCloseTo(viewport.width * 0.32, 1);
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
  await expect(page.locator('.timeline-canvas .today-line')).toHaveAttribute('data-today', '2030-06-15');
  expect(await x(page.locator('.timeline-canvas .today-line')) - viewport.x).toBeCloseTo(viewport.width / 2, 1);
  await expect(page.locator('.calendar-gutter')).toContainText('2030');
  expect(await schedule(page)).toEqual(original);
});
