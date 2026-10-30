import { brandById, DARK_WALL, LIGHT_ROOM } from './brands';
import { angleAt, wrapAngle, type Look } from './look';
import { linear, luma, solveAmbient } from './tone';

/*
  Сцена — то, что получает шейдер. Чистая функция от Look, формата и времени.

  Мир: стена — плоскость z = 0, камера ортографическая и смотрит вдоль −Z.
  Короткая сторона кадра равна 1, поэтому одна и та же установка света даёт
  одинаковый масштаб пятна в 16:9, 9:16 и 1:1.
*/

export type Vec3 = [number, number, number];

export interface Lamp {
  pos: Vec3;
  dir: Vec3;
  color: Vec3;
  coneHalf: number;
  softness: number;
  gain: number;
  radius: number;
  /** Затухание по пути, на короткую сторону кадра. */
  decay: number;
}

export interface Scene {
  /** Лампа — почти белая, узкая. */
  light: Lamp;
  /** Отлив — свет лампы, отражённый цветной стеной за кадром; в ч/б — слабый белый ореол луча. */
  bounce: Lamp;
  albedo: Vec3;
  ambient: Vec3;
  roughness: number;
  haze: { density: number; g: number; depth: number; noise: number; noiseScale: number };
  rays: { amount: number; count: number };
  /** Надпись — поверхность на стене, освещённая той же лампой. */
  text: { content: string; size: number; glow: number };
  time: number;
  bloom: { intensity: number; threshold: number; radius: number };
  exposure: number;
  saturation: number;
  grain: number;
  vignette: number;
  seed: number;
}

interface Profile {
  ev: number;
  cone: number;
  haze: number;
  bloom: number;
  threshold: number;
  saturation: number;
}

/*
  Выразительность — одна ось между двумя калибровками одной и той же установки.
  0 — «как в гайде»: по шести кадрам «Свечение. Направления» (Figma 12661:11136),
  тёмный кадр и мягкое пятно у края; тёмная комната сверена ещё и с баннерами
  арт-директора (docs/references/ad-vk-*). 1 — тот же свет ярче и плотнее: крупнее
  пятно, читаемый объём, сильнее ореол. Между ними — линейная смесь; геометрия
  от выразительности не зависит.
*/
const PROFILES: Record<Look['room'], [guide: Profile, vivid: Profile]> = {
  dark: [
    { ev: -0.8, cone: 1, haze: 1, bloom: 0.14, threshold: 0.22, saturation: 1.5 },
    { ev: 0.05, cone: 3, haze: 1.5, bloom: 0.4, threshold: 0.18, saturation: 1.7 },
  ],
  light: [
    { ev: 2.0, cone: 1, haze: 0.8, bloom: 0.2, threshold: 0, saturation: 1 },
    { ev: 2.7, cone: 3, haze: 1.3, bloom: 0.3, threshold: 0, saturation: 1.05 },
  ],
};

function profileAt(room: Look['room'], t: number): Profile {
  const [a, b] = PROFILES[room];
  const mix = (k: keyof Profile) => a[k] + (b[k] - a[k]) * t;
  return {
    ev: mix('ev'),
    cone: mix('cone'),
    haze: mix('haze'),
    bloom: mix('bloom'),
    threshold: mix('threshold'),
    saturation: mix('saturation'),
  };
}

/*
  Установка — одна на все направления, форматы и бренды. Подобрана по кадрам
  гайда «Свечение. Направления» и рефам арт-директора (docs/references/ad-*):
  источник за краем почти не читается, пятна нет — есть заход света.
*/
const RIG = {
  /** Высота лампы над стеной. */
  height: 0.1,
  /** Куда ось падает на стену: на столько коротких сторон вглубь от края. */
  reach: 0.6,
  /** Размер излучателя: чем больше, тем мягче заход света у края. */
  radius: 0.08,
  /** Затухание по пути: свет — компактное свечение у края, а не заливка кадра. */
  decay: 0.5,
  ev: 3.55,
  evLight: 3.1,
  /** Сколько цвета бренда в самой лампе: ядро остаётся почти белым. */
  keyTint: 0.4,
  /** Без отлива лампа ярче — так на ч/б рефе: свет не уходит в цветную стену. */
  monoEv: 1.2,
  /**
   * Ореол луча: широкий мягкий свет по той же оси с центром во входе луча —
   * как большие размытые клинья в макете. В цветных версиях это отлив цветной
   * стены и он заметный (gain), в ч/б — слабый белый (monoGain).
   */
  bounce: {
    out: 0.8,
    height: 0.45,
    reach: 0.8,
    radius: 0.2,
    cone: 16,
    gain: 0.5,
    monoGain: 0.015,
    decay: 0.3,
  },
};

