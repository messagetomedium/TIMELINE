import { readFile, mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { addDays, dateOnly, daysBetween, projectDocumentSchema } from '../../src/domain';
import { scopedIds, backupSchema } from '../../src/application/workspace/model';

test.use({ viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Moscow' });
const seedName = 'Сказки Амура';
const seedId = '00000011-0000-4000-8000-000000000001';
const card = (page: Page, name: string) => page.locator('.saved-project-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
async function saved(page: Page) { await expect(page.getByRole('status', { name: 'Состояние хранения' })).toHaveText('Локально в этом браузере'); }
async function projects(page: Page) { await page.getByRole('button', { name: 'Проекты', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible(); await saved(page); }
async function cards(page: Page) { await page.getByRole('button', { name: 'Карточки', exact: true }).click(); await saved(page); }
async function action(scope: Locator, name: string) { await scope.locator('.project-actions summary').click(); await scope.getByRole('menuitem', { name, exact: true }).click(); }
async function createProject(page: Page, name: string, start = '2026-11-02', end = '2026-11-30') {
  await page.getByRole('button', { name: '+ Новый проект', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый проект', exact: true });
  await dialog.getByLabel('Название проекта', { exact: true }).fill(name);
  await dialog.getByLabel('Начальная дата', { exact: true }).fill(start);
  await dialog.getByLabel('Конечная дата', { exact: true }).fill(end);
  await dialog.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Редактор таймлайна' })).toBeVisible();
  await saved(page);
}
async function createWork(page: Page, kind: 'process' | 'task', name: string, start: string, end: string) {
  await page.getByRole('button', { name: kind === 'process' ? '+ Процесс' : '+ Задача', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: kind === 'process' ? 'Новый процесс' : 'Новая задача', exact: true });
  await dialog.getByLabel('Название работы', { exact: true }).fill(name);
  await dialog.getByLabel('Начало работы', { exact: true }).fill(start);
  await dialog.getByLabel('Окончание работы', { exact: true }).fill(end);
  await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await saved(page);
}
async function documents(page: Page) {
  const raw = await page.evaluate(async () => new Promise<unknown[]>((resolve, reject) => {
    const opening = indexedDB.open('timeline-workspace');
    opening.onerror = () => { reject(new Error(opening.error?.message ?? 'IndexedDB open failed')); };
    opening.onsuccess = () => {
      const database = opening.result;
      const request = database.transaction('documents').objectStore('documents').getAll();
      request.onerror = () => { database.close(); reject(new Error(request.error?.message ?? 'IndexedDB request failed')); };
      request.onsuccess = () => { const rows = request.result as { value: unknown }[]; database.close(); resolve(rows.map((row) => row.value)); };
    };
  }));
  return projectDocumentSchema.array().parse(raw);
}
async function box(locator: Locator) { const value = await locator.boundingBox(); if (!value) throw new Error('Missing project geometry'); return value; }
async function drag(page: Page, handle: Locator, dx: number, finish = true) {
  const bounds = await box(handle);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + dx, bounds.y + bounds.height / 2, { steps: 8 });
  if (finish) await page.mouse.up();
}
async function portfolio(page: Page) { await page.getByRole('button', { name: 'Таймлайн', exact: true }).click(); await expect(page.getByRole('region', { name: 'Общий таймлайн проектов' })).toBeVisible(); await saved(page); }
async function importFile(page: Page, content: string) { await page.getByLabel('Файл резервной копии').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(content) }); }

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-30T09:00:00Z') });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  await expect(card(page, seedName)).toBeVisible();
  await saved(page);
});

test('cards and portfolio share projects; portfolio preferences, route and browser Back survive navigation', async ({ page }) => {
  await createProject(page, 'Проект Б');
  await expect(page.getByRole('button', { name: 'Карточки', exact: true })).toHaveCount(0);
  await expect(page.locator('.process-bar')).toHaveCount(0);
  await projects(page);
  await expect(page.locator('.saved-project-card')).toHaveCount(2);
  await portfolio(page);
  await expect(page.locator('.portfolio-row')).toHaveCount(2);
  await page.getByLabel('Шаг', { exact: true }).selectOption('2w');
  await page.getByRole('button', { name: 'Увеличить масштаб портфеля' }).click();
  await page.getByRole('button', { name: 'Выходные', exact: true }).click();
  await saved(page);
  const pan = await page.locator('.portfolio').getAttribute('data-pan-x');
  const zoom = await page.locator('.portfolio').getAttribute('data-px-per-day');
  await page.getByRole('button', { name: 'Все проекты', exact: true }).click(); await saved(page);
  const fitPan = await page.locator('.portfolio').getAttribute('data-pan-x');
  await page.getByRole('button', { name: 'Проект: Проект Б', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Редактор таймлайна' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Таймлайн', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.portfolio')).toHaveAttribute('data-pan-x', fitPan ?? '');
  await cards(page); await expect(page.locator('.saved-project-card')).toHaveCount(2);
  await portfolio(page); await saved(page); await page.reload();
  await expect(page.getByRole('button', { name: 'Таймлайн', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Шаг', { exact: true })).toHaveValue('2w');
  await expect(page.getByRole('button', { name: 'Выходные', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.portfolio')).toHaveAttribute('data-pan-x', fitPan ?? '');
  expect(pan).not.toBeNull(); expect(zoom).toBe('17.5');
});

test('a genuinely empty project gains process and task, edits, rename and description persist', async ({ page }) => {
  await createProject(page, 'Проект Б');
  await expect(page.getByRole('heading', { name: 'Чистый лист' })).toBeVisible();
  await expect(page.locator('.process-bar')).toHaveCount(0);
  await expect(page.locator('.task-bar')).toHaveCount(0);
  await createWork(page, 'process', 'Подготовка выставки', '2026-11-02', '2026-11-10');
  await createWork(page, 'task', 'Эскизы', '2026-11-03', '2026-11-05');
  await expect(page.locator('.process-bar')).toHaveCount(1); await expect(page.locator('.task-bar')).toHaveCount(1);
  const beforeCollision = await documents(page);
  await page.getByRole('button', { name: '+ Задача', exact: true }).click();
  const collision = page.getByRole('dialog', { name: 'Новая задача', exact: true });
  await collision.getByLabel('Название работы', { exact: true }).fill('Пересечение');
  await collision.getByLabel('Начало работы', { exact: true }).fill('2026-11-03');
  await collision.getByLabel('Окончание работы', { exact: true }).fill('2026-11-04');
  await collision.getByLabel('Дорожка', { exact: true }).selectOption({ label: 'Дорожка 1' });
  await collision.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('не должны пересекаться');
  expect(await documents(page)).toEqual(beforeCollision);
  await collision.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть сообщение', exact: true }).click();
  await page.locator('.task-bar .bar-title').dblclick();
  await page.getByRole('textbox', { name: 'Название на полосе' }).fill('Эскизы утверждены');
  await page.getByRole('textbox', { name: 'Название на полосе' }).press('Enter');
  await saved(page); await page.reload();
  await expect(page.locator('.task-bar .bar-title')).toHaveText('Эскизы утверждены');
  await expect(page.locator('.task-bar')).toHaveAttribute('data-start', '2026-11-03');
  await expect(page.locator('.task-bar')).toHaveAttribute('data-end', '2026-11-06');
  await projects(page); await action(card(page, 'Проект Б'), 'Переименовать');
  const dialog = page.getByRole('dialog', { name: 'Редактирование проекта' });
  await dialog.getByLabel('Название проекта', { exact: true }).fill('Проект Б — премьера');
  await dialog.getByLabel('Описание', { exact: true }).fill('Сохранённое описание');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(card(page, 'Проект Б — премьера')).toContainText('Сохранённое описание');
  await card(page, 'Проект Б — премьера').getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(page.locator('.header-project strong')).toHaveText('Проект Б — премьера');
  await expect(page).toHaveTitle('Проект Б — премьера — Таймлайн');
  await saved(page); await page.reload(); await expect(page.locator('.header-project strong')).toHaveText('Проект Б — премьера');
});

test('deep copy preserves the whole model and people but has fresh IDs; editing the copy leaves source untouched', async ({ page }) => {
  const source = (await documents(page)).find((document) => document.project.id === seedId);
  if (!source) throw new Error('Missing seed');
  await action(card(page, seedName), 'Дублировать');
  await expect(card(page, `${seedName} — копия`)).toBeVisible(); await saved(page);
  const copies = await documents(page);
  const copy = copies.find((document) => document.project.id !== seedId);
  if (!copy) throw new Error('Missing copied document');
  const oldIds = new Set(scopedIds(source));
  expect(scopedIds(copy).some((id) => oldIds.has(id))).toBe(false);
  expect(copy.tasks).toHaveLength(32); expect(copy.stageBands).toHaveLength(4); expect(copy.assignments).toHaveLength(40);
  expect(copy.people).toEqual(source.people);
  await card(page, `${seedName} — копия`).getByRole('button', { name: 'Открыть', exact: true }).click();
  await page.locator('.task-bar').first().locator('.bar-title').dblclick();
  await page.getByRole('textbox', { name: 'Название на полосе' }).fill('Изменена только копия');
  await page.getByRole('textbox', { name: 'Название на полосе' }).press('Enter'); await saved(page);
  expect((await documents(page)).find((document) => document.project.id === seedId)).toEqual(source);
  await page.reload(); await expect(page.locator('.task-bar').first().locator('.bar-title')).toHaveText('Изменена только копия');
  expect(await documents(page)).toHaveLength(2);
});

test('portfolio handle previews without saving, shifts every descendant once by a week, and Esc never opens or saves', async ({ page }) => {
  await action(card(page, seedName), 'Дублировать'); await expect(page.locator('.saved-project-card')).toHaveCount(2); await saved(page);
  const copy = (await documents(page)).find((document) => document.project.id !== seedId);
  if (!copy) throw new Error('Missing copy');
  await portfolio(page); await page.getByRole('button', { name: 'Все проекты', exact: true }).click();
  const row = page.locator(`.portfolio-row[data-project-id="${copy.project.id}"]`);
  const handle = row.getByRole('button', { name: `Переместить проект: ${copy.project.name}`, exact: true });
  await page.getByLabel('Шаг', { exact: true }).selectOption('1d'); await saved(page);
  let px = Number(await page.locator('.portfolio').getAttribute('data-px-per-day'));
  await drag(page, handle, 6 * px); await saved(page);
  const before = (await documents(page)).find((document) => document.project.id === copy.project.id);
  const other = (await documents(page)).find((document) => document.project.id === seedId);
  if (!before) throw new Error('Missing moved copy');
  expect(before.project.startDate).toBe('2026-09-07');
  await page.getByLabel('Шаг', { exact: true }).selectOption('1w'); await saved(page);
  px = Number(await page.locator('.portfolio').getAttribute('data-px-per-day'));
  await drag(page, handle, 7 * px, false);
  await expect(row.locator('.portfolio-bar')).toHaveClass(/preview/);
  expect((await documents(page)).find((document) => document.project.id === copy.project.id)).toEqual(before);
  await page.mouse.up(); await saved(page);
  await expect(page.getByRole('main', { name: 'Проекты', exact: true })).toBeVisible();
  const after = (await documents(page)).find((document) => document.project.id === copy.project.id);
  if (!after) throw new Error('Missing committed shift');
  expect(after.project.startDate).toBe(addDays(before.project.startDate, 7));
  expect(after.project.endDateExclusive).toBe(addDays(before.project.endDateExclusive, 7));
  expect(after.project.anchorDate).toBe(addDays(before.project.anchorDate, 7));
  for (const key of ['processes', 'tasks'] as const) after[key].forEach((item, index) => { expect(item.startDate).toBe(addDays(before[key][index]?.startDate ?? before.project.startDate, 7)); expect(item.endDateExclusive).toBe(addDays(before[key][index]?.endDateExclusive ?? before.project.endDateExclusive, 7)); });
  after.stageMarkers.forEach((marker, index) => { expect(marker.date).toBe(addDays(before.stageMarkers[index]?.date ?? before.project.startDate, 7)); });
  expect(after.assignments).toEqual(before.assignments); expect(after.stageBands).toEqual(before.stageBands);
  expect((await documents(page)).find((document) => document.project.id === seedId)).toEqual(other);
  await drag(page, handle, 14 * px, false); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.getByRole('main', { name: 'Проекты', exact: true })).toBeVisible();
  expect((await documents(page)).find((document) => document.project.id === copy.project.id)).toEqual(after);
  await page.reload(); await expect(page.locator('.portfolio-row')).toHaveCount(2); expect((await documents(page)).find((document) => document.project.id === copy.project.id)).toEqual(after);
  await page.getByRole('button', { name: `Проект: ${copy.project.name}`, exact: true }).click();
  await expect(page.locator('.process-bar').first()).toHaveAttribute('data-start', after.processes[0]?.startDate ?? '');
});

test('portfolio geometry uses real dates on every step; body drag is inert, pan and zoom affect only the view, fit includes distant empty projects', async ({ page }) => {
  await createProject(page, 'Дальний проект', '2030-01-01', '2030-03-01'); await projects(page); await portfolio(page);
  const before = await documents(page);
  await page.getByRole('button', { name: 'Все проекты', exact: true }).click(); await saved(page);
  const viewport = await box(page.locator('.portfolio .calendar-time'));
  const bars = page.locator('.portfolio-bar');
  for (let index = 0; index < await bars.count(); index++) { const bounds = await box(bars.nth(index)); expect(bounds.x).toBeGreaterThanOrEqual(viewport.x - 1); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1); }
  expect(Number(await page.locator('.portfolio').getAttribute('data-px-per-day'))).toBeLessThan(1.5);
  for (const step of ['1d', '2d', '3d', '1w', '2w', '1mo']) {
    await page.getByLabel('Шаг', { exact: true }).selectOption(step); await saved(page);
    const first = page.locator('.portfolio .calendar-cell').first();
    const anchorDate = dateOnly((await first.getAttribute('data-start')) ?? '2026-01-01');
    const anchorX = (await box(first)).x;
    const px = Number(await page.locator('.portfolio').getAttribute('data-px-per-day'));
    for (let index = 0; index < await bars.count(); index++) { const bar = bars.nth(index); const date = dateOnly((await bar.getAttribute('data-start')) ?? '2026-01-01'); expect((await box(bar)).x).toBeCloseTo(anchorX + daysBetween(anchorDate, date) * px, 0); }
  }
  await drag(page, bars.first().locator('span'), 40); await expect(page.getByRole('main', { name: 'Проекты', exact: true })).toBeVisible();
  expect(await documents(page)).toEqual(before);
  const background = await box(page.locator('.portfolio-body'));
  const pan = Number(await page.locator('.portfolio').getAttribute('data-pan-x'));
  await page.mouse.move(background.x + background.width - 80, background.y + 240); await page.mouse.down();
  await page.mouse.move(background.x + background.width - 130, background.y + 240, { steps: 5 }); await page.mouse.up(); await saved(page);
  expect(Number(await page.locator('.portfolio').getAttribute('data-pan-x'))).toBeCloseTo(pan - 50);
  await page.getByRole('button', { name: 'Увеличить масштаб портфеля' }).click(); await saved(page);
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click(); await saved(page);
  const todayX = await page.locator('.portfolio-background .today-line').evaluate((element) => element.getBoundingClientRect().x);
  expect(todayX - viewport.x).toBeCloseTo(viewport.width / 2, 0);
  expect(await documents(page)).toEqual(before);
});

test('confirmed deletion survives refresh; JSON round-trip is validated, collision-aware and never partially imports', async ({ page }) => {
  await createProject(page, 'Проект Б'); await createWork(page, 'process', 'Процесс Б', '2026-11-02', '2026-11-10'); await createWork(page, 'task', 'Задача Б', '2026-11-03', '2026-11-05'); await projects(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспортировать резервную копию JSON', exact: true }).click();
  const download = await downloading;
  const path = await download.path(); if (!path) throw new Error('Missing backup file');
  const text = await readFile(path, 'utf8');
  const backup = backupSchema.parse(JSON.parse(text)); expect(backup.documents).toHaveLength(2);
  const beforeCancel = await documents(page);
  await importFile(page, text);
  await page.getByRole('dialog', { name: 'Импорт резервной копии' }).getByRole('button', { name: 'Отмена', exact: true }).click();
  expect(await documents(page)).toEqual(beforeCancel);
  await action(card(page, seedName), 'Удалить');
  await page.getByRole('dialog', { name: 'Удаление проекта' }).getByRole('button', { name: 'Отмена', exact: true }).click(); await expect(card(page, seedName)).toBeVisible();
  await action(card(page, seedName), 'Удалить'); await page.getByRole('dialog', { name: 'Удаление проекта' }).getByRole('button', { name: 'Удалить проект', exact: true }).click(); await saved(page);
  await page.reload(); await expect(card(page, seedName)).toHaveCount(0); await expect(page.locator('.saved-project-card')).toHaveCount(1);
  await card(page, 'Проект Б').getByRole('button', { name: 'Открыть', exact: true }).click();
  await action(page.locator('.header-project'), 'Удалить'); await page.getByRole('dialog', { name: 'Удаление проекта' }).getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Проектов пока нет' })).toBeVisible(); await saved(page); await page.reload(); await expect(page.getByRole('heading', { name: 'Проектов пока нет' })).toBeVisible();
  await importFile(page, text); let dialog = page.getByRole('dialog', { name: 'Импорт резервной копии' }); await expect(dialog).toContainText('не обнаружено'); await dialog.getByRole('button', { name: 'Импортировать', exact: true }).click();
  await expect(page.locator('.saved-project-card')).toHaveCount(2); await saved(page);
  await importFile(page, text); dialog = page.getByRole('dialog', { name: 'Импорт резервной копии' }); await expect(dialog).toContainText('Совпадений ID'); await dialog.getByRole('button', { name: 'Импортировать как копии', exact: true }).click(); await expect(page.locator('.saved-project-card')).toHaveCount(4); await saved(page);
  const stable = await documents(page);
  await importFile(page, '{"version":99}'); await expect(page.getByRole('alert')).toContainText('не прошла проверку'); expect(await documents(page)).toEqual(stable);
  await page.getByRole('button', { name: 'Закрыть сообщение' }).click();
  await importFile(page, JSON.stringify({ ...backup, documents: [backup.documents[0], { ...backup.documents[1], processes: [] }] }));
  await expect(page.getByRole('alert')).toContainText('не прошла проверку'); expect(await documents(page)).toEqual(stable);
});

test('storage errors and missing routes do not reset or silently replace projects', async ({ page }) => {
  await page.goto('./#/projects/00000099-0000-4000-8000-000000000099');
  await expect(page.getByRole('heading', { name: 'Проект не найден' })).toBeVisible();
  await page.getByRole('button', { name: 'К проектам', exact: true }).click();
  await expect(card(page, seedName)).toBeVisible();
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('timeline-workspace'); request.onerror = () => { reject(new Error(request.error?.message ?? 'IndexedDB request failed')); };
    request.onsuccess = () => { const database = request.result; const transaction = database.transaction('metadata', 'readwrite'); transaction.objectStore('metadata').put({ key: 'schemaVersion', value: 99 }); transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onerror = () => { database.close(); reject(new Error(transaction.error?.message ?? 'IndexedDB transaction failed')); }; };
  }));
  await page.reload(); await expect(page.getByRole('heading', { name: 'Хранилище недоступно' })).toBeVisible(); await expect(page.getByRole('alert')).toContainText('не поддерживается'); expect(await documents(page)).toHaveLength(1);
});

test('a revision conflict from another real tab reloads current projects instead of overwriting them', async ({ page, context }) => {
  const second = await context.newPage();
  await second.goto('./'); await expect(card(second, seedName)).toBeVisible();
  await action(card(second, seedName), 'Переименовать');
  const editing = second.getByRole('dialog', { name: 'Редактирование проекта' });
  await editing.getByLabel('Название проекта', { exact: true }).fill('Новая версия из другой вкладки');
  await editing.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(card(second, 'Новая версия из другой вкладки')).toBeVisible(); await saved(second);
  await action(card(page, seedName), 'Переименовать');
  const stale = page.getByRole('dialog', { name: 'Редактирование проекта' });
  await stale.getByLabel('Название проекта', { exact: true }).fill('Не должна перезаписать');
  await stale.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('изменён или удалён');
  await expect(card(page, 'Новая версия из другой вкладки')).toBeVisible();
  expect((await documents(page))[0]?.project.name).toBe('Новая версия из другой вкладки');
  await stale.getByRole('button', { name: 'Отмена', exact: true }).click();
  await second.close();
});

test('captures real cards, portfolio at two resolutions and inner editor', async ({ page }) => {
  await createProject(page, 'Инсталляция «Река»', '2026-11-02', '2026-11-27'); await projects(page);
  await createProject(page, 'Выставка «Север»', '2026-11-16', '2026-12-18'); await projects(page); await saved(page);
  await mkdir('docs/screenshots', { recursive: true }); await page.mouse.move(10, 10);
  await page.screenshot({ path: 'docs/screenshots/projects-v1-2-cards-1440.png' });
  await portfolio(page); await page.mouse.move(10, 10); await page.screenshot({ path: 'docs/screenshots/projects-v1-2-portfolio-1440.png' });
  await page.setViewportSize({ width: 1920, height: 1080 }); await saved(page); await page.screenshot({ path: 'docs/screenshots/projects-v1-2-portfolio-1920.png' });
  await page.setViewportSize({ width: 1440, height: 900 }); await cards(page); await card(page, seedName).getByRole('button', { name: 'Открыть', exact: true }).click(); await saved(page); await page.mouse.move(10, 10);
  await page.screenshot({ path: 'docs/screenshots/projects-v1-2-inner-editor-1440.png' });
});
