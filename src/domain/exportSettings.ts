import type { Look } from './look';

export const EXPORT_SETTINGS_KEY = 'photon:export:v1';

export type VideoPreset = 'v720' | 'v1080' | 'v4k';
export interface VideoSettings {
  preset: VideoPreset;
  fps: 24 | 30 | 60;
  /** Длина ролика без движения света: живут только дымка и лучи. */
  seconds: 5 | 10 | 15;
  motionBlur: boolean;
}
const VIDEO_DEFAULTS: VideoSettings = { preset: 'v1080', fps: 30, seconds: 10, motionBlur: true };

export interface ExportSettings {
  kind: 'image' | 'layers' | 'video';
  format: 'png' | 'jpg';
  preset: string;
  width: number;
  height: number;
  locked: boolean;
  ratio: number;
  quality: number;
  sceneRatio: number;
  video: VideoSettings;
}

/** Размеры ролика под пропорции сцены: по длинной стороне 1280, 1920 и 3840. */
export function videoPresets(look: Pick<Look, 'width' | 'height'>) {
  const ratio = look.width / look.height;
  const fit = (long: number) =>
    ratio >= 1
      ? { width: long, height: Math.round(long / ratio / 2) * 2 }
      : { width: Math.round((long * ratio) / 2) * 2, height: long };
  return [
    { id: 'v720' as const, label: '720p', ...fit(1280) },
    { id: 'v1080' as const, label: '1080p', ...fit(1920) },
    { id: 'v4k' as const, label: '4K', ...fit(3840) },
  ];
}

export function exportPresets(look: Pick<Look, 'width' | 'height'>) {
  const ratio = look.width / look.height;
  const fit = (long: number) =>
    ratio >= 1
      ? { width: long, height: Math.round(long / ratio) }
      : { width: Math.round(long * ratio), height: long };
  const all = [
    { id: 'x1', label: '1×', width: look.width, height: look.height },
    { id: 'x2', label: '2×', ...fit(Math.min(Math.max(look.width, look.height) * 2, 4096)) },
    { id: '4k', label: '4K', ...fit(3840) },
  ];
  return all.filter(
    (p, i) => all.findIndex((q) => q.width === p.width && q.height === p.height) === i,
  );
}

function restoreVideo(raw: unknown): VideoSettings {
  const v = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    preset: v.preset === 'v720' || v.preset === 'v4k' ? v.preset : VIDEO_DEFAULTS.preset,
    fps: v.fps === 24 || v.fps === 60 ? v.fps : VIDEO_DEFAULTS.fps,
    seconds: v.seconds === 5 || v.seconds === 15 ? v.seconds : VIDEO_DEFAULTS.seconds,
    motionBlur: typeof v.motionBlur === 'boolean' ? v.motionBlur : VIDEO_DEFAULTS.motionBlur,
  };
}

export function restoreExportSettings(look: Pick<Look, 'width' | 'height'>): ExportSettings {
  const defaults: ExportSettings = {
    kind: 'image',
    format: 'png',
    preset: 'x1',
    width: look.width,
    height: look.height,
    locked: true,
    ratio: look.width / look.height,
    quality: 0.95,
    sceneRatio: look.width / look.height,
    video: { ...VIDEO_DEFAULTS },
  };
  try {
    const raw = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return defaults;
    const size = (v: unknown, fallback: number) =>
      typeof v === 'number' && Number.isInteger(v) && v >= 64 && v <= 4096 ? v : fallback;
    const next = {
      ...defaults,
      kind:
        raw.kind === 'layers' || raw.kind === 'video'
          ? (raw.kind as 'layers' | 'video')
          : ('image' as const),
      format: raw.format === 'jpg' ? ('jpg' as const) : ('png' as const),
      preset: ['x1', 'x2', '4k', 'custom'].includes(raw.preset) ? raw.preset : 'x1',
      width: size(raw.width, look.width),
      height: size(raw.height, look.height),
      locked: typeof raw.locked === 'boolean' ? raw.locked : true,
      quality:
        typeof raw.quality === 'number' && Number.isFinite(raw.quality)
          ? Math.min(1, Math.max(0.4, raw.quality))
          : 0.95,
      video: restoreVideo(raw.video),
    };
    next.ratio = next.width / next.height;
    if (next.locked && raw.sceneRatio !== defaults.sceneRatio) {
      const long = Math.max(next.width, next.height);
      next.width = defaults.sceneRatio >= 1 ? long : Math.round(long * defaults.sceneRatio);
      next.height = defaults.sceneRatio >= 1 ? Math.round(long / defaults.sceneRatio) : long;
      next.ratio = defaults.sceneRatio;
    }
    if (next.preset !== 'custom' && !exportPresets(look).some((p) => p.id === next.preset)) {
      next.preset =
        exportPresets(look).find((p) => p.width === next.width && p.height === next.height)?.id ??
        'custom';
    }
    return next;
  } catch {
    return defaults;
  }
}