/** Цвет света, нормированный по яркости: окраска не меняет экспозицию. */
function tint(hex: string, amount: number): Vec3 {
  const c = linear(hex).map((v) => 1 - amount + amount * v);
  const l = Math.max(luma(c), 1e-4);
  return c.map((v) => v / l) as Vec3;
}

const DEG = Math.PI / 180;
const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function frameHalf(aspect: number): [number, number] {
  return aspect >= 1 ? [0.5 * aspect, 0.5] : [0.5, 0.5 / aspect];
}

/*
  Точка на краю кадра в направлении угла. Диагональ сжата по горизонтали
  (DIAG): угловые направления гайда стоят на верхнем/нижнем крае, а не в
  самом углу — заход света на эталонах в пятой части ширины от угла.
*/
const DIAG = 0.55;

export function edgePoint(angleDeg: number, aspect: number): [number, number] {
  const a = angleDeg * DEG;
  const qx = Math.sin(a) * DIAG,
    qy = Math.cos(a);
  const m = Math.max(Math.abs(qx), Math.abs(qy), 1e-6);
  const [hw, hh] = frameHalf(aspect);
  return [(qx / m) * hw, (qy / m) * hh];
}

/** Проекция источника на плоскость кадра в долях [-1, 1] — для ручки на холсте. */
export function sourceOnFrame(
  angleDeg: number,
  distance: number,
  aspect: number,
): [number, number] {
  const [x, y] = sourceXY(angleDeg, distance, aspect);
  const [hw, hh] = frameHalf(aspect);
  return [x / hw, y / hh];
}

/** Насколько источник по умолчанию стоит за краем кадра (в коротких сторонах). */
const OUT = 0.5;
/** Наклон оси луча к центру кадра: 0 — строго по нормали к краю, 1 — к центру. */
const TILT = 0.65;

/*
  Нормаль к краю в точке (ex, ey), с наклоном к центру кадра на долю tilt.

  Источник стоит над точкой на краю строго по нормали: на кадрах гайда угловой
  свет приходит из-за верхнего края в пятой части от угла, а не из самого
  угла. Ось луча наклонена к центру — свет падает в кадр круто и чуть внутрь.
  Нормаль берётся у скруглённого прямоугольника: на ребре она перпендикулярна
  ему, в углу — диагональ, поэтому при переходе через угол ничего не прыгает.
*/
function outward(ex: number, ey: number, aspect: number, tilt = 0): [number, number] {
  const [hw, hh] = frameHalf(aspect);
  const p = 7;
  const nx = (Math.sign(ex) * Math.abs(ex / hw) ** p) / hw;
  const ny = (Math.sign(ey) * Math.abs(ey / hh) ** p) / hh;
  const nl = Math.hypot(nx, ny) || 1;
  const l = Math.hypot(ex, ey) || 1;
  const x = (nx / nl) * (1 - tilt) + (ex / l) * tilt;
  const y = (ny / nl) * (1 - tilt) + (ey / l) * tilt;
  const m = Math.hypot(x, y) || 1;
  return [x / m, y / m];
}

/** Сколько отступа даёт ползунок: от 0.2 до 2 — источник от края и до вдвое дальше. */
const SPAN = 0.28;
const outOf = (distance: number) => OUT + (distance - 1) * SPAN;

function sourceXY(angleDeg: number, distance: number, aspect: number): [number, number] {
  const [ex, ey] = edgePoint(angleDeg, aspect);
  const [nx, ny] = outward(ex, ey, aspect, TILT);
  const out = outOf(distance);
  return [ex + nx * out, ey + ny * out];
}

/*
  Обратное к sourceOnFrame: куда перетащили ручку → угол и отступ.
  Источник лежит на луче «точка на краю + нормаль», поэтому ищется угол, при
  котором ручка оказывается на этом луче: перебор по кругу и бисекция.
  Из нескольких решений берётся ближайшее к простому радиальному.
*/
export function sourceFromFrame(u: number, v: number, aspect: number) {
  const [hw, hh] = frameHalf(aspect);
  const x = u * hw,
    y = v * hh;
  const miss = (a: number) => {
    const [ex, ey] = edgePoint(a, aspect);
    const [nx, ny] = outward(ex, ey, aspect, TILT);
    return { side: nx * (y - ey) - ny * (x - ex), along: nx * (x - ex) + ny * (y - ey) };
  };
  // угол edgePoint считается в сжатой по x системе — разжимаем
  const guess = (Math.atan2(x / hw / DIAG, y / hh) * 180) / Math.PI;
  let angle = guess;
  let best = Infinity;
  const N = 360;
  for (let i = 0; i < N; i++) {
    let a0 = -180 + (360 * i) / N,
      a1 = a0 + 360 / N;
    let f0 = miss(a0).side;
    if (Math.sign(f0) === Math.sign(miss(a1).side)) continue;
    for (let k = 0; k < 40; k++) {
      const am = (a0 + a1) / 2,
        fm = miss(am).side;
      if (Math.sign(fm) === Math.sign(f0)) {
        a0 = am;
        f0 = fm;
      } else a1 = am;
    }
    const a = (a0 + a1) / 2;
    if (miss(a).along < 0) continue;
    const off = Math.abs(wrapAngle(a - guess));
    if (off < best) {
      best = off;
      angle = a;
    }
  }
  const distance = 1 + (miss(angle).along - OUT) / SPAN;
  return { angle: wrapAngle(angle), distance: Math.min(2, Math.max(0.2, distance)) };
}

