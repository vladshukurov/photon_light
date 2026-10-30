import { Fbo } from './fbo';
import { Renderer, type RenderOptions } from './renderer';
import { buildScene, type Scene } from '../domain/scene';
import type { Look } from '../domain/look';

export const MAX_DIMENSION = 4096;
export function validateSize(width: number, height: number, gl?: WebGL2RenderingContext) {
  const limit = gl
    ? Math.min(
        MAX_DIMENSION,
        gl.getParameter(gl.MAX_TEXTURE_SIZE),
        gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      )
    : MAX_DIMENSION;
  if (![width, height].every((n) => Number.isInteger(n) && n >= 64 && n <= limit))
    throw new Error(`Размер каждой стороны — от 64 до ${limit} пикселей.`);
}
export function pixelsToCanvas(px: Uint8Array, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Браузер не поддерживает Canvas 2D.');
  const bytes = new Uint8ClampedArray(px.length),
    stride = width * 4;
  for (let y = 0; y < height; y++)
    bytes.set(px.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  ctx.putImageData(new ImageData(bytes, width, height), 0, 0);
  return canvas;
}
export function renderPixels(
  renderer: Renderer,
  scene: Scene,
  width: number,
  height: number,
  options: RenderOptions = {},
): Uint8Array {
  validateSize(width, height, renderer.gl);
  const gl = renderer.gl,
    target = new Fbo(gl, width, height, gl.RGBA8, gl.UNSIGNED_BYTE);
  try {
    renderer.render(scene, width, height, { hazeSteps: 160, ...options, target });
    return renderer.readPixels(target);
  } finally {
    target.dispose();
    renderer.size = [0, 0];
  }
}
export const canvasBlob = (canvas: HTMLCanvasElement, type = 'image/png') =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось закодировать изображение.'))),
      type,
      0.95,
    ),
  );
