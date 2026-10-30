import { useCallback, useEffect, useReducer, useState } from 'react';
import { historyReducer, initialHistory, persistLook, restoreLook } from '../domain/history';
import type { Look } from '../domain/look';

/** Look с историей и автосохранением в localStorage. */
export function useLook() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () =>
    initialHistory(restoreLook()),
  );
  const [saved, setSaved] = useState(true);

  const set = useCallback(
    (next: Look, group?: string) => dispatch({ type: 'set', next, group, now: Date.now() }),
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
