import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { Renderer } from './renderer';
import { exportVideo, validateSize } from './export';
import { buildScene } from '../domain/scene';
import type { Look } from '../domain/look';

/*
  Ролик пишется покадрово, а не с экрана в реальном времени.

  Запись с экрана (MediaRecorder) успевает ровно столько кадров, сколько
  видеокарта нарисует за секунду: на слабой машине кадры теряются, и проход
  света дёргается. Здесь каждый кадр считается столько, сколько нужно, и
  кодируется WebCodecs в H.264 — ролик одинаково плавный на любой машине.

  Размытие движения — как у камеры с выдержкой в половину кадра (затвор 180°):
  кадр собирается из нескольких промежуточных моментов внутри выдержки.
  Движущийся свет оставляет мягкий след, а не ступеньки, и заодно уходит шум
  марша дымки. Без размытия кадр всё равно копится из тех же моментов в одной
  точке времени — только ради чистоты дымки.

  Петля без шва. Свет «туда и обратно» к концу ролика сам возвращается в
  начало, а дымка течёт непериодично — на стыке она бы прыгнула. Поэтому в
  последнюю секунду кадр плавно смешивается с тем же моментом, сдвинутым на
  длину ролика назад: к последнему кадру ролик уже показывает своё начало.
*/

export interface VideoOptions {
  width: number;
  height: number;
  seconds: number;
  fps: number;
  motionBlur: boolean;
  /** Ролик зациклен: конец плавно переходит в начало. */
  loop: boolean;
}

/** Сколько моментов внутри выдержки собирают один кадр. */
const SUBFRAMES = 3;
/** Выдержка — половина кадра. */
const SHUTTER = 0.5;
/** Ключевой кадр раз в две секунды: перемотка в монтажке остаётся быстрой. */
const KEYFRAME_SECONDS = 2;
/** Сколько секунд в конце петли уходит на переход к началу. */
const SEAM_SECONDS = 1;
/**
 * Прогрев кодировщика: первые кадры H.264 выходят другого качества, пока он
 * подбирает сжатие, и на стыке петли это видно как вспышка шума. Прогрев
 * кодируется, но в ролик не попадает.
 */
const WARMUP_SECONDS = 0.5;

/** Кодеки по убыванию совместимости: H.264 открывается везде, включая Figma и QuickTime. */
const CODECS = [
  { codec: 'avc1.640033', mux: 'avc' },
  { codec: 'avc1.640028', mux: 'avc' },
  { codec: 'avc1.4d0028', mux: 'avc' },
  { codec: 'avc1.42e01f', mux: 'avc' },
  { codec: 'vp09.00.40.08', mux: 'vp9' },
  { codec: 'av01.0.08M.08', mux: 'av1' },
] as const;

export const canRenderOffline = () =>
  typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

/**
 * Битрейт с запасом: тёмные плавные градиенты — худший случай для кодека, на
 * скупом битрейте они идут кольцами.
 */
const bitrateFor = (w: number, h: number, fps: number) =>
  Math.round(Math.min(60e6, Math.max(8e6, w * h * fps * 0.3)));

async function pickCodec(width: number, height: number, fps: number) {
  for (const c of CODECS) {
    const config: VideoEncoderConfig = {
      codec: c.codec,
      width,
      height,
      framerate: fps,
      bitrate: bitrateFor(width, height, fps),
      latencyMode: 'quality',
      ...(c.mux === 'avc' ? { avc: { format: 'avc' as const } } : {}),
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) return { config: support.config ?? config, mux: c.mux };
    } catch {
      // Неизвестная строка кодека в этом браузере — пробуем следующую.
    }
  }
  return null;
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
const aborted = () => new DOMException('Запись отменена', 'AbortError');

/**
 * Пишет ролик. Где нет WebCodecs или подходящего кодека — откатывается на
 * запись в реальном времени.
 */
