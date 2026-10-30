// node tools/ui.mjs out.png [width] [height] [script] — снимок интерфейса с аппаратным GPU.
import { chromium } from '@playwright/test';
const [out, w = '1512', h = '920', script = '', base = 'http://localhost:5174'] =
  process.argv.slice(2);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.error(m.text()));
await page.goto(base + '/');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.canvas-state', { state: 'detached', timeout: 30000 });
if (script) await new Function('page', `return (async () => { ${script} })()`)(page);
await page.waitForTimeout(700);
await page.screenshot({ path: out });
console.log('ok');
await browser.close();
