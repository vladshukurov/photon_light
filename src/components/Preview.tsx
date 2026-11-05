import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent,
  type CSSProperties,
} from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Renderer } from '../engine/renderer';
import { exportImage, exportLayers, type Layer } from '../engine/export';
import { loopTime, type Look } from '../domain/look';
import { buildScene, sourceFromFrame, sourceOnFrame } from '../domain/scene';
import { setLoopClock } from '../domain/loopClock';

export interface PreviewHandle {
  image: (format: 'png' | 'jpg', width: number, height: number, quality?: number) => Promise<Blob>;
  layers: (
    width: number,
    height: number,
  ) => Promise<{ layers: Layer[]; clipped: boolean; composite: Blob }>;
  /** Перейти к моменту петли живого света и встать на паузу. */
  seek: (time: number) => void;
}

interface Props {
  look: Look;
  /** Время идёт: дымка и лучи текут, в живом свете — в полную силу. */
  playing: boolean;
  onSourceChange: (angle: number, distance: number, group: string) => void;
  onReady: (ready: boolean) => void;
}

const MAX_W = 1600,
  MAX_H = 1100,
  SETTLE_FRAMES = 8;

export const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  { look, playing, onSourceChange, onReady },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    areaRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  // Время сцены. На паузе кадр статичен и после сходимости не тратит кадры.
  const live = useRef({ look, playing, time: 0 });
  const invalidateRef = useRef<() => void>(() => {});
  const readyRef = useRef(onReady);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState(''),
    [generation, setGeneration] = useState(0),
    [loading, setLoading] = useState(true),
    [dragging, setDragging] = useState(false);

  const aspect = look.width / look.height;

  useEffect(() => {
    readyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    live.current.look = look;
    live.current.playing = playing;
    invalidateRef.current();
  }, [look, playing]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.max(64, entry.contentRect.width),
        h = Math.max(64, entry.contentRect.height);
      const width = Math.floor(Math.min(w, h * aspect));
      setSize({ width, height: Math.floor(width / aspect) });
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [aspect]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const k = Math.min(1, MAX_W / (size.width * dpr), MAX_H / (size.height * dpr));
    canvas.width = Math.max(1, Math.round(size.width * dpr * k));
    canvas.height = Math.max(1, Math.round(size.height * dpr * k));
    invalidateRef.current();
  }, [size, generation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: Renderer | null = null,
      raf = 0,
      frames = 0,
      last = 0,
      disposed = false,
      lost = false;

    const fail = (e: unknown) => {
      if (disposed) return;
      setError(e instanceof Error ? e.message : 'Не удалось отрисовать сцену.');
      setLoading(false);
      readyRef.current(false);
    };

    const draw = (now: number) => {
      raf = 0;
      if (disposed || lost || document.hidden || !renderer || canvas.width < 2) return;
      const { look: l, playing: p } = live.current;
      // Шаг времени — по реальным часам, но не больше 0.25 с: на медленной
      // видеокарте ход не превращается в слоу-мо, а после паузы вкладки свет
      // не перескакивает.
      if (p) live.current.time += Math.min((now - (last || now)) / 1000, 0.25);
      last = p ? now : 0;
      const t = live.current.time;
      try {
        const scene = buildScene(l, canvas.width / canvas.height, { time: t });
        // На ходу кадр копится скользящим средним: шум марша уходит, а
        // движение получает лёгкий шлейф, как выдержка камеры.
        renderer.render(scene, canvas.width, canvas.height, {
          hazeSteps: p ? 48 : 72,
          frame: frames,
          alpha: p ? Math.max(0.35, 1 / (frames + 1)) : 1 / (frames + 1),
        });
        frames++;
        if (frames === 1) setLoading(false);
        setLoopClock(l.motion.enabled ? loopTime(l.motion, t) : 0);
        if (p || frames < SETTLE_FRAMES) raf = requestAnimationFrame(draw);
      } catch (e) {
        fail(e);
      }
    };

    const invalidate = () => {
      frames = 0;
      last = 0;
      if (!raf && !disposed && !lost) raf = requestAnimationFrame(draw);
    };
    invalidateRef.current = invalidate;

    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      cancelAnimationFrame(raf);
      raf = 0;
      fail(new Error('Связь с видеокартой потеряна. Восстановите сцену — настройки сохранены.'));
    };
    const onRestored = () => {
      if (!disposed) {
        setError('');
        setGeneration((g) => g + 1);
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else invalidate();
    };
    // Шрифт надписи может догрузиться после первого кадра — тогда маска пересобирается.
    document.fonts?.addEventListener('loadingdone', invalidate);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    document.addEventListener('visibilitychange', onVisibility);
    try {
      renderer = new Renderer(canvas);
      renderer.init();
      rendererRef.current = renderer;
      readyRef.current(true);
      invalidate();
    } catch (e) {
      renderer?.dispose();
      fail(e);
    }
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      invalidateRef.current = () => {};
      document.fonts?.removeEventListener('loadingdone', invalidate);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      document.removeEventListener('visibilitychange', onVisibility);
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, [generation]);

  useImperativeHandle(ref, () => {
    const current = () => {
      const r = rendererRef.current;
      if (!r || r.gl.isContextLost()) throw new Error('Дождитесь готовности сцены.');
      return r;
    };
    const sceneFor = (w: number, h: number) => {
      const { look: l, time } = live.current;
      return buildScene(l, w / h, { time });
    };
    return {
      async image(format, width, height, quality) {
        try {
          return await exportImage(
            current(),
            sceneFor(width, height),
            width,
            height,
            format,
            quality,
          );
        } finally {
          invalidateRef.current();
        }
      },
      seek(time) {
        live.current.time = time;
        invalidateRef.current();
      },
      async layers(width, height) {
        try {
          return await exportLayers(current(), sceneFor(width, height), width, height);
        } finally {
          invalidateRef.current();
        }
      },
    };
  }, []);

  const moveSource = (e: PointerEvent<HTMLDivElement>, group: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const u = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const v = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const s = sourceFromFrame(u, v, aspect);
    onSourceChange(s.angle, s.distance, group);
  };

  const [hu, hv] = sourceOnFrame(look.angle, look.distance, aspect);
  const inside = Math.abs(hu) <= 1 && Math.abs(hv) <= 1;
  const clampEdge = (x: number) => Math.max(-1, Math.min(1, x));
  const handle = {
    left: `${(clampEdge(hu) * 0.5 + 0.5) * 100}%`,
    top: `${(0.5 - clampEdge(hv) * 0.5) * 100}%`,
  };

  return (
    <div className="preview" style={{ '--aspect': aspect } as CSSProperties}>
      <div ref={areaRef} className="preview-area">
        <div
          className={`canvas-wrap${dragging ? ' dragging' : ''}`}
          style={{ width: size.width, height: size.height }}
        >
          <canvas ref={canvasRef} role="img" aria-label="Превью световой сцены" />
          <div
            className="canvas-hit"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragging(true);
              moveSource(e, 'canvas');
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) moveSource(e, 'canvas');
            }}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
          >
            <span
              className={`source-handle${inside ? '' : ' outside'}`}
              style={handle}
              aria-hidden="true"
            />
          </div>
          {loading && !error && (
            <div className="canvas-state">
              <span className="spinner" />
              Собираем свет…
            </div>
          )}
          {error && (
            <div className="canvas-state error" role="alert">
              <AlertCircle size={22} />
              <strong>Сцене нужна помощь</strong>
              <p>{error}</p>
              <button
                className="button"
                onClick={() => {
                  setError('');
                  setLoading(true);
                  setGeneration((g) => g + 1);
                }}
              >
                <RefreshCw size={14} />
                Восстановить
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