export async function renderVideo(
  look: Look,
  opts: VideoOptions,
  signal: AbortSignal,
  onProgress: (done: number, frame: number, total: number) => void,
): Promise<{ blob: Blob; ext: string; offline: boolean }> {
  // H.264 требует чётных сторон.
  const width = opts.width - (opts.width % 2);
  const height = opts.height - (opts.height % 2);
  validateSize(width, height);
  const chosen = canRenderOffline() ? await pickCodec(width, height, opts.fps) : null;
  if (!chosen) {
    const live = await exportVideo(look, width, height, opts.seconds, opts.fps, signal, (n) =>
      onProgress(n, Math.round(n * opts.seconds * opts.fps), Math.round(opts.seconds * opts.fps)),
    );
    return { ...live, offline: false };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new Renderer(canvas, { preserveDrawingBuffer: true });
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: chosen.mux, width, height, frameRate: opts.fps },
    fastStart: 'in-memory',
  });
  let failure: Error | null = null;
  // Описание кодека приходит с первым кадром прогрева — его отдаём первому кадру ролика.
  let decoderConfig: VideoDecoderConfig | undefined;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (chunk.timestamp < 0) {
        decoderConfig = meta?.decoderConfig ?? decoderConfig;
        return;
      }
      muxer.addVideoChunk(
        chunk,
        decoderConfig && !meta?.decoderConfig ? { ...meta, decoderConfig } : meta,
      );
      decoderConfig = undefined;
    },
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });
  try {
    renderer.init();
    encoder.configure(chosen.config);
    const total = Math.max(1, Math.round(opts.seconds * opts.fps));
    const frameTime = 1 / opts.fps;
    const keyEvery = Math.max(1, Math.round(opts.fps * KEYFRAME_SECONDS));
    const sceneAt = (t: number) => buildScene(look, width / height, { time: t });

    const warmup = Math.round(opts.fps * WARMUP_SECONDS);
    for (let i = -warmup; i < total; i++) {
      if (signal.aborted) throw aborted();
      if (failure) throw failure;
      // Прогрев петли — то, во что переходит её хвост: те же моменты до начала
      // ролика, без смешивания шва (вдвое дешевле). Без петли — первый кадр.
      const t0 = i >= 0 || opts.loop ? i * frameTime : 0;
      const n = i + warmup;
      for (let s = 0; s < SUBFRAMES; s++) {
        if (signal.aborted) throw aborted();
        // Моменты внутри выдержки, по центру кадра.
        const offset = opts.motionBlur ? ((s + 0.5) / SUBFRAMES - 0.5) * SHUTTER * frameTime : 0;
        renderer.render(sceneAt(t0 + offset), width, height, {
          hazeSteps: 64,
          frame: n * SUBFRAMES + s,
          alpha: 1 / (s + 1),
        });
      }
      const seam = opts.loop ? Math.min(SEAM_SECONDS, opts.seconds / 4) : 0;
      const into = t0 - (opts.seconds - seam);
      if (seam > 0 && into > 0 && i >= 0) {
        // Тот же момент на длину ролика раньше — подмешивается всё сильнее и
        // собирается из тех же моментов выдержки: иначе на стыке меняется шум.
        // Доли подобраны так, что каждый момент входит с весом w / SUBFRAMES.
        const k = into / seam;
        const w = k * k * (3 - 2 * k);
        for (let s = 0; s < SUBFRAMES; s++) {
          const offset = opts.motionBlur ? ((s + 0.5) / SUBFRAMES - 0.5) * SHUTTER * frameTime : 0;
          renderer.render(sceneAt(t0 + offset - opts.seconds), width, height, {
            hazeSteps: 64,
            frame: n * SUBFRAMES + s,
            alpha: w / SUBFRAMES / (1 - ((SUBFRAMES - 1 - s) * w) / SUBFRAMES),
          });
        }
      }
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(i * frameTime * 1e6),
        duration: Math.round(frameTime * 1e6),
      });
      encoder.encode(frame, { keyFrame: i === -warmup || (i >= 0 && i % keyEvery === 0) });
      frame.close();
      if (i >= 0) onProgress((i + 1) / total, i + 1, total);
      // Не копим очередь кодировщика и даём интерфейсу дышать.
      while (encoder.encodeQueueSize > 4) await nextTask();
      await nextTask();
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    const { buffer } = muxer.target;
    return { blob: new Blob([buffer], { type: 'video/mp4' }), ext: 'mp4', offline: true };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    renderer.dispose();
  }
}
