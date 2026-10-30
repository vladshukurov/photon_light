import { describe, expect, it } from 'vitest';
import {
  angleAt,
  DEFAULT_LOOK,
  DIRECTIONS,
  loopProgress,
  normalizeLook,
  parseLook,
  serializeLook,
  type Look,
} from './look';
import { buildScene, sourceFromFrame, sourceOnFrame } from './scene';
import { historyReducer, initialHistory, restoreLook, STORAGE_KEY } from './history';
import { aces, luma, solveAmbient, trimInverse } from './tone';
import { BRANDS, LIGHT_ROOM } from './brands';
import { safeFilename, validateSize } from '../engine/export';

const look = (patch: Partial<Look> = {}): Look => normalizeLook({ ...DEFAULT_LOOK, ...patch });

describe('Look boundary', () => {
  it('round trips every field through JSON', () => {
    const l = look({
      name: 'Обложка',
      brand: 'music',
      room: 'light',
      expression: 0.7,
      angle: 137,
      distance: 1.4,
      width: 1080,
      height: 1350,
      rays: 0.6,
      rayCount: 11,
      motion: { enabled: true, toAngle: -45, duration: 12 },
    });
    expect(parseLook(serializeLook(l))).toEqual({ look: l, adapted: false });
  });

  it('clamps numbers, drops unknown keys and never coerces strings', () => {
    const l = normalizeLook({
      brand: 'tiktok',
      room: 'neon',
      brightness: 99,
      haze: Number.NaN,
      angle: 370,
      width: 99999,
      motion: { enabled: 'true', duration: 100 },
      extra: 1,
    });
    expect(l.brand).toBe('vk');
    expect(l.room).toBe('dark');
    expect(l.brightness).toBe(1);
    expect(l.haze).toBe(DEFAULT_LOOK.haze);
    expect(l.angle).toBeCloseTo(10);
    expect(l.width).toBe(4096);
    expect(l.motion).toEqual({ ...DEFAULT_LOOK.motion, duration: 20 });
    expect('extra' in l).toBe(false);
  });

  it('rejects foreign and future files', () => {
    expect(() => parseLook('not json')).toThrow('JSON');
    expect(() => parseLook('{"hello":1}')).toThrow('пресета');
    expect(() => parseLook('{"version":99,"look":{}}')).toThrow('новой');
  });

  it('maps prototype presets into the new model', () => {
    const legacy = JSON.stringify({
      version: 2,
      name: 'Первый свет',
      params: { theme: 'dark', lightX: 0.88, lightY: 1.32, albedo: '#270C2B', goboAmount: 0.3 },
    });
    const { look: l, adapted } = parseLook(legacy);
    expect(adapted).toBe(true);
    expect(l.name).toBe('Первый свет');
    expect(l.brand).toBe('music');
    expect(l.angle).toBeGreaterThan(20);
    expect(l.angle).toBeLessThan(50);
    expect(l.rays).toBeGreaterThan(0);
  });
});

describe('one light rig', () => {
  it('mirrors left and right directions exactly', () => {
    const left = buildScene(look({ angle: -45 }), 16 / 9);
    const right = buildScene(look({ angle: 45 }), 16 / 9);
    expect(left.light.pos[0]).toBeCloseTo(-right.light.pos[0]);
    expect(left.light.pos[1]).toBeCloseTo(right.light.pos[1]);
    expect(left.light.dir[0]).toBeCloseTo(-right.light.dir[0]);
    expect(left.light.gain).toBe(right.light.gain);
    expect(left.light.coneHalf).toBe(right.light.coneHalf);
  });

  it('changes only geometry between directions, never exposure or material', () => {
    const scenes = DIRECTIONS.map((d) => buildScene(look({ angle: d.angle }), 1));
    for (const s of scenes) {
      expect(s.light.gain).toBe(scenes[0].light.gain);
      expect(s.haze.density).toBe(scenes[0].haze.density);
      expect(s.albedo).toEqual(scenes[0].albedo);
    }
  });

  it('keeps the source outside the frame by default in every format', () => {
    for (const aspect of [16 / 9, 9 / 16, 1, 4 / 5]) {
      for (const d of DIRECTIONS) {
        const [u, v] = sourceOnFrame(d.angle, 1, aspect);
        expect(Math.max(Math.abs(u), Math.abs(v))).toBeGreaterThan(1);
      }
    }
  });

  it('inverts dragging back to the same angle and distance', () => {
    for (const aspect of [16 / 9, 9 / 16]) {
      const [u, v] = sourceOnFrame(-30, 1.3, aspect);
      const s = sourceFromFrame(u, v, aspect);
      expect(s.angle).toBeCloseTo(-30, 4);
      expect(s.distance).toBeCloseTo(1.3, 4);
    }
  });

  it('VK light is white; sub-brands tint only the light colour', () => {
    const vk = buildScene(look({ brand: 'vk' }), 1);
    const music = buildScene(look({ brand: 'music' }), 1);
    expect(vk.light.color.every((c) => Math.abs(c - 1) < 1e-6)).toBe(true);
    expect(music.light.color).not.toEqual(vk.light.color);
    expect({ ...music.light, color: null }).toEqual({ ...vk.light, color: null });
    expect(music.albedo).toEqual(vk.albedo);
    expect(Math.max(...vk.albedo) - Math.min(...vk.albedo)).toBeLessThan(0.002);
  });

  it('switching room keeps the light placement', () => {
    const dark = buildScene(look({ room: 'dark', angle: 120 }), 16 / 9);
    const light = buildScene(look({ room: 'light', angle: 120 }), 16 / 9);
    expect(light.light.pos).toEqual(dark.light.pos);
    expect(light.light.dir).toEqual(dark.light.dir);
  });
});

