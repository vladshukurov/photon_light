import { useCallback, useEffect, useReducer, useState } from 'react';
import { historyReducer, initialHistory, persistLook, restoreLook } from '../domain/history';
import type { Look } from '../domain/look';

/*
  Проход света пока скрыт из интерфейса: модель и JSON его хранят, но включить
  его нечем. Поэтому всё, что приходит в редактор, — с выключенным движением,
  иначе старый пресет запустил бы проход, который нельзя остановить.
*/
const still = (look: Look): Look =>
  look.motion.enabled ? { ...look, motion: { ...look.motion, enabled: false } } : look;

/** Look с историей и автосохранением в localStorage. */
export function useLook() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () =>
    initialHistory(still(restoreLook())),
  );
  const [saved, setSaved] = useState(true);

  const set = useCallback(
    (next: Look, group?: string) =>
      dispatch({ type: 'set', next: still(next), group, now: Date.now() }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        persistLook(history.present);
        setSaved(true);
      } catch {
        setSaved(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [history.present]);

  return {
    look: history.present,
    set,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    saved,
  };
}
