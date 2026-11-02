import { describe, expect, it } from 'vitest';
import {
  angleAt,
  DEFAULT_LOOK,
  DIRECTIONS,
  loopProgress,
  normalizeLook,
  parseLook,
  RANGES,
  serializeLook,
  type Look,
} from './look';
import { buildScene, edgePoint, frameHalf, sourceFromFrame, sourceOnFrame } from './scene';
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
      tone: 'blue',
      room: 'light',
      expression: 0.7,
      diffusion: 0.6,
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
      tone: 'red',
      brightness: 99,
      diffusion: 99,
      haze: Number.NaN,
      angle: 370,
      width: 99999,
      motion: { enabled: 'true', duration: 100 },
      extra: 1,
    });
    expect(l.brand).toBe('vk');
    expect(l.room).toBe('dark');
    expect(l.tone).toBe('mono');
    expect(l.brightness).toBe(1);
    expect(l.diffusion).toBe(1);
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
  it('keeps the original side direction positions in every format', () => {
    for (const aspect of [16 / 9, 9 / 16, 1, 4 / 5]) {
      const [hw, hh] = frameHalf(aspect);
      for (const [angle, x, y] of [
        [-45, -0.55, 1],
        [45, 0.55, 1],
        [-135, -0.55, -1],
        [135, 0.55, -1],
        [0, 0, 1],
        [180, 0, -1],
      ]) {
        const [ex, ey] = edgePoint(angle, aspect);
        expect(ex / hw).toBeCloseTo(x);
        expect(ey / hh).toBeCloseTo(y);
      }
    }
  });

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

  it('VK tone changes colour without changing the light distribution', () => {
    for (const room of ['dark', 'light'] as const) {
      for (const direction of DIRECTIONS) {
        const mono = buildScene(look({ room, angle: direction.angle, tone: 'mono' }), 16 / 9);
        const blue = buildScene(look({ room, angle: direction.angle, tone: 'blue' }), 16 / 9);
        expect(blue.light.gain).toBe(mono.light.gain);
        expect(blue.bounce.gain).toBe(mono.bounce.gain);
        expect(blue.light.coneHalf).toBe(mono.light.coneHalf);
        expect(blue.bounce.coneHalf).toBe(mono.bounce.coneHalf);
      }
    }
  });

  it('diffusion broadens the halo independently of brand, tone and the main beam', () => {
    for (const [brand, tone] of [
      ['vk', 'mono'],
      ['vk', 'blue'],
      ['music', 'mono'],
    ] as const) {
      const narrow = buildScene(look({ brand, tone, diffusion: 0 }), 1);
      const wide = buildScene(look({ brand, tone, diffusion: 1 }), 1);
      expect(wide.light).toEqual(narrow.light);
      expect(wide.bounce.gain).toBeGreaterThan(narrow.bounce.gain * 10);
      expect(wide.bounce.coneHalf).toBeGreaterThan(wide.light.coneHalf);
    }
    expect(normalizeLook({ tone: 'blue' }).diffusion).toBe(0);
  });

  it('VK mono is a white lamp with a faint white halo instead of a bounce', () => {
    const vk = buildScene(look({ brand: 'vk', tone: 'mono' }), 1);
    const blue = buildScene(look({ brand: 'vk', tone: 'blue' }), 1);
    expect(vk.light.color.every((c) => Math.abs(c - 1) < 1e-6)).toBe(true);
    expect(vk.bounce.color.every((c) => Math.abs(c - 1) < 1e-6)).toBe(true);
    expect(vk.bounce.gain / vk.light.gain).toBe(blue.bounce.gain / blue.light.gain);
    expect(Math.max(...vk.albedo) - Math.min(...vk.albedo)).toBeLessThan(0.002);
  });

  it('sub-brands share the default VK rig and colour the beam, not the source', () => {
    const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
    const blue = buildScene(look({ brand: 'vk', tone: 'blue' }), 1);
    const mono = buildScene(look({ brand: 'vk', tone: 'mono' }), 1);
    // Синяя версия VK: лампа почти белая, цвет — в отливе.
    expect(spread(blue.light.color)).toBeLessThan(spread(blue.bounce.color));
    for (const brand of ['music', 'video', 'donut'] as const) {
      const s = buildScene(look({ brand }), 1);
      // Та же установка, что у VK: яркость, конус, геометрия и материал.
      expect(s.light.gain).toBe(mono.light.gain);
      expect(s.light.coneHalf).toBe(mono.light.coneHalf);
      expect(s.light.pos).toEqual(mono.light.pos);
      expect(s.light.dir).toEqual(mono.light.dir);
      expect(s.albedo).toEqual(mono.albedo);
      // Отлив — шире и мягче лампы: своего пятна у него нет.
      expect(s.bounce.coneHalf).toBeGreaterThan(s.light.coneHalf);
      expect(s.bounce.radius).toBeGreaterThan(s.light.radius);
      // Цвет бренда — в луче, а свечение источника белее луча.
      expect(spread(s.light.color)).toBeGreaterThan(spread(blue.light.color));
      expect(spread(s.glow.color)).toBeLessThan(spread(s.light.color));
      // Тон касается только VK.
      expect(buildScene(look({ brand, tone: 'blue' }), 1)).toEqual(s);
    }
  });

  it('source glow brightens toward white without moving the light', () => {
    const off = buildScene(look({ glow: 0 }), 16 / 9);
    const half = buildScene(look({ glow: 0.5 }), 16 / 9);
    const full = buildScene(look({ glow: 1 }), 16 / 9);
    expect(off.glow.gain).toBe(0);
    expect(half.glow.gain).toBeGreaterThan(0);
    expect(full.glow.gain).toBeGreaterThan(half.glow.gain * 4);
    expect(full.light).toEqual(off.light);
    expect(full.glow.color.every((c) => Math.abs(c - 1) < 1e-6)).toBe(true);
    // Свечение прижато к краю со стороны источника, а не висит в кадре.
    const [hw, hh] = frameHalf(16 / 9);
    const [x, y] = half.glow.pos;
    expect(Math.max(Math.abs(x) / hw, Math.abs(y) / hh)).toBeGreaterThan(1);
    expect(Math.sign(x)).toBe(Math.sign(half.light.pos[0]));
  });

  it('starts from the art director setup: a visible source with light haze', () => {
    expect(DEFAULT_LOOK).toMatchObject({
      brand: 'vk',
      tone: 'mono',
      angle: -38,
      distance: 1.75,
      expression: 0.18,
      brightness: 0.36,
      spread: 0.19,
      diffusion: 0,
      softness: 0.5,
      glow: 0.5,
      haze: 0.29,
      rays: 0,
    });
    // Дефолты ползунков совпадают с дефолтным светом: «Сбросить» возвращает к нему.
    for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[])
      expect(RANGES[key].def).toBe(DEFAULT_LOOK[key]);
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

  it('every brand accent is a valid colour', () => {
    for (const b of BRANDS) expect(b.accent).toMatch(/^#[0-9A-F]{6}$/);
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
    expect(safeFilename('a'.repeat(80) + ' 1920×1080.png')).toBe('a'.repeat(80) + '.png');
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
