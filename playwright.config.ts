import { defineConfig, devices } from '@playwright/test';

/*
  Тесты рендерят настоящий WebGL на процессоре. Headless-шелл Chromium берёт
  SwiftShader: на Mac он собран с LLVM, и весь набор идёт около двух минут.
  На четырёхъядерном раннере GitHub SwiftShader собран с Subzero — там набор
  шёл 17–19 минут, и экспорт, слои и видео не дожидались кадров. Mesa lavapipe
  (llvmpipe за Vulkan) проходит тот же набор на раннере меньше чем за три минуты.

  Поэтому на CI под Linux ANGLE смотрит в Vulkan, а CI ставит mesa-vulkan-drivers.
  Без них ANGLE молча откатится на SwiftShader — global-setup.ts тогда сразу
  останавливает прогон, вместо того чтобы тесты падали по таймауту один за другим.
*/
export const lavapipe = !!process.env.CI && process.platform === 'linux';

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // Кадры считает процессор: ждём настоящего состояния, оставляя запас на медленный раннер.
  timeout: process.env.CI ? 240_000 : 90_000,
  expect: { timeout: process.env.CI ? 30_000 : 5_000 },
  // В логе CI видно время каждого теста: так замедление рендера заметно до таймаутов.
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: {
      args: lavapipe
        ? [
            '--enable-webgl',
            '--use-angle=vulkan',
            '--enable-features=Vulkan',
            '--ignore-gpu-blocklist',
          ]
        : [
            '--enable-webgl',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ],
    },
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
