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
  await dialog.getByRole('button', { name: /^Свой/ }).click();
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
  await page.getByRole('button', { name: 'Выразительный', exact: true }).click();
  await page.getByRole('slider', { name: 'Выраженность' }).fill('0.6');

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
  await expect(page.getByRole('slider', { name: 'Выраженность' })).toHaveValue('0.6');
  expect(errors).toEqual([]);
});

test('drags the light on the canvas and plays the light pass', async ({ page }) => {
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

  await page.getByRole('switch', { name: 'Проход света' }).click();
  await expect(page.getByRole('slider', { name: 'Положение прохода' })).toBeVisible();
  await page.getByRole('button', { name: 'Воспроизвести' }).click();
  await expect(page.getByRole('button', { name: 'Пауза' })).toBeVisible();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.locator('.canvas-state')).toHaveCount(0);
});

test('exports PNG, JPG, layers and JSON; imports and rejects presets', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await customSize(dialog, 320, 180);

  let downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать', exact: true }).click();
  const png = await downloadPromise;
  const pngBytes = await readFile((await png.path())!);
  expect(png.suggestedFilename()).toMatch(/320×180\.png$/);
  expect(pngBytes.readUInt32BE(16)).toBe(320);
  expect(pngBytes.readUInt32BE(20)).toBe(180);
  expect(await variation(page, pngBytes.toString('base64'), 'image/png')).toBeGreaterThan(60);

  await dialog.getByRole('button', { name: 'JPG', exact: true }).click();
  downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать', exact: true }).click();
  const jpgBytes = await readFile((await (await downloadPromise).path())!);
  expect([jpgBytes[0], jpgBytes[1]]).toEqual([0xff, 0xd8]);

  await dialog.getByRole('button', { name: /^Слои/ }).click();
  await customSize(dialog, 320, 180);
  downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать', exact: true }).click();
  const { unzipSync } = await import('fflate');
  const files = unzipSync(new Uint8Array(await readFile((await (await downloadPromise).path())!)));
  expect(Object.keys(files)).toEqual([
    '01-background.png',
    '02-light.png',
    '03-volume.png',
    'README.txt',
  ]);
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).last().click();

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

test('records playable video at the requested size and supports cancellation', async ({ page }) => {
  await ready(page);
  await page.getByRole('switch', { name: 'Проход света' }).click();
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Видео/ }).click();
  await customSize(dialog, 320, 180);
  await dialog.getByLabel('Длительность').selectOption('3');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Записать видео' }).click();
  const video = await downloadPromise;
  const bytes = (await readFile((await video.path())!)).toString('base64');
  const info = await page.evaluate(
    async ({ data, ext }) => {
      const v = document.createElement('video');
      v.muted = true;
      v.src = `data:video/${ext};base64,${data}`;
      await new Promise<void>((resolve, reject) => {
        v.onloadeddata = () => resolve();
        v.onerror = () => reject(new Error('Video decode failed'));
      });
      const ended = new Promise<void>((resolve) => {
        v.onended = () => resolve();
      });
      await v.play();
      await ended;
      return { width: v.videoWidth, height: v.videoHeight, duration: v.duration };
    },
    { data: bytes, ext: video.suggestedFilename().endsWith('mp4') ? 'mp4' : 'webm' },
  );
  expect(info).toMatchObject({ width: 320, height: 180 });
  expect(info.duration).toBeGreaterThan(2);
  await dialog.getByRole('button', { name: 'Записать видео' }).click();
  await dialog.getByRole('button', { name: 'Остановить запись' }).click();
  await expect(dialog.getByRole('alert')).toContainText('остановлена');
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
