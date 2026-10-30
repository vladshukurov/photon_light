import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { buildScene } from '../domain/scene';
import type { Look } from '../domain/look';
import { drawThumb } from '../engine/thumbs';

/**
 * Настоящий кадр сцены в миниатюре. Перерисовывается с задержкой после
 * последней правки, чтобы протяжка ползунка не тормозила основной холст.
 */
export function LiveThumb({
  look,
  width,
  height,
  className,
  style,
}: {
  look: Look;
  width: number;
  height: number;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Шрифт надписи мог догрузиться после первой отрисовки — тогда перерисовать.
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    const bump = () => setFontTick((t) => t + 1);
    document.fonts?.addEventListener('loadingdone', bump);
    return () => document.fonts?.removeEventListener('loadingdone', bump);
  }, []);
  const key = JSON.stringify({ ...look, name: '', motion: null, width: 0, height: 0 });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const timer = window.setTimeout(() => {
      const still = { ...look, motion: { ...look.motion, enabled: false } };
      drawThumb(buildScene(still, width / height), canvas);
    }, 140);
    return () => clearTimeout(timer);
    // key покрывает все поля look, которые влияют на кадр
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, width, height, fontTick]);
  return (
    <canvas
      ref={ref}
      className={className}
      style={style}
      width={width}
      height={height}
      aria-hidden="true"
    />
  );
}
