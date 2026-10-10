import { defineConfig } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = join(root, 'data', 'browser-tests');
mkdirSync(join(data, 'models'), { recursive: true });
const weights = join(root, 'data', 'models', 'yolo11m.pt');
const python =
  process.platform === 'win32' ? String.raw`.venv\Scripts\python.exe` : '.venv/bin/python';
if (existsSync(weights) && !existsSync(join(data, 'models', 'yolo11m.pt'))) {
  copyFileSync(weights, join(data, 'models', 'yolo11m.pt'));
}

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8001',
    channel:
      process.env.VOR_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
    headless: true,
    actionTimeout: 15_000,
    viewport: { width: 1440, height: 1050 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `${python} scripts/run.py --port 8001`,
    cwd: root,
    url: 'http://127.0.0.1:8001/api/health',
    timeout: 60_000,
    reuseExistingServer: false,
    env: { VOR_DATA_DIR: data },
  },
});
