import { brandById, LIGHT_ROOM } from './brands';
import { angleAt, type Look } from './look';
import { linear, luma, solveAmbient } from './tone';

/*
  Сцена — то, что получает шейдер. Чистая функция от Look, формата и времени.

  Мир: стена — плоскость z = 0, камера ортографическая и смотрит вдоль −Z.
  Короткая сторона кадра равна 1, поэтому одна и та же установка света даёт
  одинаковый масштаб пятна в 16:9, 9:16 и 1:1.
*/

export type Vec3 = [number, number, number];

export interface Scene {
  light: { pos: Vec3; dir: Vec3; coneHalf: number; softness: number; gain: number; radius: number };
  reflex: { pos: Vec3; color: Vec3 };
  albedo: Vec3;
  ambient: Vec3;
  roughness: number;
  haze: { density: number; g: number; depth: number; ext: Vec3; noise: number; noiseScale: number };
  rays: { amount: number; count: number };
  time: number;
  bloom: { intensity: number; threshold: number; radius: number };
  exposure: number;
  saturation: number;
  grain: number;
  vignette: number;
  seed: number;
}

interface CharacterProfile {
  ev: number;
  cone: number;
  haze: number;
  bloom: number;
  threshold: number;
  saturation: number;
}

/*
  Два характера одной и той же установки. «Гайд» откалиброван по шести кадрам
  «Свечение. Направления» (Figma 12661:11136): тёмный кадр, мягкое пятно у края.
  «Выразительный» — тот же свет, но ярче и плотнее: крупнее пятно, читаемый
  объём, сильнее ореол. Геометрия от характера не зависит.
*/
const CHARACTER: Record<Look['character'], { dark: CharacterProfile; light: CharacterProfile }> = {
  guide: {
    dark: { ev: 0.35, cone: 0, haze: 1, bloom: 0.14, threshold: 0.22, saturation: 1.5 },
    light: { ev: 1.3, cone: 0, haze: 0.5, bloom: 0.25, threshold: 0, saturation: 1 },
  },
  vivid: {
    dark: { ev: 1.2, cone: 3, haze: 1.5, bloom: 0.4, threshold: 0.18, saturation: 1.7 },
    light: { ev: 2, cone: 3, haze: 0.9, bloom: 0.35, threshold: 0, saturation: 1.05 },
  },
};

const DEG = Math.PI / 180;
const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

export function frameHalf(aspect: number): [number, number] {
  return aspect >= 1 ? [0.5 * aspect, 0.5] : [0.5, 0.5 / aspect];
}

/*
  Точка на краю кадра в направлении угла. Диагональ сжата по горизонтали
  (0.6): угловые направления гайда стоят на верхнем/нижнем крае примерно в
  пятой части от угла, а не в самом углу — так на эталонах.
*/
export function edgePoint(angleDeg: number, aspect: number): [number, number] {
  const a = angleDeg * DEG;
  const qx = Math.sin(a) * 0.6,
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
const OUT = 0.72;

function sourceXY(angleDeg: number, distance: number, aspect: number): [number, number] {
  const [ex, ey] = edgePoint(angleDeg, aspect);
  const l = Math.hypot(ex, ey) || 1;
  const out = OUT + (distance - 1) * 0.6;
  return [ex + (ex / l) * out, ey + (ey / l) * out];
}

/** Обратное к sourceOnFrame: куда перетащили ручку → угол и отступ. */
export function sourceFromFrame(u: number, v: number, aspect: number) {
  const [hw, hh] = frameHalf(aspect);
  const x = u * hw,
    y = v * hh;
  // угол edgePoint считается в сжатой по x системе — разжимаем
  const angle = (Math.atan2(x / hw / 0.6, y / hh) * 180) / Math.PI;
  const [ex, ey] = edgePoint(angle, aspect);
  const l = Math.hypot(ex, ey) || 1;
  const along = (x * ex + y * ey) / l - l;
  const distance = 1 + (along - OUT) / 0.6;
  return { angle, distance: Math.min(2, Math.max(0.2, distance)) };
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
  const profile = CHARACTER[look.character][look.room];
  const angle = angleAt(look, opts.progress ?? 0);

  const [sx, sy] = sourceXY(angle, look.distance, aspect);
  const height = 0.43;
  const pos: Vec3 = [sx, sy, height];
  const r = Math.hypot(sx, sy) || 1;
  // Ось луча — чуть дальше центра кадра: свет идёт через кадр, а не в него.
  const target: Vec3 = [(-sx / r) * 0.22, (-sy / r) * 0.22, 0];
  const dir = normalize([target[0] - sx, target[1] - sy, target[2] - height]);

  const coneDeg = 9 + look.spread * 18 + profile.cone;
  const gain = Math.pow(2, (dark ? 3.55 : 3.1) + profile.ev + look.brightness * 1.6);

  // Рефлекс: свет, отразившийся от брендового предмета сбоку от кадра.
  const ra = (angle + 115) * DEG;
  const reflexPos: Vec3 = [Math.sin(ra) * 1.6, Math.cos(ra) * 1.4, 0.6];
  const baseGain = Math.pow(2, dark ? 3.55 : 3.1);
  const reflexColor = scale(linear(brand.accent), look.reflex * baseGain * (dark ? 0.035 : 0.012));

  const saturation = profile.saturation;
  const wall = dark ? brand.wall : LIGHT_ROOM.wall;
  const albedo = linear(wall);
  const ambient: Vec3 = dark ? [0, 0, 0] : solveAmbient(LIGHT_ROOM.floor, wall, saturation);

  // Цвет среды: свет, прошедший сквозь неё, уходит в её цвет. Белая — не красит.
  const medium = linear(brand.medium);
  const mMax = Math.max(...medium, 1e-4);
  const tint = dark ? 0.9 : 0.35;
  const ext = medium.map((v) => 1 + tint * (1 - v / mMax)) as Vec3;

  const floorLuma = luma(albedo.map((a, i) => a * ambient[i]));

  return {
    light: {
      pos,
      dir,
      coneHalf: coneDeg * DEG,
      softness: 0.35 + look.softness * 0.65,
      gain,
      radius: 0.12,
    },
    reflex: { pos: reflexPos, color: reflexColor },
    albedo,
    ambient,
    roughness: 0.75,
    haze: {
      density: (0.03 + look.haze * 0.24) * profile.haze,
      g: 0.5,
      depth: 2.4,
      ext,
      noise: 0.18 + look.rays * 0.15,
      noiseScale: 1.7,
    },
    rays: { amount: look.rays, count: look.rayCount },
    time: opts.time ?? 0,
    bloom: {
      intensity: profile.bloom,
      threshold: dark ? profile.threshold : Math.max(0.5, floorLuma * 2.2),
      radius: 0.6,
    },
    exposure: 1,
    saturation,
    grain: look.grain * (dark ? 0.016 : 0.009),
    vignette: dark ? 0.28 : 0.15,
    seed: 17,
  };
}
