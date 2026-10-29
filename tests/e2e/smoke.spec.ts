import { expect, test } from '@playwright/test';

test('starts on a clean Russian overview without remote services', async ({ page }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => {
    if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) externalRequests.push(request.url());
  });
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Здесь будут ваши проекты' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Показать демо-проект' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('Осенняя премьера', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('opens the fixed read-only demo and returns to the overview', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  await page.goto('./');
  await page.getByRole('button', { name: 'Показать демо-проект' }).click();
  await page.getByRole('button', { name: /Демонстрационный проект Осенняя премьера/ }).click();
  await expect(page.getByRole('heading', { name: 'Осенняя премьера' })).toBeVisible();
  await expect(page.getByText('Демонстрационный проект · только просмотр')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Процессы', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Подготовка', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Производство', exact: true })).toBeVisible();
  await expect(page.getByText('Монтаж и звук', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Премьера', exact: true })).toBeVisible();
  // Exclusive 2026-11-01 is shown as inclusive 31 October, never 1 November.
  await expect(page.locator('.page-heading time').last()).toHaveText('31 окт 2026');
  await page.getByRole('button', { name: 'Все проекты' }).click();
  await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Здесь будут ваши проекты' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
  expect(errors).toEqual([]);
});

test('overview works with keyboard and a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.keyboard.press('Tab'); // Brand.
  await page.keyboard.press('Tab'); // Projects navigation.
  await page.keyboard.press('Tab'); // Opt-in demo.
  await expect(page.getByRole('button', { name: 'Показать демо-проект' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Демонстрационный проект Осенняя премьера/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
