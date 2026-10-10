import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const python = resolve(
  root,
  process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
);
const assets = execFileSync(
  python,
  [
    '-c',
    'import importlib.util; from pathlib import Path; s=importlib.util.find_spec("ultralytics"); print(Path(s.origin).parent / "assets" if s else "missing")',
  ],
  { encoding: 'utf8' },
).trim();

test('real GPU indexing, object retrieval, annotations, filtering and collection management', async ({
  page,
  request,
}) => {
  // This integration test requires the installed backend's real image fixtures.
  expect(
    existsSync(resolve(assets, 'bus.jpg')),
    'Install backend dependencies before running this test.',
  ).toBeTruthy();
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  expect((await request.delete('/api/images')).ok()).toBeTruthy();
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your next discovery starts here' }),
  ).toBeVisible();
  await expect(page.locator('.app-footer')).toContainText('Detection floor 15%');
  mkdirSync(resolve(root, 'docs/screenshots'), { recursive: true });
  await page.screenshot({
    path: resolve(root, 'docs/screenshots/dashboard.png'),
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByRole('button', { name: 'Upload Images', exact: true }).last().click();
  await page
    .getByLabel('Choose images to upload')
    .setInputFiles([resolve(assets, 'bus.jpg'), resolve(assets, 'zidane.jpg')]);
  await expect(page.getByText('2 images selected')).toBeVisible();
  await page.getByRole('button', { name: /Upload & index 2 images/ }).click();
  await expect(page.locator('.image-card')).toHaveCount(2, { timeout: 90_000 });
  await expect
    .poll(
      async () => {
        const images = await (await request.get('/api/images')).json();
        return images.items.filter((image: { status: string }) => image.status === 'completed')
          .length;
      },
      { timeout: 90_000 },
    )
    .toBe(2);
  await expect(page.getByLabel('Select an Object').locator('option[value="bus"]')).toHaveCount(1);

  await page.getByLabel('Select an Object').selectOption('bus');
  await page.getByRole('button', { name: 'Search Images', exact: true }).click();
  await expect(page.locator('.image-card')).toHaveCount(1);
  await expect(page.locator('.image-card').getByRole('heading', { name: 'bus.jpg' })).toBeVisible();
  await expect(page.locator('.image-card svg[role="img"]')).toBeVisible();
  await page.screenshot({
    path: resolve(root, 'data/gallery-qa.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'View Details for bus.jpg' }).click();
  const viewer = page.getByRole('dialog');
  await expect(viewer.getByRole('heading', { name: 'Detected Objects' })).toBeVisible();
  await page.screenshot({
    path: resolve(root, 'data/detail-qa.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await viewer.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(viewer.locator('svg[role="img"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  await page.getByLabel('Advanced Search').check();
  await page.getByRole('button', { name: /object categor.* selected/ }).click();
  await page.getByRole('group', { name: 'Object categories' }).getByLabel('Person').check();
  await page.getByRole('heading', { name: 'Find the objects. Find the image.' }).click();
  await page.getByRole('button', { name: 'Search Images', exact: true }).click();
  await expect(page.locator('.image-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Match any (OR)' }).click();
  await page.getByRole('button', { name: 'Search Images', exact: true }).click();
  await expect(page.locator('.image-card')).toHaveCount(2);
  await page.getByLabel('Sort Results').selectOption('filename');
  await expect(page.locator('.image-card h3').first()).toHaveText('bus.jpg');

  await page.getByLabel('Minimum Confidence').fill('1');
  await expect(page.getByRole('heading', { name: 'No matching images' })).toBeVisible();
  const atOne = await (await request.get('/api/statistics?confidence=1')).json();
  expect(atOne.total_objects).toBe(0);
  await page.getByRole('button', { name: 'Reset Filters' }).click();
  await expect(page.locator('.image-card')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.image-card')).toHaveCount(2);

  await page.getByRole('button', { name: 'Image Collection', exact: false }).first().click();
  await page.getByRole('button', { name: 'View Details for bus.jpg' }).click();
  await page.getByRole('button', { name: 'Delete Image', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Image', exact: true }).click();
  await expect(page.locator('.image-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear Collection', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Clear Collection', exact: true })
    .click();
  await expect(page.locator('.image-card')).toHaveCount(0);
  expect((await (await request.get('/api/statistics')).json()).total_images).toBe(0);
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await page.getByRole('button', { name: 'Dismiss processing report' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Visual Search', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Upload Images', exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: resolve(root, 'docs/screenshots/mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  expect(failures).toEqual([]);
});
