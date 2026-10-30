// node tools/shoot.mjs '<spec json>' out.png  — снимает контактный лист с аппаратным GPU.
import { chromium } from '@playwright/test';
const [spec, out, base = 'http://localhost:5174'] = process.argv.slice(2);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 2000, height: 1400 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.error(m.text()));
const t0 = Date.now();
await page.goto(`${base}/tools/sheet.html#${encodeURIComponent(spec)}`);
await page.waitForFunction(() => document.title === 'ready', null, { timeout: 120000 });
await page.locator('#sheet').screenshot({ path: out });
console.log('ok', Date.now() - t0, 'ms');
await browser.close();
