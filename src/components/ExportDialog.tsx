import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowDownToLine,
  Check,
  Copy,
  Film,
  Image,
  Layers,
  LoaderCircle,
  Square,
} from 'lucide-react';
import { Modal } from './Modal';
import { Segmented } from './controls';
import { LiveThumb } from './LiveThumb';
import type { PreviewHandle } from './Preview';
import type { Look } from '../domain/look';
import {
  copyPng,
  download,
  downloadLayersZip,
  exportVideo,
  MAX_DIMENSION,
  videoType,
  type Layer,
} from '../engine/export';

type Kind = 'image' | 'video' | 'layers';
type Preset = { id: string; label: string; width: number; height: number };

const VIDEO_LIMIT = 1920;
/** Вкладка видео вернётся вместе с моушеном. */
const VIDEO_ENABLED = false;

/** Готовые размеры в пропорции текущего формата. */
function presetsFor(look: Look, kind: Kind): Preset[] {
  const a = look.width / look.height;
  const fit = (long: number) =>
    a >= 1
      ? { width: long, height: Math.round(long / a) }
      : { width: Math.round(long * a), height: long };
  if (kind === 'video')
    return [
      { id: 'fhd', label: 'Full HD', ...fit(1920) },
      { id: 'hd', label: 'HD', ...fit(1280) },
    ];
  const long = Math.max(look.width, look.height);
  return [
    { id: 'x1', label: '1×', width: look.width, height: look.height },
    { id: 'x2', label: '2×', ...fit(Math.min(long * 2, MAX_DIMENSION)) },
    { id: '4k', label: '4K', ...fit(3840) },
  ];
}

