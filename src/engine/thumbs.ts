import { Renderer } from './renderer';
import type { Scene } from '../domain/scene';

/*
  Маленькие живые превью для панели: бренды и миниатюра источника.

  Свой контекст WebGL на всё приложение, отдельный от холста: превью не
  сбивают накопление основного кадра и не зависят от его размера. Кадр
  считается в 2D-холст сразу после рендера — буфер WebGL после этого
  можно не хранить.
*/

let shared: { canvas: HTMLCanvasElement; renderer: Renderer } | null = null;

function get() {
  if (shared && !shared.renderer.gl.isContextLost()) return shared;
  shared?.renderer.dispose();
  const canvas = document.createElement('canvas');
  const renderer = new Renderer(canvas).init();
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  shared = { canvas, renderer };
  return shared;
}

/** Рисует сцену в target по его собственному размеру. Ошибки GPU не роняют панель. */
export function drawThumb(scene: Scene, target: HTMLCanvasElement) {
  try {
    const { canvas, renderer } = get();
    const w = target.width,
      h = target.height;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    renderer.render(scene, w, h, { hazeSteps: 28 });
    target.getContext('2d')?.drawImage(canvas, 0, 0);
  } catch {
    // Превью — украшение панели; основной холст покажет ошибку сам.
  }
}