export async function exportImage(
  renderer: Renderer,
  scene: Scene,
  width: number,
  height: number,
  format: 'png' | 'jpg',
) {
  return canvasBlob(
    pixelsToCanvas(renderPixels(renderer, scene, width, height), width, height),
    format === 'png' ? 'image/png' : 'image/jpeg',
  );
}
export function safeFilename(name: string) {
  return (
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .trim()
      .slice(0, 80) || 'photon'
  );
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = safeFilename(filename);
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export async function exportLayers(
  renderer: Renderer,
  scene: Scene,
  width: number,
  height: number,
  name: string,
) {
  const p = { ...scene, grain: 0 };
  const base = renderPixels(renderer, p, width, height, { mode: 'base' });
  const stack = renderPixels(renderer, p, width, height, { mode: 'stack' });
  const full = renderPixels(renderer, p, width, height);
  let clipped = false;
  const diff = (a: Uint8Array, b: Uint8Array) => {
    const bytes = new Uint8Array(a.length);
    for (let i = 0; i < bytes.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        if (a[i + c] < b[i + c]) clipped = true;
        bytes[i + c] = Math.max(0, a[i + c] - b[i + c]);
      }
      bytes[i + 3] = 255;
    }
    return bytes;
  };
  const light = diff(stack, base),
    haze = diff(full, stack);
  // One archive avoids browser restrictions on multiple automatic downloads.
  const { zipSync } = await import('fflate');
  const entries: Record<string, Uint8Array> = {};
  for (const [label, px] of [
    ['01-background', base],
    ['02-light', light],
    ['03-volume', haze],
  ] as const) {
    const blob = await canvasBlob(pixelsToCanvas(px, width, height));
    entries[`${label}.png`] = new Uint8Array(await blob.arrayBuffer());
  }
  entries['README.txt'] = new TextEncoder().encode(
    'Фотон — слои для Figma.\n\n01-background — нижний слой, режим Normal.\n02-light и 03-volume — сверху, режим Plus lighter.\n\nСлои — приближение 8-битной композиции, цельный PNG точнее.\n' +
      (clipped
        ? 'В сцене есть отрицательная разность: сложение слоёв не воспроизводит её точно.'
        : ''),
  );
  const zip = zipSync(entries, { level: 0 });
  download(new Blob([new Uint8Array(zip)], { type: 'application/zip' }), `${name}-layers.zip`);
  return clipped;
}
export function videoType(): { mime: string; ext: 'mp4' | 'webm' } | null {
  if (
    typeof MediaRecorder === 'undefined' ||
    typeof HTMLCanvasElement.prototype.captureStream !== 'function'
  )
    return null;
  for (const mime of [
    'video/mp4',
    'video/mp4;codecs=avc1.42E01E',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
  ]) {
    if (MediaRecorder.isTypeSupported(mime))
      return { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' };
  }
  return null;
}
type VideoFormat = NonNullable<ReturnType<typeof videoType>>;
class EmptyVideoError extends Error {}
/** Retry an advertised but non-functional MP4 encoder with a supported WebM encoder. */
export async function exportVideo(
  look: Look,
  width: number,
  height: number,
  seconds: number,
  fps: number,
  signal: AbortSignal,
  onProgress: (n: number) => void,
  host?: HTMLElement,
): Promise<{ blob: Blob; ext: string }> {
  const preferred = videoType();
  if (!preferred) throw new Error('Браузер не поддерживает запись видео.');
  try {
    return await recordVideo(
      look,
      width,
      height,
      seconds,
      fps,
      signal,
      onProgress,
      preferred,
      host,
    );
  } catch (error) {
    const fallback = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find((mime) =>
      MediaRecorder.isTypeSupported(mime),
    );
    if (
      !(error instanceof EmptyVideoError) ||
      preferred.ext !== 'mp4' ||
      !fallback ||
      signal.aborted
    )
      throw error;
    onProgress(0);
    return recordVideo(
      look,
      width,
      height,
      seconds,
      fps,
      signal,
      onProgress,
      {
        mime: fallback,
        ext: 'webm',
      },
      host,
    );
  }
}
/** A dedicated renderer keeps preview and output dimensions independent. */
async function recordVideo(
  look: Look,
  width: number,
  height: number,
  seconds: number,
  fps: number,
  signal: AbortSignal,
  onProgress: (n: number) => void,
  type: VideoFormat,
  host?: HTMLElement,
): Promise<{ blob: Blob; ext: string }> {
  validateSize(width, height);
  if (width * height > 1920 * 1080)
    throw new Error('Для видео выберите размер не больше 1920 × 1080 или 1080 × 1920.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new Renderer(canvas, { preserveDrawingBuffer: true });
  const presentation = document.createElement('canvas');
  let stream: MediaStream | undefined;
  try {
    renderer.init();
    // Свет проходит по кадру за всю длину ролика; дымка и лучи живут всё время.
    const frameScene = (seconds_: number) =>
      buildScene(look, width / height, { progress: seconds_ / seconds, time: seconds_ });
    renderer.render(frameScene(0), width, height, { hazeSteps: 48 });
    // Capture a 2D presentation surface: direct WebGL capture is inconsistent
    // across browser compositors, even when isTypeSupported advertises a codec.
    presentation.width = width;
    presentation.height = height;
    presentation.style.width = '100%';
    presentation.style.display = 'block';
    presentation.setAttribute('aria-label', 'Записываемый кадр');
    host?.replaceChildren(presentation);
    const context = presentation.getContext('2d', { alpha: false });
    if (!context) throw new Error('Не удалось создать поверхность для записи видео.');
    context.drawImage(canvas, 0, 0);
    stream = presentation.captureStream(fps);
    let track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    if (typeof track.requestFrame !== 'function') {
      stream.getTracks().forEach((t) => t.stop());
      stream = presentation.captureStream(fps);
      track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    }
    const recorder = new MediaRecorder(stream, {
      mimeType: type.mime,
      videoBitsPerSecond: 16_000_000,
    });
    return await new Promise((resolve, reject) => {
      const chunks: Blob[] = [];
      let raf = 0,
        stopTimer = 0,
        lastFrame = -1;
      let aborted = false,
        failed: Error | null = null;
      let started: number | null = null;
      const initializingAt = performance.now();
      const abort = () => {
        aborted = true;
        if (recorder.state !== 'inactive') recorder.stop();
      };
      signal.addEventListener('abort', abort, { once: true });
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onerror = () => {
        failed = new Error('Ошибка записи видео. Попробуйте другой браузер или меньший размер.');
        if (recorder.state !== 'inactive') recorder.stop();
      };
      recorder.onstop = () => {
        cancelAnimationFrame(raf);
        clearTimeout(stopTimer);
        signal.removeEventListener('abort', abort);
        if (aborted) reject(new DOMException('Запись отменена', 'AbortError'));
        else if (failed) reject(failed);
        else if (!chunks.length) reject(new EmptyVideoError('Браузер вернул пустое видео.'));
        else resolve({ blob: new Blob(chunks, { type: type.mime }), ext: type.ext });
      };
      const tick = () => {
        const elapsed = started === null ? 0 : (performance.now() - started) / 1000;
        if (started === null && performance.now() - initializingAt > 15_000) {
          failed = new EmptyVideoError('Кодировщик не начал запись. Попробуйте другой браузер.');
          recorder.stop();
          return;
        }
        if (signal.aborted) {
          abort();
          return;
        }
        if (elapsed >= seconds) {
          // A final timestamped frame is essential for static scenes: MP4
          // otherwise ends at its last changed frame, sometimes at 1/30 s.
          context.drawImage(canvas, 0, 0);
          track.requestFrame?.();
          onProgress(1);
          stopTimer = window.setTimeout(
            () => {
              if (recorder.state !== 'inactive') recorder.stop();
            },
            Math.max(100, Math.ceil(2000 / fps)),
          );
          return;
        }
        try {
          const frame = Math.floor(elapsed * fps);
          if (started === null || frame !== lastFrame) {
            renderer.render(frameScene(frame / fps), width, height, {
              hazeSteps: 48,
              frame,
              alpha: 0.35,
            });
            context.drawImage(canvas, 0, 0);
            track.requestFrame?.();
            lastFrame = frame;
            onProgress(elapsed / seconds);
          }
          raf = requestAnimationFrame(tick);
        } catch (e) {
          failed = e instanceof Error ? e : new Error(String(e));
          recorder.stop();
        }
      };
      recorder.onstart = () => {
        started = performance.now();
      };
      recorder.start(250);
      track.requestFrame?.();
      raf = requestAnimationFrame(tick);
    });
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    presentation.remove();
    renderer.dispose();
  }
}