export function ExportDialog({
  look,
  preview,
  onClose,
}: {
  look: Look;
  preview: RefObject<PreviewHandle | null>;
  onClose: () => void;
}) {
  const video = videoType();
  const [kind, setKind] = useState<Kind>('image');
  const [format, setFormat] = useState<'png' | 'jpg'>('png');
  const [preset, setPreset] = useState('x1');
  const [custom, setCustom] = useState({ width: look.width, height: look.height });
  const [seconds, setSeconds] = useState('6');
  const [fps, setFps] = useState('30');
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [done, setDone] = useState(''),
    [error, setError] = useState('');
  // Готовые слои: показываются списком, каждый можно скопировать или скачать.
  const [layers, setLayers] = useState<(Layer & { url: string })[] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const presets = presetsFor(look, kind);
  const chosen = presets.find((p) => p.id === preset);
  const { width, height } = chosen ?? custom;
  const limit = kind === 'video' ? VIDEO_LIMIT : MAX_DIMENSION;
  const valid =
    [width, height].every((n) => Number.isInteger(n) && n >= 64 && n <= limit) &&
    (kind !== 'video' || width * height <= 1920 * 1080);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => layers?.forEach((l) => URL.revokeObjectURL(l.url)), [layers]);
  // Слои собраны под конкретный размер и кадр — при смене они устаревают.
  const layersKey = `${width}×${height}:${JSON.stringify(look)}`;
  const [layersFor, setLayersFor] = useState('');
  const shownLayers = layersFor === layersKey ? layers : null;
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) abort.current?.abort();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);

  const switchKind = (next: Kind) => {
    if (next === 'video' && !video) return;
    setKind(next);
    setPreset(presetsFor(look, next)[0].id);
    setDone('');
    setError('');
  };

  const run = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setError('');
    setDone('');
    setBusy(true);
    setProgress(0);
    // Дать браузеру показать состояние до синхронного чтения с GPU.
    await new Promise((r) => setTimeout(r, 50));
    try {
      if (kind === 'video') {
        const result = await exportVideo(
          look,
          width,
          height,
          Number(seconds),
          Number(fps),
          controller.signal,
          setProgress,
          surface.current ?? undefined,
        );
        download(result.blob, `${look.name}.${result.ext}`);
        setDone(`Видео ${result.ext.toUpperCase()} скачано`);
      } else if (kind === 'layers') {
        if (!preview.current) throw new Error('Сцена ещё не готова.');
        const result = await preview.current.layers(width, height);
        setLayers(result.layers.map((l) => ({ ...l, url: URL.createObjectURL(l.blob) })));
        setLayersFor(layersKey);
        if (result.clipped) setDone('Слои готовы. В этой сцене сложение слоёв приблизительное');
      } else {
        if (!preview.current) throw new Error('Сцена ещё не готова.');
        const blob = await preview.current.image(format, width, height);
        download(blob, `${look.name} ${width}×${height}.${format}`);
        setDone(`${format.toUpperCase()} скачан`);
      }
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === 'AbortError'
          ? 'Запись остановлена. Во время записи держите вкладку открытой.'
          : e instanceof Error
            ? e.message
            : 'Не удалось экспортировать сцену.',
      );
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const copy = async (blob: Blob | Promise<Blob>, what: string) => {
    setError('');
    setDone('');
    try {
      await copyPng(blob);
      setDone(`${what} в буфере — вставьте в Figma через ⌘V`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось скопировать.');
    }
  };
  const copyImage = () => {
    if (!preview.current || !valid) return;
    setBusy(true);
    // Промис отдаётся буферу сразу, пока клик ещё «свежий».
    const blob = preview.current.image('png', width, height);
    void copy(blob, 'Картинка').finally(() => setBusy(false));
  };

  const fileLabel =
    kind === 'video'
      ? (video?.ext ?? 'mp4').toUpperCase()
      : kind === 'layers'
        ? '3 слоя PNG'
        : format.toUpperCase();
  const action =
    kind === 'video'
      ? 'Записать видео'
      : kind === 'layers'
        ? 'Собрать слои'
        : `Скачать ${fileLabel}`;
  const ratio = valid ? width / height : look.width / look.height;
  const thumbW = ratio >= 1 ? 360 : Math.round(360 * ratio);
  const thumbH = ratio >= 1 ? Math.round(360 / ratio) : 360;

  return (
    <Modal title="Экспорт" onClose={onClose} busy={busy} wide>
      <div className="export">
        <figure className="export-preview">
          <div className="export-well">
            {busy && kind === 'video' ? (
              <div className="recording" ref={surface} />
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
            <strong>{valid ? `${width} × ${height}` : 'Размер вне диапазона'}</strong>
            <span>
              {fileLabel}
              {kind === 'video' && ` · ${seconds} с · ${fps} fps`}
            </span>
          </figcaption>
        </figure>

        <div className="export-side">
          <fieldset className="export-form" disabled={busy}>
            <legend className="sr-only">Параметры экспорта</legend>
            <Segmented
              label="Что экспортировать"
              value={kind}
              // Видео скрыто, пока в инструменте нет моушена; запись готова в engine/export.
              options={[
                { id: 'image', label: 'Картинка', icon: <Image size={14} /> },
                ...(VIDEO_ENABLED
                  ? [{ id: 'video' as const, label: 'Видео', icon: <Film size={14} /> }]
                  : []),
                { id: 'layers', label: 'Слои', icon: <Layers size={14} /> },
              ]}
              onChange={switchKind}
            />

            <div className="field">
              <span className="field-label">Размер</span>
              <Segmented
                label="Размер"
                value={chosen ? preset : 'custom'}
                options={[
                  ...presets.map((p) => ({ id: p.id, label: p.label })),
                  { id: 'custom', label: 'Свой' },
                ]}
                onChange={(id) => {
                  if (id === 'custom') setCustom({ width, height });
                  setPreset(id);
                }}
              />
              <div className="dimension-fields">
                {(['width', 'height'] as const).map((key) => (
                  <label key={key}>
                    <span>{key === 'width' ? 'Ширина' : 'Высота'}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      aria-label={key === 'width' ? 'Ширина' : 'Высота'}
                      min={64}
                      max={limit}
                      value={
                        Number.isFinite(key === 'width' ? width : height)
                          ? key === 'width'
                            ? width
                            : height
                          : ''
                      }
                      onChange={(e) => {
                        setCustom({ width, height, [key]: e.target.valueAsNumber });
                        setPreset('custom');
                      }}
                    />
                    <small>px</small>
                  </label>
                ))}
              </div>
            </div>

            {kind === 'image' && (
              <div className="field">
                <span className="field-label">Формат</span>
                <Segmented
                  label="Формат файла"
                  value={format}
                  options={[
                    { id: 'png', label: 'PNG' },
                    { id: 'jpg', label: 'JPG' },
                  ]}
                  onChange={setFormat}
                />
              </div>
            )}

            {kind === 'video' && (
              <>
                <div className="field">
                  <span className="field-label">Длительность</span>
                  <Segmented
                    label="Длительность"
                    value={seconds}
                    options={['3', '6', '10', '15', '20'].map((n) => ({ id: n, label: `${n} с` }))}
                    onChange={setSeconds}
                  />
                </div>
                <div className="field">
                  <span className="field-label">Кадров в секунду</span>
                  <Segmented
                    label="Кадров в секунду"
                    value={fps}
                    options={['24', '30', '60'].map((n) => ({ id: n, label: n }))}
                    onChange={setFps}
                  />
                </div>
              </>
            )}

            <p className="hint">
              {kind === 'video'
                ? `Свет стоит на месте, дымка и лучи живут. Запись идёт в реальном времени — не сворачивайте вкладку.${video?.ext === 'webm' ? ' Браузер пишет только WebM.' : ''}`
                : kind === 'layers'
                  ? 'Фон кладите снизу, свет и объём — сверху с режимом Plus lighter. Слой можно скопировать и вставить в Figma через ⌘V.'
                  : 'Отдельный проход в полном разрешении, а не снимок превью.'}
            </p>
          </fieldset>

          {busy && (
            <div className="export-progress">
              <progress max={1} value={kind === 'video' ? progress : undefined} />
              <span>
                {kind === 'video'
                  ? `Записываем… ${Math.round(progress * 100)}%`
                  : 'Считаем свет в полном разрешении…'}
              </span>
            </div>
          )}
          {error && (
            <p role="alert" className="message error">
              {error}
            </p>
          )}
          {done && (
            <p role="status" className="message success">
              <Check size={15} />
              {done}
            </p>
          )}

          {kind === 'layers' && shownLayers && (
            <ul className="layer-list" aria-label="Слои">
              {shownLayers.map((l) => (
                <li key={l.id}>
                  <img src={l.url} alt="" style={{ aspectRatio: `${width} / ${height}` }} />
                  <span className="layer-name">
                    <strong>{l.name}</strong>
                    <small>{l.blend}</small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label={`Скопировать слой «${l.name}»`}
                    title="Скопировать — вставить в Figma через ⌘V"
                    onClick={() => void copy(l.blob, `Слой «${l.name}»`)}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Скачать слой «${l.name}»`}
                    title="Скачать PNG"
                    onClick={() => download(l.blob, `${look.name} — ${l.name}.png`)}
                  >
                    <ArrowDownToLine size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="export-actions">
            {busy && kind === 'video' ? (
              <button className="button wide" onClick={() => abort.current?.abort()}>
                <Square size={12} fill="currentColor" />
                Остановить запись
              </button>
            ) : kind === 'layers' && shownLayers ? (
              <button
                className="button wide"
                onClick={() => void downloadLayersZip(shownLayers, look.name)}
              >
                <ArrowDownToLine size={15} />
                Скачать все одним ZIP
              </button>
            ) : (
              <>
                {kind === 'image' && (
                  <button
                    className="button wide"
                    disabled={busy || !valid}
                    title="Скопировать PNG — вставить в Figma через ⌘V"
                    onClick={copyImage}
                  >
                    <Copy size={15} />
                    Скопировать
                  </button>
                )}
                <button className="button primary wide" disabled={busy || !valid} onClick={run}>
                  {busy ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : kind === 'layers' ? (
                    <Layers size={15} />
                  ) : (
                    <ArrowDownToLine size={15} />
                  )}
                  {busy ? 'Готовим…' : action}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
