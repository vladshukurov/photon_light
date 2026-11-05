import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, Check, Clapperboard, LoaderCircle, Square } from 'lucide-react';
import { Segmented, Toggle } from './controls';
import { LiveThumb } from './LiveThumb';
import type { Look } from '../domain/look';
import { videoPresets, type VideoSettings } from '../domain/exportSettings';
import { download } from '../engine/export';
import { renderVideo } from '../engine/video';

type Result = { key: string; url: string; blob: Blob; ext: string; offline: boolean };
type Progress = { done: number; frame: number; total: number; left: number };

const fileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
const clock = (s: number) =>
  s < 60 ? `${Math.max(1, Math.round(s))} с` : `${Math.floor(s / 60)} мин ${Math.round(s % 60)} с`;

/**
 * Вкладка «Видео» окна экспорта: превью готового ролика слева, параметры и
 * запись справа. Длина ролика берётся из движения света, а без движения —
 * выбирается здесь: тогда в кадре живут только дымка и лучи.
 */
export function VideoExport({
  look,
  video,
  onChange,
  kindSwitch,
  onBusyChange,
}: {
  look: Look;
  video: VideoSettings;
  onChange: (patch: Partial<VideoSettings>) => void;
  kindSwitch: ReactNode;
  onBusyChange: (busy: boolean) => void;
}) {
  const presets = videoPresets(look);
  const chosen = presets.find((p) => p.id === video.preset) ?? presets[1];
  const { width, height } = chosen;
  const motion = look.motion.enabled;
  const seconds = motion ? look.motion.duration : video.seconds;
  const key = JSON.stringify([look, width, height, video.fps, seconds, video.motionBlur]);

  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const busy = progress !== null;
  const shown = result?.key === key ? result : null;

  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );
  useEffect(() => () => abort.current?.abort(), []);

  const record = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setError('');
    const started = performance.now();
    setProgress({ done: 0, frame: 0, total: 0, left: 0 });
    try {
      await document.fonts.ready;
      const out = await renderVideo(
        look,
        { width, height, seconds, fps: video.fps, motionBlur: video.motionBlur, loop: true },
        controller.signal,
        (done, frame, total) => {
          if (controller.signal.aborted) return;
          const elapsed = (performance.now() - started) / 1000;
          const left = done > 0.02 ? (elapsed / done) * (1 - done) : 0;
          setProgress({ done, frame, total, left });
        },
      );
      setResult({ key, url: URL.createObjectURL(out.blob), ...out });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError(e instanceof Error ? e.message : 'Не удалось записать ролик.');
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setProgress(null);
      }
    }
  };

  const ratio = width / height;
  const thumbW = ratio >= 1 ? 360 : Math.round(360 * ratio);
  const thumbH = ratio >= 1 ? Math.round(360 / ratio) : 360;
  const name = `${look.name} ${width}×${height}`;

  return (
    <>
      <figure className="export-preview">
        <div className="preview-tools">
          <span>{shown ? 'Готовый ролик' : 'Предпросмотр'}</span>
        </div>
        <div className="export-well">
          {shown ? (
            <video
              className="export-thumb"
              src={shown.url}
              autoPlay
              loop
              muted
              playsInline
              aria-label="Готовый ролик"
              style={{ aspectRatio: `${width} / ${height}` }}
            />
          ) : (
            <LiveThumb
              look={look}
              width={thumbW}
              height={thumbH}
              className="export-thumb"
              style={{ aspectRatio: `${thumbW} / ${thumbH}` }}
            />
          )}
        </div>
        <figcaption>
          <strong>
            {width} × {height}
          </strong>
          <span>
            {shown?.ext.toUpperCase() ?? 'MP4'} · {video.fps} к/с · {seconds} с
            {shown ? ` · ${fileSize(shown.blob.size)}` : ''}
          </span>
        </figcaption>
        <p className="hint">
          {motion
            ? 'Живой свет: прибор стоит, сквозь луч тянет дым. Ролик зациклен без шва.'
            : 'Свет стоит, дымка и лучи едва текут. Ролик зациклен: конец переходит в начало без шва.'}
        </p>
      </figure>
      <div className="export-side">
        <fieldset className="export-form" disabled={busy}>
          <legend className="sr-only">Параметры видео</legend>
          {kindSwitch}
          <div className="field">
            <span className="field-label">Размер</span>
            <div className="export-sizes three" role="group" aria-label="Размер ролика">
              {presets.map((p) => (
                <button
                  key={p.id}
                  aria-pressed={chosen.id === p.id}
                  onClick={() => onChange({ preset: p.id })}
                >
                  <strong>{p.label}</strong>
                  <small>
                    {p.width} × {p.height}
                  </small>
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label">Частота кадров</span>
            <Segmented
              label="Частота кадров"
              value={String(video.fps) as '24' | '30' | '60'}
              options={[
                { id: '24', label: '24' },
                { id: '30', label: '30' },
                { id: '60', label: '60' },
              ]}
              onChange={(fps) => onChange({ fps: Number(fps) as 24 | 30 | 60 })}
            />
          </div>
          <div className="field">
            <span className="field-label">Длина</span>
            {motion ? (
              <p className="video-length">
                <strong>{seconds} с</strong>
                <span>петля · задаётся в «Живом свете»</span>
              </p>
            ) : (
              <Segmented
                label="Длина ролика"
                value={String(video.seconds) as '5' | '10' | '15'}
                options={[
                  { id: '5', label: '5 с' },
                  { id: '10', label: '10 с' },
                  { id: '15', label: '15 с' },
                ]}
                onChange={(s) => onChange({ seconds: Number(s) as 5 | 10 | 15 })}
              />
            )}
          </div>
          <div className="toggle-row">
            <span>
              <strong>Размытие движения</strong>
              <small>Как у камеры: мягкий след за светом. Запись дольше.</small>
            </span>
            <Toggle
              label="Размытие движения"
              checked={video.motionBlur}
              onChange={(motionBlur) => onChange({ motionBlur })}
            />
          </div>
        </fieldset>
        {progress && (
          <div className="export-progress" role="status">
            <progress value={progress.done} max={1} />
            <span>
              {progress.total
                ? `Кадр ${progress.frame} из ${progress.total}${progress.left ? ` · ещё ≈ ${clock(progress.left)}` : ''}`
                : 'Готовим запись…'}
            </span>
          </div>
        )}
        {error && (
          <p role="alert" className="message error">
            {error}
          </p>
        )}
        {shown && !busy && (
          <p role="status" className="message success">
            <Check size={15} />
            Ролик готов{shown.offline ? '' : ' — записан в реальном времени'}
          </p>
        )}
        <div className="export-actions">
          {busy ? (
            <button
              className="button wide"
              onClick={() => {
                // Окно отпускает сразу: дорисовывать кадр, который всё равно
                // выбросим, незачем ждать.
                abort.current?.abort();
                abort.current = null;
                setProgress(null);
              }}
            >
              <Square size={13} fill="currentColor" />
              Остановить
            </button>
          ) : shown ? (
            <button
              className="button primary wide"
              onClick={() => download(shown.blob, `${name}.${shown.ext}`)}
            >
              <ArrowDownToLine size={15} />
              Скачать {shown.ext.toUpperCase()}
            </button>
          ) : (
            <button className="button primary wide" onClick={() => void record()}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <Clapperboard size={15} />}
              Записать ролик
            </button>
          )}
        </div>
      </div>
    </>
  );
}
