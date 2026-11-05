// Установщики Фотона: копия сайта из ../dist → electron-builder (DMG и Windows).
// Сайт собирается заранее: npm run desktop:pack в корне делает всё по порядку.
// Только одна платформа: node pack.mjs mac | win.
import { build } from 'electron-builder';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Нет сборки сайта: npm run build');

const web = join(here, 'web');
rmSync(web, { recursive: true, force: true });
cpSync(dist, web, { recursive: true });

const only = process.argv[2];
// Пустой список — цели из electron-builder.yml.
const files = await build({
  projectDir: here,
  ...(only !== 'win' && { mac: [] }),
  ...(only !== 'mac' && { win: [] }),
});
console.log(files.filter((f) => /\.(dmg|exe)$/.test(f)).join('\n'));
