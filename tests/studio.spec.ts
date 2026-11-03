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
  const lock = dialog.getByRole('button', { name: 'Сохранять пропорции', exact: true });
  if ((await lock.getAttribute('aria-pressed')) === 'true') await lock.click();
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

  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = localStorage.getItem('photon:look:v5');
        return saved ? JSON.parse(saved).rays : null;
      }),
    )
    .toBe(0.6);
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

test('diffusion survives tone and brand changes, undo and preset export', async ({ page }) => {
  await ready(page);
  const diffusion = page.getByRole('slider', { name: 'Рассеивание', exact: true });
  await expect(diffusion).toHaveAttribute('aria-valuenow', '0');
  await diffusion.focus();
  await page.keyboard.press('End');
  await expect(diffusion).toHaveAttribute('aria-valuenow', '1');
  await expect(page.getByRole('button', { name: 'Синий отлив', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Ч/б', exact: true }).click();
  await expect(diffusion).toHaveAttribute('aria-valuenow', '1');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить JSON', exact: true }).click();
  const file = JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8'));
  expect(file.look.diffusion).toBe(1);
  expect(file.look.tone).toBe('mono');
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await expect(diffusion).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(diffusion).toHaveAttribute('aria-valuenow', '1');
  await page.getByRole('button', { name: 'Музыка', exact: true }).click();
  await expect(diffusion).toHaveAttribute('aria-valuenow', '1');
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

  await page.getByRole('textbox', { name: 'Текст надписи' }).fill('VK CONF 2026');
  await expect(page.getByRole('slider', { name: 'Размер' })).toBeVisible();
  await page.getByRole('button', { name: 'Убрать' }).click();
  await expect(page.getByRole('textbox', { name: 'Текст надписи' })).toHaveValue('');
});

/**
 * Рендерит пресет в PNG и сравнивает яркость с референсом размера [w, h] вне надписей.
 * С `exportSize` кадр другой пропорции вписывается по высоте в центр референса
 * на фон баннера — так дизайнер сверяет экспорт 16:9 с баннером в Figma.
 */
async function rmseAgainst(
  page: Page,
  look: Record<string, unknown>,
  referencePath: string,
  [w, h]: [number, number],
  skip: (fx: number, fy: number) => boolean,
  exportSize: [number, number] = [w, h],
) {
  await page.locator('input[type=file]').setInputFiles({
    name: 'calibration.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 3, look })),
  });
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await customSize(dialog, ...exportSize);
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  const actual = await readFile((await (await downloading).path())!);
  const reference = await readFile(referencePath);
  const pw = Math.round((exportSize[0] * h) / exportSize[1]);
  const x0 = Math.round((w - pw) / 2);
  const [a, b] = await page.evaluate(
    async ({ actual, reference, w, h, x0, pw }) => {
      const decode = async (data: string, x: number, width: number) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#020202';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, x, 0, width, h);
        return Array.from(ctx.getImageData(0, 0, w, h).data);
      };
      return Promise.all([decode(actual, x0, pw), decode(reference, 0, w)]);
    },
    { actual: actual.toString('base64'), reference: reference.toString('base64'), w, h, x0, pw },
  );
  let squared = 0,
    count = 0;
  for (let y = 0; y < h; y++)
    for (let x = Math.max(0, x0); x < Math.min(w, x0 + pw); x++) {
      // The generator renders light, not the banner's blocks of copy.
      if (skip(x / w, y / h)) continue;
      const i = (y * w + x) * 4;
      const delta = (a[i] + a[i + 1] + a[i + 2] - b[i] - b[i + 1] - b[i + 2]) / 3;
      squared += delta * delta;
      count++;
    }
  return Math.sqrt(squared / count);
}

test('calibrated VK light follows the Figma banner outside its lettering', async ({ page }) => {
  await ready(page);
  const rmse = await rmseAgainst(
    page,
    {
      width: 1820,
      height: 647,
      grain: 0,
      // The reference is the black-and-white banner.
      tone: 'mono',
      // The banner enters at 32% of the top edge; default side presets stay at 22.5%.
      angle: (-Math.atan(0.36 / 0.55) * 180) / Math.PI,
      // Calibration of the guide profile: the setup before the art director's default.
      distance: 1,
      expression: 0,
      brightness: 0,
      spread: 0.5,
      softness: 0.6,
      glow: 0,
      haze: 0.5,
    },
    'docs/references/ad-vk-white.png',
    [455, 162],
    (fx, fy) =>
      (fx > 0.268 && fx < 0.727 && fy > 0.204 && fy < 0.691) ||
      (fx > 0.374 && fx < 0.626 && fy > 0.667 && fy < 0.802) ||
      (fx > 0.352 && fx < 0.725 && fy > 0.914),
  );
  // Old placement near the corner scores about 11; the calibrated beam is below 3.
  expect(rmse).toBeLessThan(4);
});

test('default VK light stays close to the art director banner', async ({ page }) => {
  await ready(page);
  // Light only, without copy (Figma 17015:24). The default 16:9 export is fitted
  // to the banner's height, the way the designer compares them in Figma.
  const rmse = await rmseAgainst(
    page,
    { grain: 0 },
    'docs/references/ad-vk-light.png',
    [455, 162],
    () => false,
    [288, 162],
  );
  // A dense stripe along the wall or a frame filled with light goes well above 3.
  expect(rmse).toBeLessThan(3);
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
  await dialog.getByRole('button', { name: 'Собрать слои', exact: true }).click();
  const list = dialog.getByRole('list', { name: 'Слои' });
  await expect(list.getByRole('listitem')).toHaveCount(3, { timeout: 30_000 });
  await expect(list).toContainText('Plus lighter');
  downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать слой «Свет»' }).click();
  const layerBytes = await readFile((await (await downloadPromise).path())!);
  expect(layerBytes.readUInt32BE(16)).toBe(320);
  downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать все одним ZIP' }).click();
  const { unzipSync } = await import('fflate');
  const files = unzipSync(new Uint8Array(await readFile((await (await downloadPromise).path())!)));
  expect(Object.keys(files)).toEqual([
    '00-composite.png',
    '01-background.png',
    '02-light.png',
    '03-volume.png',
    'README.txt',
  ]);
  expect(Buffer.from(files['00-composite.png'])).toEqual(pngBytes);
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

test('keeps export proportions and preferences and previews the actual JPEG', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const lock = dialog.getByRole('button', { name: 'Сохранять пропорции', exact: true });
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('spinbutton', { name: 'Ширина' }).fill('640');
  await expect(dialog.getByRole('spinbutton', { name: 'Высота' })).toHaveValue('360');
  await dialog.getByRole('button', { name: 'Слои', exact: true }).click();
  await expect(dialog.getByRole('spinbutton', { name: 'Ширина' })).toHaveValue('640');
  await expect(dialog).toContainText('Слои непрозрачные');
  await dialog.getByRole('button', { name: 'Картинка', exact: true }).click();
  await dialog.getByRole('button', { name: 'JPG', exact: true }).click();
  const quality = dialog.getByRole('slider', { name: 'Качество JPG' });
  await quality.focus();
  await page.keyboard.press('Home');
  await dialog.getByRole('button', { name: '100%', exact: true }).click();
  const image = dialog.getByRole('img', { name: 'Готовое изображение для экспорта' });
  await expect(image).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Вписать', exact: true })).toBeVisible();
  expect(await image.evaluate((img) => img.getBoundingClientRect().width)).toBe(640);
  const firstSize = await image.evaluate(
    async (img) => (await (await fetch((img as HTMLImageElement).src)).blob()).size,
  );
  await quality.focus();
  await page.keyboard.press('End');
  await dialog.getByRole('button', { name: '100%', exact: true }).click();
  await expect(image).toBeVisible();
  const cached = await image.evaluate(async (img) =>
    Array.from(new Uint8Array(await (await fetch((img as HTMLImageElement).src)).arrayBuffer())),
  );
  expect(cached.length).toBeGreaterThan(firstSize);
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Скачать JPG', exact: true }).click();
  expect(await readFile((await (await downloading).path())!)).toEqual(Buffer.from(cached));
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  await expect(dialog.getByRole('spinbutton', { name: 'Ширина' })).toHaveValue('640');
  await expect(dialog.getByRole('button', { name: 'JPG', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(quality).toHaveValue('100');
  await dialog.getByRole('spinbutton', { name: 'Ширина' }).fill('5000');
  await expect(dialog.getByRole('alert')).toContainText('от 64 до 4096');
  await expect(dialog.getByRole('button', { name: 'Скачать JPG', exact: true })).toBeDisabled();
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
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Скачать PNG', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/screenshots/mobile-export.png', fullPage: true });
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
