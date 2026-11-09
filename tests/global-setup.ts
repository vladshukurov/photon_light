import { chromium, type FullConfig } from '@playwright/test';
import { lavapipe } from '../playwright.config';

/**
 * Пишет в лог, на чём браузер считает WebGL: от этого целиком зависит скорость
 * тестов. На CI без lavapipe прогон останавливается сразу (см. playwright.config.ts).
 */
export default async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch(config.projects[0].use.launchOptions);
  try {
    const page = await browser.newPage();
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      if (!gl) return 'нет WebGL2';
      return String(
        info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      );
    });
    console.log(`WebGL: ${renderer}`);
    if (lavapipe && !renderer.includes('llvmpipe'))
      throw new Error(
        `На CI тесты рассчитаны на Mesa lavapipe, а WebGL считает «${renderer}». ` +
          'Поставьте mesa-vulkan-drivers: на SwiftShader раннер не успевает за экспортом и видео.',
      );
  } finally {
    await browser.close();
  }
}
