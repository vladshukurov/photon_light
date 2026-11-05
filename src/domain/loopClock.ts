/*
  Где сейчас живой свет в своей петле, в секундах.

  Обновляется каждый кадр, поэтому живёт вне React: превью пишет сюда, а
  плеер в панели двигает ползунок и часы напрямую, без перерисовки панелей.
*/
type Listener = (time: number) => void;

let current = 0;
const listeners = new Set<Listener>();

export function setLoopClock(time: number) {
  if (time === current) return;
  current = time;
  listeners.forEach((l) => l(time));
}

/** Подписка на время петли; сразу получает текущее значение. Возвращает отписку. */
export function onLoopClock(listener: Listener) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
