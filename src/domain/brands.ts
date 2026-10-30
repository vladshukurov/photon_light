/**
 * Сабренды из гайда VK (Figma «Брендовые цвета», 12661:8454, 8243, 8330, 14260:20990).
 *
 * Фотон всегда белый. Бренд меняет то, от чего свет отражается:
 *  - wall   — цвет стены тёмной комнаты (середина градиента «чёрный → бренд → чёрный»);
 *  - medium — цвет среды, в который уходит свет по мере пути сквозь дымку;
 * Светлая комната у всех брендов общая (#C7CBD6 → #E7E9ED → #BCC0CE).
 */
export const BRANDS = [
  {
    id: 'vk',
    label: 'VK',
    wall: '#161C38',
    medium: '#D2DAFF',
    swatch: ['#000000', '#1B2238', '#000000'],
  },
  {
    id: 'music',
    label: 'Музыка',
    wall: '#270C2B',
    medium: '#F89CFF',
    swatch: ['#000000', '#270C2B', '#000000'],
  },
  {
    id: 'video',
    label: 'Видео',
    wall: '#111833',
    medium: '#C9D2FF',
    swatch: ['#000000', '#111833', '#000000'],
  },
  {
    id: 'donut',
    label: 'Донат',
    wall: '#221133',
    medium: '#B983FF',
    swatch: ['#000000', '#221133', '#000000'],
  },
] as const;

export type BrandId = (typeof BRANDS)[number]['id'];
export type Brand = (typeof BRANDS)[number];

/** Светлая комната: стена, которую освещают, и то, чем выходит неосвещённая часть. */
export const LIGHT_ROOM = { wall: '#E7E9ED', floor: '#C7CBD6' } as const;

export const brandById = (id: BrandId): Brand => BRANDS.find((b) => b.id === id) ?? BRANDS[0];
export const isBrand = (value: unknown): value is BrandId => BRANDS.some((b) => b.id === value);
