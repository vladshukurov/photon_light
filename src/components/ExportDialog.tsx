import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowDownToLine, Check, Film, Image, Layers, LoaderCircle } from 'lucide-react';
import { Modal } from './Modal';
import { Segmented } from './controls';
import type { PreviewHandle } from './Preview';
import type { Look } from '../domain/look';
import { download, exportVideo, MAX_DIMENSION, videoType } from '../engine/export';

type Kind = 'image' | 'video' | 'layers';

const KINDS = [
  { id: 'image', label: 'Картинка', Icon: Image, desc: 'PNG или JPG до 4096 px' },
  { id: 'video', label: 'Видео', Icon: Film, desc: '3–20 с, до Full HD' },
  { id: 'layers', label: 'Слои', Icon: Layers, desc: 'Три PNG для Figma' },
] as const;

/** Размеры в пропорции текущего формата. */
function sizesFor(look: Look, kind: Kind) {
  const a = look.width / look.height;
  const fit = (long: number) =>
    a >= 1
      ? { width: long, height: Math.round(long / a) }
      : { width: Math.round(long * a), height: long };
  const list = [
    { label: 'Как в формате', ...{ width: look.width, height: look.height } },
    { label: '×2', ...fit(Math.max(look.width, look.height) * 2) },
    { label: '4K', ...fit(3840) },
  ];
  if (kind === 'video')
    return [
      { label: 'Full HD', ...fit(1920) },
      { label: 'HD', ...fit(1280) },
    ];
  return list.filter(
    (s, i, all) =>
      s.width <= MAX_DIMENSION &&
      s.height <= MAX_DIMENSION &&
      all.findIndex((o) => o.width === s.width && o.height === s.height) === i,
  );
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
  const [size, setSize] = useState(0);
  const [seconds, setSeconds] = useState(look.motion.enabled ? look.motion.duration : 6);
  const [fps, setFps] = useState(30);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [done, setDone] = useState(''),
    [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const sizes = sizesFor(look, kind);
  const [custom, setCustom] = useState({ width: look.width, height: look.height });
  const isCustom = size === sizes.length;
  const { width, height } = isCustom ? custom : sizes[Math.min(size, sizes.length - 1)];
  const limit = kind === 'video' ? 1920 : MAX_DIMENSION;
  const valid =
    [width, height].every((n) => Number.isInteger(n) && n >= 64 && n <= limit) &&
    (kind !== 'video' || width * height <= 1920 * 1080);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) abort.current?.abort();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);

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
          seconds,
          fps,
          controller.signal,
          setProgress,
          surface.current ?? undefined,
        );
        download(result.blob, `${look.name}.${result.ext}`);
        setDone(`Видео ${result.ext.toUpperCase()} скачано`);
      } else if (kind === 'layers') {
        if (!preview.current) throw new Error('Сцена ещё не готова.');
        const clipped = await preview.current.layers(width, height);
        setDone(
          clipped
            ? 'Архив скачан. Сложение слоёв в этой сцене приблизительное'
            : 'Архив со слоями скачан',
        );
      } else {
        if (!preview.current) throw new Error('Сцена ещё не готова.');
        const blob = await preview.current.image(format, width, height);
        download(blob, `${look.name} ${width}×${height}.${format}`);
        setDone(`${format.toUpperCase()} ${width}×${height} скачан`);
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

  return (
    <Modal title="Экспорт" onClose={onClose} busy={busy}>
      <fieldset disabled={busy} className="export">
        <legend className="sr-only">Параметры экспорта</legend>
        <div className="export-kinds" role="group" aria-label="Что экспортировать">
          {KINDS.map(({ id, label, Icon, desc }) => (
            <button
              key={id}
              aria-pressed={kind === id}
              disabled={id === 'video' && !video}
              onClick={() => {
                setKind(id);
                setSize(0);
                setDone('');
                setError('');
              }}
            >
              <Icon size={18} strokeWidth={1.75} />
              <strong>{label}</strong>
              <small>{desc}</small>
            </button>
          ))}
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

        <div className="field">
          <span className="field-label">Размер</span>
          <div className="size-options" role="group" aria-label="Размер">
            {sizes.map((s, i) => (
              <button key={s.label} aria-pressed={i === size} onClick={() => setSize(i)}>
                <strong>{s.label}</strong>
                <small>
                  {s.width} × {s.height}
                </small>
              </button>
            ))}
            <button aria-pressed={isCustom} onClick={() => setSize(sizes.length)}>
              <strong>Свой</strong>
              <small>до {limit} px</small>
            </button>
          </div>
          {isCustom && (
            <div className="dimension-fields">
              {(['width', 'height'] as const).map((key) => (
                <label key={key}>
                  <span>{key === 'width' ? 'Ширина' : 'Высота'}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={64}
                    max={limit}
                    value={Number.isFinite(custom[key]) ? custom[key] : ''}
                    onChange={(e) => setCustom({ ...custom, [key]: e.target.valueAsNumber })}
                  />
                  <small>px</small>
                </label>
              ))}
            </div>
          )}
        </div>

        {kind === 'video' && (
          <div className="field-row">
            <label className="field">
              <span className="field-label">Длительность</span>
              <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                {[3, 5, 6, 8, 10, 12, 15, 20].map((n) => (
                  <option key={n} value={n}>
                    {n} с
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Кадров в секунду</span>
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                {[24, 30, 60].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <p className="hint">
          {kind === 'video'
            ? `${look.motion.enabled ? 'Свет пройдёт по кадру за всю длину ролика. ' : 'Свет стоит на месте, дымка и лучи живут. '}Запись идёт в реальном времени — не сворачивайте вкладку.${video?.ext === 'webm' ? ' Браузер пишет только WebM.' : ''}`
            : kind === 'layers'
              ? 'Фон — нижний слой. Свет и объём — сверху, режим наложения Plus lighter.'
              : 'Рендер идёт отдельным проходом в полном разрешении, а не снимком превью.'}
        </p>
      </fieldset>

      {busy && kind === 'video' && <div className="recording" ref={surface} />}
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

      <div className="modal-actions">
        {busy && kind === 'video' ? (
          <button className="button" onClick={() => abort.current?.abort()}>
            Остановить запись
          </button>
        ) : (
          <button className="button" disabled={busy} onClick={onClose}>
            Закрыть
          </button>
        )}
        <button className="button primary" disabled={busy || !valid} onClick={run}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />}
          {busy ? 'Готовим файл…' : kind === 'video' ? 'Записать видео' : 'Скачать'}
        </button>
      </div>
    </Modal>
  );
}
