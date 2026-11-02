import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOOK } from './look';
import { EXPORT_SETTINGS_KEY, exportPresets, restoreExportSettings } from './exportSettings';

afterEach(() => vi.unstubAllGlobals());
describe('export preferences', () => {
  it('deduplicates equal output sizes', () => {
    expect(exportPresets(DEFAULT_LOOK).map((p) => [p.width, p.height])).toEqual([
      [1920, 1080],
      [3840, 2160],
    ]);
    expect(exportPresets({ width: 1080, height: 1080 })).toHaveLength(3);
  });
  it('restores preferences and adapts a locked custom size to a new scene format', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === EXPORT_SETTINGS_KEY
          ? JSON.stringify({
              kind: 'layers',
              format: 'jpg',
              preset: 'custom',
              width: 1600,
              height: 900,
              locked: true,
              sceneRatio: 16 / 9,
              quality: 0.8,
            })
          : null,
    });
    const settings = restoreExportSettings({ width: 1080, height: 1920 });
    expect(settings).toMatchObject({
      kind: 'layers',
      format: 'jpg',
      width: 900,
      height: 1600,
      quality: 0.8,
      locked: true,
    });
    expect(settings.ratio).toBe(9 / 16);
  });
  it('ignores malformed and unavailable browser storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{' });
    expect(restoreExportSettings(DEFAULT_LOOK)).toMatchObject({
      preset: 'x1',
      locked: true,
      format: 'png',
    });
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ width: -1, height: 'bad', quality: 9, locked: 'true' }),
    });
    expect(restoreExportSettings(DEFAULT_LOOK)).toMatchObject({
      width: 1920,
      height: 1080,
      quality: 1,
      locked: true,
    });
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(restoreExportSettings(DEFAULT_LOOK).width).toBe(1920);
  });
});
