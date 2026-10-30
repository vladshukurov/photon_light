/**
 * Сабренды из гайда VK (Figma «Брендовые цвета», 12661:8454, 8243, 8330, 14260:20990).
 *
 * Лампа у всех почти белая. Цвет бренда — в отливе: это свет, отражённый
 * цветной стеной за кадром, широкий и без своего пятна (рефы арт-директора,
 * «Инструмент света | Чек», 16719:77651). У сабрендов отлив — светлый край
 * акцентного градиента гайда (Музыка #F89CFF, Видео #FF7B95, Донат #B983FF).
 * У основного VK две версии: ч/б (вместо отлива — слабый белый ореол луча) и
 * с лёгким синим отливом.
 * Фон комнаты у всех брендов один и тот же.
 */
export const BRANDS = [
  { id: 'vk', label: 'VK', accent: '#C0C5FF' },
  { id: 'music', label: 'Музыка', accent: '#F89CFF' },
  { id: 'video', label: 'Видео', accent: '#FF7B95' },
  { id: 'donut', label: 'Донат', accent: '#B983FF' },
] as const;

export type BrandId = (typeof BRANDS)[number]['id'];
export type Brand = (typeof BRANDS)[number];

/** Светлая комната: стена, которую освещают, и то, чем выходит неосвещённая часть. */
export const LIGHT_ROOM = { wall: '#E7E9ED', floor: '#C7CBD6' } as const;

/** Стена тёмной комнаты — нейтральная, чтобы отражённый свет оставался белым. */
export const DARK_WALL = '#1E1E1E';

export const brandById = (id: BrandId): Brand => BRANDS.find((b) => b.id === id) ?? BRANDS[0];
export const isBrand = (value: unknown): value is BrandId => BRANDS.some((b) => b.id === value);
