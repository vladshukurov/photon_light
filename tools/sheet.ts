/*
  Контактный лист для калибровки света: рендерит набор Look в одну картинку.
  Только для разработки: npm run dev → /tools/sheet.html#<json>.
  Хеш — { cell: [w, h], cols, refs?: string[], looks: Partial<Look>[] }.
*/
import { Renderer } from '../src/engine/renderer';
import { buildScene } from '../src/domain/scene';
import { normalizeLook, type Look } from '../src/domain/look';
import { renderPixels, pixelsToCanvas } from '../src/engine/export';
import { TEXT_FONT_FAMILY } from '../src/engine/text';
import condensed from '../src/assets/fonts/vk-condensed-600.woff2';

interface Spec {
  cell: [number, number];
  cols: number;
  refs?: string[];
  looks: (Partial<Look> & { progress?: number; time?: number })[];
}

// Шрифт надписи — тот же файл, что в приложении.
const face = new FontFace(TEXT_FONT_FAMILY, `url(${condensed})`, { weight: '600' });
document.fonts.add(await face.load());

const spec: Spec = JSON.parse(decodeURIComponent(location.hash.slice(1)));
const [w, h] = spec.cell;
const refs = spec.refs ?? [];
const total = refs.length + spec.looks.length;
const rows = Math.ceil(total / spec.cols);
const sheet = document.getElementById('sheet') as HTMLCanvasElement;
sheet.width = spec.cols * w;
sheet.height = rows * h;
const ctx = sheet.getContext('2d')!;
const work = document.createElement('canvas');
const renderer = new Renderer(work).init();

const place = (i: number) => [(i % spec.cols) * w, Math.floor(i / spec.cols) * h] as const;

let i = 0;
for (const src of refs) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const [x, y] = place(i++);
  ctx.drawImage(img, x, y, w, h);
}
for (const raw of spec.looks) {
  const look = normalizeLook({ ...raw, width: raw.width ?? w, height: raw.height ?? h });
  const scene = buildScene(look, w / h, { progress: raw.progress ?? 0, time: raw.time ?? 0 });
  const px = renderPixels(renderer, scene, w, h, { hazeSteps: 96 });
  const [x, y] = place(i++);
  ctx.drawImage(pixelsToCanvas(px, w, h), x, y);
}
document.title = 'ready';
