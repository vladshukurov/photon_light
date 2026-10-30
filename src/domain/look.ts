import { isBrand, type BrandId } from './brands';

/*
  Look — всё, что дизайнер выбирает. Физика сцены из него выводится
  (см. scene.ts) и наружу не торчит.

  Свет один. Его место — угол вокруг кадра (0° — сверху, по часовой) и отступ
  от края. Шесть направлений гайда — просто шесть значений этого угла, поэтому
  у всех направлений одна и та же установка, а не шесть отдельно подкрученных
  пресетов. Угол задан в долях кадра, а не в пикселях: при смене 16:9 → 9:16
  источник остаётся на том же месте относительно краёв.
*/

export type Room = 'dark' | 'light';

export interface Motion {
  enabled: boolean;
  /** Куда свет приходит к концу прохода. */
  toAngle: number;
  /** Секунды на один проход. */
  duration: number;
}

export interface Look {
  name: string;
  brand: BrandId;
  room: Room;
  angle: number;
  distance: number;
  width: number;
  height: number;
  expression: number;
  brightness: number;
  spread: number;
  softness: number;
  rays: number;
  rayCount: number;
  haze: number;
  grain: number;
  /** Надпись в сцене; пустая строка — надписи нет. */
  text: string;
  /** Высота строки в долях короткой стороны кадра. */
  textSize: number;
  /** Собственное свечение букв поверх освещения. */
  textGlow: number;
  motion: Motion;
}

export const DIRECTIONS = [
  { id: 'top-left', label: 'Сверху слева', angle: -45 },
  { id: 'top', label: 'Сверху', angle: 0 },
  { id: 'top-right', label: 'Сверху справа', angle: 45 },
  { id: 'bottom-left', label: 'Снизу слева', angle: -135 },
  { id: 'bottom', label: 'Снизу', angle: 180 },
  { id: 'bottom-right', label: 'Снизу справа', angle: 135 },
] as const;

export const FORMATS = [
  { label: '16:9', width: 1920, height: 1080 },
  { label: '9:16', width: 1080, height: 1920 },
  { label: '1:1', width: 1080, height: 1080 },
  { label: '4:5', width: 1080, height: 1350 },
] as const;

interface Range {
  min: number;
  max: number;
  def: number;
}
/** Диапазоны числовых полей. Из них же — ползунки, валидация и дефолты. */
export const RANGES = {
  angle: { min: -180, max: 180, def: -45 },
  distance: { min: 0.2, max: 2, def: 1 },
  expression: { min: 0, max: 1, def: 0 },
  brightness: { min: -1, max: 1, def: 0 },
  spread: { min: 0, max: 1, def: 0.5 },
  softness: { min: 0, max: 1, def: 0.6 },
  rays: { min: 0, max: 1, def: 0 },
  rayCount: { min: 3, max: 16, def: 7 },
  haze: { min: 0, max: 1, def: 0.5 },
  grain: { min: 0, max: 1, def: 0.4 },
  textSize: { min: 0.05, max: 0.4, def: 0.14 },
  textGlow: { min: 0, max: 1, def: 0.6 },
} satisfies Record<string, Range>;
export type NumericKey = keyof typeof RANGES;

export const DEFAULT_LOOK: Look = {
  name: 'Новый свет',
  brand: 'vk',
  room: 'dark',
  angle: -45,
  distance: 1,
  width: 1920,
  height: 1080,
  expression: 0,
  brightness: 0,
  spread: 0.5,
  softness: 0.6,
  rays: 0,
  rayCount: 7,
  haze: 0.5,
  grain: 0.4,
  text: '',
  textSize: 0.14,
  textGlow: 0.6,
  motion: { enabled: false, toAngle: 45, duration: 8 },
};

export const wrapAngle = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function directionOf(angle: number) {
  return DIRECTIONS.find((d) => Math.abs(wrapAngle(d.angle - angle)) < 0.5);
}

/** Угол в момент t ∈ [0, 1] прохода: кратчайшей дугой, с плавным разгоном и торможением. */
export function angleAt(look: Look, t: number) {
  if (!look.motion.enabled) return look.angle;
  const k = clamp(t, 0, 1);
  const eased = k * k * (3 - 2 * k);
  return wrapAngle(look.angle + wrapAngle(look.motion.toAngle - look.angle) * eased);
}