export interface SceneOptions {
  /** Доля прохода света, 0…1. Без движения не используется. */
  progress?: number;
  /** Секунды для течения дымки и дрейфа лучей; 0 — кадр застыл. */
  time?: number;
}

export function buildScene(look: Look, aspect: number, opts: SceneOptions = {}): Scene {
  const brand = brandById(look.brand);
  const dark = look.room === 'dark';
  const profile = profileAt(look.room, look.expression);
  const angle = angleAt(look, opts.progress ?? 0);

  const [ex, ey] = edgePoint(angle, aspect);
  const [ax, ay] = outward(ex, ey, aspect, TILT);
  const [nx, ny] = [ax, ay];
  const out = outOf(look.distance);
  // Лампа стоит за краем и светит вскользь: ось падает на стену глубоко
  // в кадре, поэтому у края — мягкий заход света, а не горячая точка.
  const pos: Vec3 = [ex + nx * out, ey + ny * out, RIG.height];
  const aim = (lamp: Vec3, reach: number): Vec3 =>
    normalize([ex - ax * reach - lamp[0], ey - ay * reach - lamp[1], -lamp[2]]);
  const dir = aim(pos, RIG.reach);

  const coneDeg = 4 + look.spread * 12 + profile.cone;

  const saturation = profile.saturation;
  const wall = dark ? DARK_WALL : LIGHT_ROOM.wall;
  const albedo = linear(wall);
  const ambient: Vec3 = dark ? [0, 0, 0] : solveAmbient(LIGHT_ROOM.floor, wall, saturation);

  // Цвет бренда: у VK — только в синей версии, у сабрендов — всегда.
  const colored = brand.id !== 'vk' || look.tone === 'blue';
  const ev = (dark ? RIG.ev : RIG.evLight) + profile.ev + look.brightness * 1.6;
  const gain = Math.pow(2, ev + (colored ? 0 : RIG.monoEv));
  const b = RIG.bounce;
  // Отлив — широкий мягкий луч по той же оси с центром во входе луча, как
  // фоновое свечение синего баннера; дальше по оси он съехал бы вбок пятном.
  const bPos: Vec3 = [ex + nx * b.out, ey + ny * b.out, b.height];
  const bounce: Lamp = {
    pos: bPos,
    dir: aim(bPos, b.reach),
    color: tint(brand.accent, colored ? 1 : 0),
    coneHalf: b.cone * DEG,
    softness: 1,
    gain: gain * (colored ? b.gain : b.monoGain),
    radius: b.radius,
    decay: b.decay,
  };

  const floorLuma = luma(albedo.map((a, i) => a * ambient[i]));

  return {
    light: {
      pos,
      dir,
      color: tint(brand.accent, colored ? RIG.keyTint : 0),
      coneHalf: coneDeg * DEG,
      softness: Math.min(1, 0.6 + look.softness * 0.65),
      gain,
      radius: RIG.radius,
      decay: RIG.decay,
    },
    bounce,
    albedo,
    ambient,
    roughness: 0.75,
    haze: {
      density: (0.03 + look.haze * 0.24) * profile.haze,
      g: 0.5,
      depth: 2.4,
      noise: 0.18 + look.rays * 0.15,
      noiseScale: 1.7,
    },
    rays: { amount: look.rays, count: look.rayCount },
    text: { content: look.text.trim(), size: look.textSize, glow: dark ? 1 : 0 },
    time: opts.time ?? 0,
    bloom: {
      intensity: profile.bloom,
      threshold: dark ? profile.threshold : Math.max(0.5, floorLuma * 2.2),
      radius: 0.6,
    },
    exposure: 1,
    saturation,
    grain: look.grain * (dark ? 0.016 : 0.009),
    vignette: dark ? 0.6 : 0.45,
    seed: 17,
  };
}
