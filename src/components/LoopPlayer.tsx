import { useEffect, useRef, type PointerEvent } from 'react';
import { Pause, Play } from 'lucide-react';
import { onLoopClock } from '../domain/loopClock';

const seconds = (t: number) => `${t.toFixed(1).replace('.', ',')} с`;

/*
  Плеер живого света: пуск и пауза, петля и время. Ползунок и часы двигаются
  от часов превью напрямую, без перерисовки панели.
*/
export function LoopPlayer({
  duration,
  playing,
  onPlayingChange,
  onSeek,
}: {
  duration: number;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onSeek: (time: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null),
    clock = useRef<HTMLSpanElement>(null),
    now = useRef(0);

  useEffect(
    () =>
      onLoopClock((t) => {
        now.current = t;
        bar.current?.style.setProperty('--progress', String(t / duration));
        if (clock.current) clock.current.textContent = `${seconds(t)} / ${seconds(duration)}`;
      }),
    [duration],
  );

  const seek = (t: number) => {
    onPlayingChange(false);
    // Конец петли — это снова её начало, поэтому встаём на миг раньше.
    onSeek(Math.min(Math.max(t, 0), duration - 0.001));
  };
  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * duration);
  };

  return (
    <div className="loop-player" ref={bar}>
      <button
        className="play-button"
        aria-label={playing ? 'Пауза' : 'Воспроизвести'}
        title={playing ? 'Пауза · Пробел' : 'Пуск · Пробел'}
        onClick={() => onPlayingChange(!playing)}
      >
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </button>
      <div
        className="timeline"
        role="slider"
        aria-label="Время в петле"
        aria-valuemin={0}
        aria-valuemax={duration}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) scrub(e);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 1 : 0.25;
          const t = now.current;
          if (e.key === 'ArrowLeft') seek(t - step);
          else if (e.key === 'ArrowRight') seek(t + step);
          else if (e.key === 'Home') seek(0);
          else if (e.key === 'End') seek(duration);
          else return;
          e.preventDefault();
        }}
      >
        <i />
      </div>
      <span className="transport-clock" ref={clock}>
        0,0 с / {seconds(duration)}
      </span>
    </div>
  );
}