/** Пинг-понг для живого превью: туда за duration, обратно за duration. */
export function loopProgress(seconds: number, duration: number) {
  const phase = (seconds / Math.max(duration, 0.1)) % 2;
  return phase <= 1 ? phase : 2 - phase;
}

export const validDimension = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(clamp(v, 64, 4096)) : fallback;

/** Принимает что угодно и возвращает корректный Look: неизвестное отбрасывается, числа зажимаются. */
export function normalizeLook(raw: unknown): Look {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const look: Look = { ...DEFAULT_LOOK, motion: { ...DEFAULT_LOOK.motion } };
  if (typeof src.name === 'string' && src.name.trim()) look.name = src.name.trim().slice(0, 80);
  if (isBrand(src.brand)) look.brand = src.brand;
  if (src.room === 'dark' || src.room === 'light') look.room = src.room;
  if (typeof src.text === 'string') look.text = src.text.slice(0, 120);
  // Файлы с переключателем «характер» (до ползунка): vivid — это выразительность 100%.
  if (src.character === 'vivid') look.expression = 1;
  for (const key of Object.keys(RANGES) as NumericKey[]) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      look[key] = key === 'angle' ? wrapAngle(v) : clamp(v, RANGES[key].min, RANGES[key].max);
    }
  }
  look.rayCount = Math.round(look.rayCount);
  look.width = validDimension(src.width, look.width);
  look.height = validDimension(src.height, look.height);
  const m =
    src.motion && typeof src.motion === 'object' ? (src.motion as Record<string, unknown>) : {};
  if (typeof m.enabled === 'boolean') look.motion.enabled = m.enabled;
  if (typeof m.toAngle === 'number' && Number.isFinite(m.toAngle))
    look.motion.toAngle = wrapAngle(m.toAngle);
  if (typeof m.duration === 'number' && Number.isFinite(m.duration))
    look.motion.duration = clamp(Math.round(m.duration), 3, 20);
  return look;
}

// --- JSON-пресет ---------------------------------------------------------

export const FILE_VERSION = 3;

export function serializeLook(look: Look): string {
  return JSON.stringify({ app: 'photon', version: FILE_VERSION, look }, null, 2);
}

export interface ParsedLook {
  look: Look;
  /** Файл старого формата: перенесён в новую модель приближённо. */
  adapted: boolean;
}

export function parseLook(text: string): ParsedLook {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Это не JSON-файл.');
  }
  if (!raw || typeof raw !== 'object') throw new Error('В файле нет пресета Фотона.');
  const file = raw as Record<string, unknown>;
  if (typeof file.version === 'number' && file.version > FILE_VERSION)
    throw new Error('Пресет создан в более новой версии Фотона.');
  if (file.look && typeof file.look === 'object')
    return { look: normalizeLook(file.look), adapted: false };
  if (file.params && typeof file.params === 'object')
    return { look: fromLegacy(file.params as Record<string, unknown>, file.name), adapted: true };
  throw new Error('В файле нет пресета Фотона.');
}

/*
  Пресеты прототипа (58 физических ключей). Берём из них то, что имеет смысл в
  новой модели: где стоял источник, тему, цвет стены (по нему угадываем бренд),
  экспозицию и заслонку. Остальное — рукоятки, которых больше нет.
*/
const LEGACY_EXPOSURE = 3.55;
function fromLegacy(p: Record<string, unknown>, name: unknown): Look {
  const num = (k: string, fallback: number) => {
    const v = p[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  const x = num('lightX', -0.88),
    y = num('lightY', 1.32);
  const albedo = typeof p.albedo === 'string' ? p.albedo.toUpperCase() : '';
  const brand: BrandId =
    albedo === '#270C2B'
      ? 'music'
      : albedo === '#111833'
        ? 'video'
        : albedo === '#221133'
          ? 'donut'
          : 'vk';
  return normalizeLook({
    name: typeof name === 'string' ? name : 'Импорт',
    brand,
    room: p.theme === 'light' ? 'light' : 'dark',
    angle: (Math.atan2(x, y) * 180) / Math.PI,
    brightness: (num('exposureEV', LEGACY_EXPOSURE) - LEGACY_EXPOSURE) / 2,
    softness: num('coneSoftness', 0.6),
    rays: Math.min(1, num('goboAmount', 0) * 1.6),
    haze: Math.min(1, num('hazeDensity', 0.28) / 0.56),
    motion: { enabled: false, toAngle: 45, duration: 8 },
  });
}
