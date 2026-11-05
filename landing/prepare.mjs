// Кладёт свежие установщики из desktop/out рядом с лендингом (landing/downloads).
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'desktop', 'out');
const downloads = join(here, 'downloads');
mkdirSync(downloads, { recursive: true });
const installers = readdirSync(out).filter((f) => /^Photon-.*\.(dmg|exe)$/.test(f));
if (installers.length === 0) throw new Error('Нет установщиков: npm run desktop:pack');
for (const f of installers) copyFileSync(join(out, f), join(downloads, f));
console.log(installers.join('\n'));
