/**
 * Сабренды из гайда VK (Figma «Брендовые цвета», 12661:8454, 8243, 8330, 14260:20990).
 *
 * У основного VK свет чисто белый. У сабрендов свет окрашен в светлый край
 * акцентного градиента гайда (Музыка #F89CFF, Видео #FF7B95, Донат #B983FF):
 * ядро остаётся почти белым — его выжигает экспозиция, — а цвет проявляется
 * в спаде и в дымке. Фон комнаты у всех брендов один и тот же.
 */
export const BRANDS = [
  { id: 'vk', label: 'VK', light: '#FFFFFF' },
  { id: 'music', label: 'Музыка', light: '#F89CFF' },
  { id: 'video', label: 'Видео', light: '#FF7B95' },
  { id: 'donut', label: 'Донат', light: '#B983FF' },
] as const;

export type BrandId = (typeof BRANDS)[number]['id'];
export type Brand = (typeof BRANDS)[number];

/** Светлая комната: стена, которую освещают, и то, чем выходит неосвещённая часть. */
export const LIGHT_ROOM = { wall: '#E7E9ED', floor: '#C7CBD6' } as const;

/** Стена тёмной комнаты — нейтральная, чтобы отражённый свет оставался белым. */
export const DARK_WALL = '#1E1E1E';

export const brandById = (id: BrandId): Brand => BRANDS.find((b) => b.id === id) ?? BRANDS[0];
export const isBrand = (value: unknown): value is BrandId => BRANDS.some((b) => b.id === value);
