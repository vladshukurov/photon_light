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
/** Версия основного VK: с лёгким синим отливом (по умолчанию) или ч/б. Сабрендов не касается. */
export type Tone = 'mono' | 'blue';

/*
  Движение — живой свет. Это тот же кадр, что в статике, только проигранный
  во времени: дымка течёт, лучи переливаются. Прибор, луч и все настройки
  света стоят — движение ничего не добавляет к кадру и не меняет его.
*/
export interface Motion {
  enabled: boolean;
  /** Длина ролика-петли, секунды. */
  duration: number;
  /** Скорость жизни света: 1 — как задумано, меньше — спокойнее. */
  speed: number;
}

export interface Look {
  name: string;
  brand: BrandId;
  tone: Tone;
  room: Room;
  angle: number;
  distance: number;
  width: number;
  height: number;
  expression: number;
  brightness: number;
  spread: number;
  /** Сила широкого ореола, независимо от цвета света. */
  diffusion: number;
  softness: number;
  /** Свечение самого источника у края кадра: больше — ярче и белее. */
  glow: number;
  rays: number;
  rayCount: number;
  haze: number;
  grain: number;
  /** Надпись в сцене; пустая строка — надписи нет. */
  text: string;
  /** Высота строки в долях короткой стороны кадра. */
  textSize: number;
  motion: Motion;
}

/**
 * Надпись в свете. Пока скрыта (05.11): поля нет, сцена надпись не рисует.
 * Текст в пресетах и JSON сохраняется — вернуть можно, поставив true.
 */
export const LETTERING = false;

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
  diffusion: { min: 0, max: 1, def: 0 },
  spread: { min: 0, max: 1, def: 0.5 },
  softness: { min: 0, max: 1, def: 0.5 },
  glow: { min: 0, max: 1, def: 0 },
  rays: { min: 0, max: 1, def: 0 },
  rayCount: { min: 3, max: 16, def: 3 },
  haze: { min: 0, max: 1, def: 0.5 },
  grain: { min: 0, max: 1, def: 0.4 },
  textSize: { min: 0.05, max: 0.4, def: 0.14 },
} satisfies Record<string, Range>;
export type NumericKey = keyof typeof RANGES;

/*
  Дефолт — пресет арт-директора от 09.11: свет направлений гайда (Figma
  16719:174652), VK с синим отливом, источник сверху слева за краем, луч чуть
  ярче и уже прежнего, свечение и рассеивание выключены, три луча.
*/
export const DEFAULT_LOOK: Look = {
  name: 'Новый свет',
  brand: 'vk',
  tone: 'blue',
  room: 'dark',
  angle: -45,
  distance: 1,
  width: 1920,
  height: 1080,
  expression: 0,
  brightness: 0,
  spread: 0.5,
  diffusion: 0,
  softness: 0.5,
  glow: 0,
  rays: 0,
  rayCount: 3,
  haze: 0.5,
  grain: 0.4,
  text: '',
  textSize: 0.14,
  motion: { enabled: false, duration: 10, speed: 1 },
};

export const wrapAngle = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function directionOf(angle: number) {
  return DIRECTIONS.find((d) => Math.abs(wrapAngle(d.angle - angle)) < 0.5);
}

/** Момент внутри петли живого света. */
export const loopTime = (motion: Motion, seconds: number) =>
  ((seconds % motion.duration) + motion.duration) % motion.duration;

export const validDimension = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(clamp(v, 64, 4096)) : fallback;

/** Принимает что угодно и возвращает корректный Look: неизвестное отбрасывается, числа зажимаются. */
export function normalizeLook(raw: unknown): Look {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const look: Look = { ...DEFAULT_LOOK, motion: { ...DEFAULT_LOOK.motion } };
  if (typeof src.name === 'string' && src.name.trim()) look.name = src.name.trim().slice(0, 80);
  if (isBrand(src.brand)) look.brand = src.brand;
  if (src.room === 'dark' || src.room === 'light') look.room = src.room;
  if (src.tone === 'mono' || src.tone === 'blue') look.tone = src.tone;
  if (typeof src.text === 'string') look.text = src.text.slice(0, 120);
  // Файлы с переключателем «характер» (до ползунка): guide — 0%, vivid — 100%.
  if (src.character === 'guide') look.expression = 0;
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
  if (typeof m.duration === 'number' && Number.isFinite(m.duration))
    look.motion.duration = clamp(Math.round(m.duration), 3, 20);
  if (typeof m.speed === 'number' && Number.isFinite(m.speed))
    look.motion.speed = clamp(m.speed, 0.25, 3);
  return look;
}

// --- JSON-пресет ---------------------------------------------------------

/*
  Версия 4 (09.11): дефолт — пресет арт-директора. Ползунки остались на
  круглых значениях, а шкалы под ними сдвинуты: яркость 0 — прежние +10%,
  ширина луча 50% — прежние 30%. Файлы версии 3 переводятся в новые шкалы при
  открытии, свет в них не меняется.
*/
export const FILE_VERSION = 4;

/** Перевод пресета из шкал версии 3: тот же свет на новых ползунках. */
function fromV3(look: Look): Look {
  return {
    ...look,
    brightness: clamp(look.brightness - 0.1, RANGES.brightness.min, RANGES.brightness.max),
    spread: look.spread ** (Math.log(0.5) / Math.log(0.3)),
  };
}

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
  if (!raw || typeof raw !== 'object') throw new Error('В файле нет пресета.');
  const file = raw as Record<string, unknown>;
  if (typeof file.version === 'number' && file.version > FILE_VERSION)
    throw new Error('Пресет создан в более новой версии студии.');
  const v3 = typeof file.version !== 'number' || file.version < 4;
  if (file.look && typeof file.look === 'object') {
    const look = normalizeLook(file.look);
    return { look: v3 ? fromV3(look) : look, adapted: false };
  }
  if (file.params && typeof file.params === 'object')
    return {
      look: fromV3(fromLegacy(file.params as Record<string, unknown>, file.name)),
      adapted: true,
    };
  throw new Error('В файле нет пресета.');
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
    motion: { ...DEFAULT_LOOK.motion },
  });
}
