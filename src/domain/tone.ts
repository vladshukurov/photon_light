import { hexToSrgb, srgbToLinear } from './color';

/*
  JS-копия тонального конвейера composite.frag: ACES fitted (Hill) и трим
  насыщенности. Нужна для обратной задачи светлой комнаты — какой общий свет
  даст на выходе ровно цвет гайда #C7CBD6. Держать кривую в двух местах
  неприятно, но читать кадр с GPU ради одной константы — хуже.
*/

const ACES_IN = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
const ACES_OUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];

type Vec3 = [number, number, number];
const mul = (m: number[][], v: number[]): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
export const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const fit = (x: number) =>
  (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081);

export function aces(c: number[]): Vec3 {
  const o = mul(ACES_OUT, mul(ACES_IN, c).map(fit));
  return o.map((v) => Math.min(1, Math.max(0, v))) as Vec3;
}

/** Обратная к ACES. Кривая монотонна по каналам — покомпонентная итерация сходится до 1e-6. */
export function acesInverse(target: number[]): Vec3 {
  let x = [...target] as Vec3;
  for (let i = 0; i < 60; i++) {
    const a = aces(x);
    x = x.map((v, j) => (v * (target[j] + 1e-6)) / (a[j] + 1e-6)) as Vec3;
  }
  return x;
}

/** Обратная к триму насыщенности composite.frag (трим не меняет яркость). */
export function trimInverse(target: number[], saturation: number): Vec3 {
  const L = luma(target);
  const t = Math.min(1, Math.max(0, (L - 0.7) / 0.3));
  const s = 1 + (saturation - 1) * (1 - t * t * (3 - 2 * t));
  return target.map((v) => Math.max(0, L + (v - L) / s)) as Vec3;
}

export const linear = (hex: string) => srgbToLinear(hexToSrgb(hex)) as Vec3;

/**
 * Общий свет, при котором стена с альбедо `wallHex` выходит после тонмапа
 * ровно цветом `floorHex`. Возвращает линейный ambient (покомпонентно).
 */
export function solveAmbient(floorHex: string, wallHex: string, saturation: number): Vec3 {
  const radiance = acesInverse(trimInverse(linear(floorHex), saturation));
  const albedo = linear(wallHex);
  return radiance.map((v, i) => v / Math.max(albedo[i], 1e-4)) as Vec3;
}
