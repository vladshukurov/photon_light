import type { Look } from './look';

export const EXPORT_SETTINGS_KEY = 'photon:export:v1';
export interface ExportSettings {
  kind: 'image' | 'layers';
  format: 'png' | 'jpg';
  preset: string;
  width: number;
  height: number;
  locked: boolean;
  ratio: number;
  quality: number;
  sceneRatio: number;
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
  };
  try {
    const raw = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return defaults;
    const size = (v: unknown, fallback: number) =>
      typeof v === 'number' && Number.isInteger(v) && v >= 64 && v <= 4096 ? v : fallback;
    const next = {
      ...defaults,
      kind: raw.kind === 'layers' ? ('layers' as const) : ('image' as const),
      format: raw.format === 'jpg' ? ('jpg' as const) : ('png' as const),
      preset: ['x1', 'x2', '4k', 'custom'].includes(raw.preset) ? raw.preset : 'x1',
      width: size(raw.width, look.width),
      height: size(raw.height, look.height),
      locked: typeof raw.locked === 'boolean' ? raw.locked : true,
      quality:
        typeof raw.quality === 'number' && Number.isFinite(raw.quality)
          ? Math.min(1, Math.max(0.4, raw.quality))
          : 0.95,
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
