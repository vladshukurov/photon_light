import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeEnabled({
    timeout: 60_000,
  });
  await expect(page.locator('.canvas-state')).toHaveCount(0, { timeout: 60_000 });
}

async function customSize(dialog: Locator, width: number, height: number) {
  await dialog.getByRole('button', { name: 'Свой', exact: true }).click();
  await dialog.getByRole('spinbutton', { name: 'Ширина' }).fill(String(width));
  await dialog.getByRole('spinbutton', { name: 'Высота' }).fill(String(height));
}

/** Разброс яркости картинки: пустой или залитый кадр не проходит. */
async function variation(page: Page, base64: string, mime: string) {
  return page.evaluate(
    async ({ data, mime }) => {
      const img = new Image();
      img.src = `data:${mime};base64,${data}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let lo = 765,
        hi = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = px[i] + px[i + 1] + px[i + 2];
        lo = Math.min(lo, l);
        hi = Math.max(hi, l);
      }
      return hi - lo;
    },
    { data: base64, mime },
  );
}

test('edits light, brand and room with undo, redo and session restore', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);

  const music = page.getByRole('button', { name: 'Музыка', exact: true });
  await music.click();
  await expect(music).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Снизу справа', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Положение источника' })).toHaveAttribute(
    'aria-valuetext',
    'Снизу справа',
  );
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Положение источника' })).toHaveAttribute(
    'aria-valuetext',
    'Сверху слева',
  );
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await page.getByRole('button', { name: 'Светлая', exact: true }).click();
  const expression = page.getByRole('slider', { name: 'Выразительность' });
  await expression.focus();
  await page.keyboard.press('End');
  await expect(expression).toHaveAttribute('aria-valuenow', '1');
  const rays = page.getByRole('slider', { name: 'Лучи' });
  await rays.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect(rays).toHaveAttribute('aria-valuenow', '0.6');
  await rays.dblclick();
  await expect(rays).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(rays).toHaveAttribute('aria-valuenow', '0.6');

  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeEnabled({
    timeout: 60_000,
  });
  await expect(music).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Светлая', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('slider', { name: 'Положение источника' })).toHaveAttribute(
    'aria-valuetext',
    'Снизу справа',
  );
  await expect(page.getByRole('slider', { name: 'Лучи' })).toHaveAttribute('aria-valuenow', '0.6');
  await page.getByRole('button', { name: 'Сбросить' }).click();
  await expect(page.getByRole('slider', { name: 'Лучи' })).toHaveAttribute('aria-valuenow', '0');
  expect(errors).toEqual([]);
});

test('drags the light on the canvas', async ({ page }) => {
  await ready(page);
  const canvas = page.locator('.canvas-hit');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.9, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.95, box.y + 2, { steps: 4 });
  await page.mouse.up();
  const angle = Number(
    await page.getByRole('slider', { name: 'Положение источника' }).getAttribute('aria-valuenow'),
  );
  expect(angle).toBeGreaterThan(20);

  await expect(page.locator('.canvas-state')).toHaveCount(0);
});

test('exports PNG, JPG, layers and JSON; imports and rejects presets', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await customSize(dialog, 320, 180);

  let downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  const png = await downloadPromise;
  const pngBytes = await readFile((await png.path())!);
  expect(png.suggestedFilename()).toMatch(/320×180\.png$/);
  expect(pngBytes.readUInt32BE(16)).toBe(320);
  expect(pngBytes.readUInt32BE(20)).toBe(180);
  expect(await variation(page, pngBytes.toString('base64'), 'image/png')).toBeGreaterThan(60);

  await dialog.getByRole('button', { name: 'JPG', exact: true }).click();
  downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать JPG', exact: true }).click();
  const jpgBytes = await readFile((await (await downloadPromise).path())!);
  expect([jpgBytes[0], jpgBytes[1]]).toEqual([0xff, 0xd8]);

  await dialog.getByRole('button', { name: 'Слои', exact: true }).click();
  await customSize(dialog, 320, 180);
  downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать слои', exact: true }).click();
  const { unzipSync } = await import('fflate');
  const files = unzipSync(new Uint8Array(await readFile((await (await downloadPromise).path())!)));
  expect(Object.keys(files)).toEqual([
    '01-background.png',
    '02-light.png',
    '03-volume.png',
    'README.txt',
  ]);
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();

  await page.getByRole('textbox', { name: 'Название сцены' }).fill('Первый свет');
  downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить JSON', exact: true }).click();
  const jsonText = await readFile((await (await downloadPromise).path())!, 'utf8');
  const file = JSON.parse(jsonText);
  expect(file.version).toBe(3);
  expect(file.look.name).toBe('Первый свет');

  await page.locator('input[type=file]').setInputFiles({
    name: 'scene.json',
    mimeType: 'application/json',
    buffer: Buffer.from(jsonText.replace('Первый свет', 'Моя сцена')),
  });
  await expect(page.getByRole('textbox', { name: 'Название сцены' })).toHaveValue('Моя сцена');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.locator('.toast')).toContainText('нет пресета');
});

test('imports a prototype preset with 58 keys', async ({ page }) => {
  await ready(page);
  const legacy = {
    version: 2,
    name: 'Старый свет',
    params: { theme: 'dark', lightX: 0.88, lightY: 1.32, albedo: '#111833', exposureEV: 4 },
  };
  await page.locator('input[type=file]').setInputFiles({
    name: 'old.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await expect(page.locator('.toast')).toContainText('старого формата');
  await expect(page.getByRole('button', { name: 'Видео', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('fits mobile without horizontal overflow and switches format', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '9:16' }).click();
  await expect
    .poll(async () => {
      const box = (await page.locator('.canvas-wrap').boundingBox())!;
      return box.height / box.width;
    })
    .toBeCloseTo(16 / 9, 1);
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/mobile.png', fullPage: true });
});

test('restores a lost WebGL context without losing the scene', async ({ page }) => {
  await ready(page);
  await page.getByRole('textbox', { name: 'Название сцены' }).fill('Сохранить мой свет');
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[role=img]')!;
    const extension = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    Reflect.set(window, 'restoreTestContext', () => extension.restoreContext());
    extension.loseContext();
  });
  await expect(page.getByRole('alert')).toContainText('Связь с видеокартой потеряна');
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeDisabled();
  await page.evaluate(() => Reflect.get(window, 'restoreTestContext')());
  await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeEnabled({
    timeout: 60_000,
  });
  await expect(page.getByRole('textbox', { name: 'Название сцены' })).toHaveValue(
    'Сохранить мой свет',
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/desktop.png' });
});
