import { useEffect, useState, type RefObject } from 'react';
import {
  ArrowDownToLine,
  Check,
  Copy,
  Image,
  Layers,
  LoaderCircle,
  LockKeyhole,
  UnlockKeyhole,
} from 'lucide-react';
import { Modal } from './Modal';
import { Segmented } from './controls';
import { LiveThumb } from './LiveThumb';
import type { PreviewHandle } from './Preview';
import type { Look } from '../domain/look';
import {
  EXPORT_SETTINGS_KEY,
  exportPresets,
  restoreExportSettings,
  type ExportSettings,
} from '../domain/exportSettings';
import { copyPng, download, downloadLayersZip, MAX_DIMENSION, type Layer } from '../engine/export';

type FilePreview = { key: string; blob: Blob; url: string };
type LayerPack = {
  key: string;
  items: (Layer & { url: string })[];
  composite: Blob;
  url: string;
  clipped: boolean;
};
const pauseForPaint = () => new Promise((resolve) => setTimeout(resolve, 50));
const fileSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} КБ`
    : `${(bytes / 1024 / 1024).toFixed(2)} МБ`;

export function ExportDialog({
  look,
  preview,
  onClose,
}: {
  look: Look;
  preview: RefObject<PreviewHandle | null>;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState(() => restoreExportSettings(look));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(false);
  const [file, setFile] = useState<FilePreview | null>(null);
  const [pack, setPack] = useState<LayerPack | null>(null);
  const { kind, format, preset, locked, quality } = settings;
  const presets = exportPresets(look);
  const chosen = presets.find((p) => p.id === preset);
  const { width, height } = chosen ?? settings;
  const validSide = (n: number) => Number.isInteger(n) && n >= 64 && n <= MAX_DIMENSION;
  const valid = validSide(width) && validSide(height);
  const lookKey = JSON.stringify(look);
  const keyFor = (f: 'png' | 'jpg') =>
    `${lookKey}:${width}x${height}:${f}:${f === 'jpg' ? quality : ''}`;
  const imageKey = keyFor(format);
  const layersKey = `${lookKey}:${width}x${height}`;
  const shownPack = pack?.key === layersKey ? pack : null;
  const shownFile = file?.key === imageKey ? file : null;
  const result =
    kind === 'layers' ? shownPack && { url: shownPack.url, blob: shownPack.composite } : shownFile;

  useEffect(() => {
    if (!valid) return;
    try {
      localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify({ ...settings, width, height }));
    } catch {
      /* Export still works when browser storage is unavailable. */
    }
  }, [settings, width, height, valid]);
  useEffect(
    () => () => {
      if (file) URL.revokeObjectURL(file.url);
    },
    [file],
  );
  useEffect(
    () => () => {
      if (pack) {
        pack.items.forEach((l) => URL.revokeObjectURL(l.url));
        URL.revokeObjectURL(pack.url);
      }
    },
    [pack],
  );

  const update = (patch: Partial<ExportSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setDone('');
    setError('');
    setZoom(false);
  };
  const changeSize = (axis: 'width' | 'height', value: number) => {
    const next = { width, height, [axis]: value };
    if (locked && Number.isFinite(value)) {
      if (axis === 'width') next.height = Math.round(value / settings.ratio);
      else next.width = Math.round(value * settings.ratio);
    }
    update({ ...next, preset: 'custom' });
  };
  const getImage = async (f = format) => {
    const key = keyFor(f);
    if (file?.key === key) return file.blob;
    if (!preview.current || !valid) throw new Error('Проверьте размер изображения.');
    await pauseForPaint();
    await document.fonts.ready;
    const blob = await preview.current.image(f, width, height, quality);
    if (f === format) setFile({ key, blob, url: URL.createObjectURL(blob) });
    return blob;
  };
  const perform = async (action: () => Promise<void>) => {
    if (busy || !valid) return;
    setBusy(true);
    setError('');
    setDone('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подготовить файл.');
    } finally {
      setBusy(false);
    }
  };
  const buildLayers = async () => {
    if (shownPack) return shownPack;
    if (!preview.current) throw new Error('Сцена ещё не готова.');
    await pauseForPaint();
    await document.fonts.ready;
    const result = await preview.current.layers(width, height);
    const next = {
      key: layersKey,
      items: result.layers.map((l) => ({ ...l, url: URL.createObjectURL(l.blob) })),
      composite: result.composite,
      url: URL.createObjectURL(result.composite),
      clipped: result.clipped,
    };
    setPack(next);
    return next;
  };
  const inspectFile = () =>
    void perform(async () => {
      if (kind === 'layers') await buildLayers();
      else await getImage();
      setZoom(true);
    });
  const save = () =>
    void perform(async () => {
      if (kind === 'layers') {
        const ready = await buildLayers();
        await downloadLayersZip(ready.items, `${look.name} ${width}×${height}`, ready.composite);
        setDone('ZIP со слоями и цельным PNG готов');
      } else {
        download(await getImage(), `${look.name} ${width}×${height}.${format}`);
        setDone(`${format.toUpperCase()} готов к скачиванию`);
      }
    });
  const copy = (blob: Blob | Promise<Blob>, label: string) =>
    void perform(async () => {
      // ClipboardItem receives the promise during the click, before awaiting rendering.
      await copyPng(blob);
      setDone(`${label} в буфере — вставьте в Figma`);
    });
  const ratio = valid ? width / height : look.width / look.height;
  const thumbW = ratio >= 1 ? 360 : Math.max(1, Math.round(360 * ratio));
  const thumbH = ratio >= 1 ? Math.max(1, Math.round(360 / ratio)) : 360;
  const byteLabel = result ? fileSize(result.blob.size) : null;

  return (
    <Modal title="Экспорт" onClose={onClose} busy={busy} wide>
      <div className="export">
        <figure className="export-preview">
          <div className="preview-tools">
            <span>{result ? 'Готовый файл' : 'Предпросмотр'}</span>
            {zoom ? (
              <button className="ghost-button" onClick={() => setZoom(false)}>
                Вписать
              </button>
            ) : (
              <button className="ghost-button" disabled={busy || !valid} onClick={inspectFile}>
                100%
              </button>
            )}
          </div>
          <div
            className={`export-well${zoom && result ? ' actual-size' : ''}`}
            tabIndex={zoom ? 0 : undefined}
            aria-label={zoom ? 'Готовый файл в масштабе 100%, прокрутка' : undefined}
          >
            {result ? (
              <img
                className="export-thumb"
                src={result.url}
                alt="Готовое изображение для экспорта"
                width={width}
                height={height}
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
            <strong>{valid ? `${width} × ${height}` : 'Проверьте размер'}</strong>
            <span>
              {kind === 'layers' ? 'Цельный PNG' : format.toUpperCase()}
              {byteLabel ? ` · ${byteLabel}` : ''}
            </span>
          </figcaption>
          <p className="hint">
            {result
              ? kind === 'layers'
                ? 'Цельный кадр из архива, с зерном.'
                : 'Предпросмотр того же файла, который будет скачан.'
              : 'Нажмите 100%, чтобы проверить готовый файл и узнать его вес.'}
          </p>
        </figure>
        <div className="export-side">
          <fieldset className="export-form" disabled={busy}>
            <legend className="sr-only">Параметры экспорта</legend>
            <Segmented
              label="Что экспортировать"
              value={kind}
              options={[
                { id: 'image', label: 'Картинка', icon: <Image size={14} /> },
                { id: 'layers', label: 'Слои', icon: <Layers size={14} /> },
              ]}
              onChange={(kind) => update({ kind })}
            />
            <div className="field">
              <span className="field-label">Размер</span>
              <div className="export-sizes" role="group" aria-label="Размер">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    aria-pressed={chosen?.id === p.id}
                    onClick={() =>
                      update({
                        preset: p.id,
                        width: p.width,
                        height: p.height,
                        ratio: p.width / p.height,
                      })
                    }
                  >
                    <strong>{p.label}</strong>
                    <small>
                      {p.width} × {p.height}
                    </small>
                  </button>
                ))}
                <button
                  aria-pressed={!chosen}
                  onClick={() => update({ preset: 'custom', width, height })}
                >
                  Свой
                </button>
              </div>
              <div className="dimension-fields">
                {(['width', 'height'] as const).map((axis) => {
                  const value = axis === 'width' ? width : height;
                  const label = axis === 'width' ? 'Ширина' : 'Высота';
                  return (
                    <label key={axis}>
                      <span>{label}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        aria-label={label}
                        min={64}
                        max={MAX_DIMENSION}
                        aria-invalid={!validSide(value)}
                        aria-describedby={!valid ? 'export-size-error' : undefined}
                        value={Number.isFinite(value) ? value : ''}
                        onChange={(e) => changeSize(axis, e.target.valueAsNumber)}
                      />
                      <small>px</small>
                    </label>
                  );
                })}
              </div>
              <button
                className="ratio-lock"
                aria-pressed={locked}
                onClick={() =>
                  update({
                    locked: !locked,
                    ratio: valid ? width / height : look.width / look.height,
                  })
                }
              >
                {locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />} Сохранять
                пропорции
              </button>
              {!valid && (
                <p id="export-size-error" className="message error" role="alert">
                  Каждая сторона — целое число от 64 до {MAX_DIMENSION} px.
                </p>
              )}
            </div>
            {kind === 'image' ? (
              <>
                <div className="field">
                  <span className="field-label">Формат</span>
                  <Segmented
                    label="Формат файла"
                    value={format}
                    options={[
                      { id: 'png', label: 'PNG' },
                      { id: 'jpg', label: 'JPG' },
                    ]}
                    onChange={(format) => update({ format })}
                  />
                </div>
                {format === 'jpg' && (
                  <label className="quality-field">
                    <span>
                      Качество JPG <strong>{Math.round(quality * 100)}%</strong>
                    </span>
                    <input
                      type="range"
                      aria-label="Качество JPG"
                      min={40}
                      max={100}
                      step={1}
                      value={Math.round(quality * 100)}
                      onChange={(e) => update({ quality: Number(e.target.value) / 100 })}
                    />
                  </label>
                )}
              </>
            ) : (
              <p className="hint layers-explanation">
                В ZIP: 3 слоя без зерна и точный цельный PNG с зерном. Слои непрозрачные: фон —
                снизу, свет и объём — сверху в режиме Plus lighter. Их сложение может отличаться от
                цельного кадра.
              </p>
            )}
          </fieldset>
          {busy && (
            <div className="export-progress" role="status">
              <progress />
              <span>Готовим файл…</span>
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
          {kind === 'layers' && shownPack && (
            <>
              {shownPack.clipped && (
                <p className="hint">
                  В этой сцене сложение слоёв приблизительное. Сверяйтесь с цельным PNG.
                </p>
              )}
              <ul className="layer-list" aria-label="Слои">
                {shownPack.items.map((l) => (
                  <li key={l.id}>
                    <img src={l.url} alt="" style={{ aspectRatio: `${width} / ${height}` }} />
                    <span className="layer-name">
                      <strong>{l.name}</strong>
                      <small>{l.blend}</small>
                    </span>
                    <button
                      className="icon-button"
                      disabled={busy}
                      aria-label={`Скопировать слой «${l.name}»`}
                      onClick={() => copy(l.blob, `Слой «${l.name}»`)}
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy}
                      aria-label={`Скачать слой «${l.name}»`}
                      onClick={() =>
                        download(l.blob, `${look.name} ${width}×${height} — ${l.name}.png`)
                      }
                    >
                      <ArrowDownToLine size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="export-actions">
            {kind === 'image' && (
              <button
                className="button wide"
                disabled={busy || !valid}
                onClick={() => copy(getImage('png'), 'PNG')}
              >
                <Copy size={15} />
                Скопировать PNG
              </button>
            )}
            {kind === 'layers' && !shownPack ? (
              <button
                className="button primary wide"
                disabled={busy || !valid}
                onClick={() =>
                  void perform(async () => {
                    await buildLayers();
                  })
                }
              >
                <Layers size={15} />
                Собрать слои
              </button>
            ) : (
              <button className="button primary wide" disabled={busy || !valid} onClick={save}>
                {busy ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />}
                {kind === 'layers' ? 'Скачать все одним ZIP' : `Скачать ${format.toUpperCase()}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
