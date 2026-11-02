import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  // Shared CI runners use software WebGL; wait for actual state, allowing its slower frames.
  timeout: process.env.CI ? 240_000 : 90_000,
  expect: { timeout: process.env.CI ? 30_000 : 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: {
      args: [
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