describe('text', () => {
  it('keeps text in the look and trims it into the scene', () => {
    const l = normalizeLook({ text: '  VK CONF  ', textSize: 9 });
    expect(l.text).toBe('  VK CONF  ');
    expect(l.textSize).toBe(0.4);
    expect(buildScene(l, 1).text.content).toBe('VK CONF');
    expect(normalizeLook({ text: 42 }).text).toBe('');
  });

  it('glows only in the dark room', () => {
    expect(buildScene(look({ text: 'A', room: 'light' }), 1).text.glow).toBe(0);
    expect(buildScene(look({ text: 'A' }), 1).text.glow).toBeGreaterThan(0);
  });
});

describe('expression', () => {
  it('blends between the guide and vivid calibrations', () => {
    const guide = buildScene(look({ expression: 0 }), 1);
    const half = buildScene(look({ expression: 0.5 }), 1);
    const vivid = buildScene(look({ expression: 1 }), 1);
    expect(half.light.gain).toBeGreaterThan(guide.light.gain);
    expect(half.light.gain).toBeLessThan(vivid.light.gain);
    expect(vivid.light.pos).toEqual(guide.light.pos);
  });

  it('opens files saved with the old character switch', () => {
    expect(normalizeLook({ character: 'vivid' }).expression).toBe(1);
    expect(normalizeLook({ character: 'guide' }).expression).toBe(0);
  });
});

describe('light pass motion', () => {
  const moving = look({ angle: -45, motion: { enabled: true, toAngle: 45, duration: 8 } });

  it('eases from start to target along the shorter arc', () => {
    expect(angleAt(moving, 0)).toBe(-45);
    expect(angleAt(moving, 0.5)).toBeCloseTo(0);
    expect(angleAt(moving, 1)).toBeCloseTo(45);
    const wrap = look({ angle: 135, motion: { enabled: true, toAngle: -135, duration: 8 } });
    expect(Math.abs(angleAt(wrap, 0.5))).toBeCloseTo(180);
  });

  it('stays put when motion is off', () => {
    expect(angleAt(look({ angle: 30 }), 0.7)).toBe(30);
  });

  it('ping-pongs in the live preview', () => {
    expect(loopProgress(0, 8)).toBe(0);
    expect(loopProgress(8, 8)).toBe(1);
    expect(loopProgress(12, 8)).toBeCloseTo(0.5);
    expect(loopProgress(16, 8)).toBeCloseTo(0);
  });
});

describe('tone', () => {
  it('solves light-room ambient so the unlit wall equals the guide colour', () => {
    const ambient = solveAmbient(LIGHT_ROOM.floor, LIGHT_ROOM.wall, 1);
    const scene = buildScene(look({ room: 'light' }), 1);
    const wall = scene.albedo.map((a, i) => a * ambient[i]);
    const out = aces(wall);
    const target = [0xc7, 0xcb, 0xd6].map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    out.forEach((v, i) => expect(v).toBeCloseTo(target[i], 4));
  });

  it('saturation trim inverse preserves luminance', () => {
    const c = [0.3, 0.2, 0.5];
    expect(luma(trimInverse(c, 1.6))).toBeCloseTo(luma(c), 6);
  });

  it('every brand light is a valid colour', () => {
    for (const b of BRANDS) for (const c of [b.light]) expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('history and storage', () => {
  it('merges rapid edits of one control and drops redo on a new edit', () => {
    let s = initialHistory(look());
    s = historyReducer(s, { type: 'set', next: look({ haze: 0.2 }), now: 1000, group: 'haze' });
    s = historyReducer(s, { type: 'set', next: look({ haze: 0.3 }), now: 1200, group: 'haze' });
    expect(s.past).toHaveLength(1);
    s = historyReducer(s, { type: 'undo' });
    expect(s.present.haze).toBe(DEFAULT_LOOK.haze);
    s = historyReducer(s, { type: 'set', next: look({ rays: 0.5 }), now: 5000 });
    expect(s.future).toHaveLength(0);
  });

  it('restores a saved look and survives corrupt storage', () => {
    const saved = look({ brand: 'donut' });
    expect(restoreLook({ getItem: () => JSON.stringify(saved) })).toEqual(saved);
    expect(restoreLook({ getItem: () => '{broken' })).toEqual(DEFAULT_LOOK);
    expect(
      restoreLook({
        getItem: (k) => (k === STORAGE_KEY ? null : 'x'),
      }),
    ).toEqual(DEFAULT_LOOK);
  });
});

describe('export boundary', () => {
  it('validates sizes and file names', () => {
    expect(() => validateSize(1920, 1080)).not.toThrow();
    expect(() => validateSize(10, 1080)).toThrow();
    expect(() => validateSize(5000, 1080)).toThrow();
    expect(safeFilename('a/b:c*?')).toBe('abc');
    expect(safeFilename('   ')).toBe('photon');
  });
});

describe('real prototype file', () => {
  it('opens a preset saved by the prototype', async () => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(new URL('./fixtures/legacy-v2.json', import.meta.url), 'utf8');
    const { look: l, adapted } = parseLook(text);
    expect(adapted).toBe(true);
    expect(l.name).toBe('Первый свет');
    expect(l.angle).toBeLessThan(0);
    expect(l.room).toBe('dark');
  });
});
