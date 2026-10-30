import { useEffect, useRef, type CSSProperties } from 'react';
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
  }, [key, width, height]);
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
