import { DEFAULT_LOOK, normalizeLook, type Look } from './look';

/*
  Отмена и повтор. Снимки неизменяемы, история ограничена 80 шагами.
  Подряд идущие правки одного поля в пределах 600 мс сливаются в один шаг —
  иначе протяжка ползунка забивает историю сотней промежуточных значений.
*/

export interface History {
  past: Look[];
  present: Look;
  future: Look[];
  lastEdit: number;
  group: string;
}

export type HistoryAction =
  { type: 'set'; next: Look; now: number; group?: string } | { type: 'undo' } | { type: 'redo' };

const LIMIT = 80;
const MERGE_MS = 600;

const same = (a: Look, b: Look) => JSON.stringify(a) === JSON.stringify(b);

export function historyReducer(s: History, a: HistoryAction): History {
  switch (a.type) {
    case 'undo': {
      const previous = s.past.at(-1);
      if (!previous) return s;
      return {
        past: s.past.slice(0, -1),
        present: previous,
        future: [s.present, ...s.future],
        lastEdit: 0,
        group: '',
      };
    }
    case 'redo': {
      const [next, ...rest] = s.future;
      if (!next) return s;
      return { past: [...s.past, s.present], present: next, future: rest, lastEdit: 0, group: '' };
    }
    case 'set': {
      if (same(s.present, a.next)) return s;
      const merge = Boolean(a.group && a.group === s.group && a.now - s.lastEdit < MERGE_MS);
      return {
        past: merge ? s.past : [...s.past, s.present].slice(-LIMIT),
        present: a.next,
        future: [],
        lastEdit: a.now,
        group: a.group ?? '',
      };
    }
  }
}

export const initialHistory = (present: Look): History => ({
  past: [],
  present,
  future: [],
  lastEdit: 0,
  group: '',
});

// --- автосохранение ------------------------------------------------------

/*
  Версия ключа поднимается, когда меняется дефолтный свет и все должны начать
  с него: прежнее автосохранение больше не читается и удаляется. v4 — свет
  направлений гайда (ноябрь 2026). v5 — VK по умолчанию с синим отливом:
  свет из v4 переносится, но версия VK встаёт на новый дефолт — ч/б там было
  просто прежним дефолтом.
*/
export const STORAGE_KEY = 'photon:look:v5';
const PREVIOUS_KEY = 'photon:look:v4';
const LEGACY_KEYS = ['photon:look:v3', PREVIOUS_KEY];

export function restoreLook(
  storage:
    | (Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'removeItem'>>)
    | undefined = globalThis.localStorage,
): Look {
  let previous: string | null | undefined;
  try {
    previous = storage?.getItem(PREVIOUS_KEY);
    for (const key of LEGACY_KEYS) storage?.removeItem?.(key);
  } catch {
    // Хранилище может быть недоступно — это не повод не открыть сцену.
  }
  try {
    const text = storage?.getItem(STORAGE_KEY);
    if (text) return normalizeLook(JSON.parse(text));
    if (previous) return { ...normalizeLook(JSON.parse(previous)), tone: DEFAULT_LOOK.tone };
  } catch {
    // Повреждённые данные не должны мешать открыть чистую сцену.
  }
  return { ...DEFAULT_LOOK, motion: { ...DEFAULT_LOOK.motion } };
}

export function persistLook(look: Look, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(look));
}
