/**
 * Сабренды из гайда VK (Figma «Брендовые цвета», 12661:8454, 8243, 8330, 14260:20990).
 *
 * Сабренды построены на дефолтной установке VK. Цвет бренда — в самом луче,
 * а свечение источника у края почти белое. Цвет света (light) и поправка
 * яркости (ev, в стопах) сняты с баннеров сабрендов (Figma 11977:81878,
 * 11977:81891, 11977:81905): свет там тёмный и приглушённый, а у Видео —
 * холодный синий, а не акцентный розовый. accent — цвет бренда из гайда. Отлив — свет,
 * отражённый цветной стеной за кадром, широкий и без своего пятна (рефы
 * арт-директора, «Инструмент света | Чек», 16719:77651).
 * У основного VK две версии: с лёгким синим отливом (по умолчанию) и ч/б
 * (вместо отлива — слабый белый ореол луча).
 * Фон комнаты у всех брендов один и тот же.
 */
export const BRANDS = [
  { id: 'vk', label: 'VK', accent: '#C0C5FF', light: '#C0C5FF', ev: 0 },
  { id: 'music', label: 'Музыка', accent: '#F89CFF', light: '#FF75F0', ev: -0.9 },
  { id: 'video', label: 'Видео', accent: '#FF7B95', light: '#7D96FF', ev: -1.3 },
  { id: 'donut', label: 'Донат', accent: '#B983FF', light: '#CE80FF', ev: -0.65 },
] as const;

export type BrandId = (typeof BRANDS)[number]['id'];
export type Brand = (typeof BRANDS)[number];

/** Светлая комната: стена, которую освещают, и то, чем выходит неосвещённая часть. */
export const LIGHT_ROOM = { wall: '#E7E9ED', floor: '#C7CBD6' } as const;

/** Стена тёмной комнаты — нейтральная, чтобы отражённый свет оставался белым. */
export const DARK_WALL = '#1E1E1E';

export const brandById = (id: BrandId): Brand => BRANDS.find((b) => b.id === id) ?? BRANDS[0];
export const isBrand = (value: unknown): value is BrandId => BRANDS.some((b) => b.id === value);
