import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CircleHelp, Download, FolderOpen, Redo2, Undo2, X } from 'lucide-react';
import { Preview, type PreviewHandle } from './components/Preview';
import { Inspector } from './components/Inspector';
import { ExportDialog } from './components/ExportDialog';
import { Modal } from './components/Modal';
import { useLook } from './hooks/useLook';
import { DIRECTIONS, FORMATS, parseLook, serializeLook, type Look } from './domain/look';
import { download } from './engine/export';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

export default function App() {
  const { look, set, undo, redo, canUndo, canRedo, saved } = useLook();
  const preview = useRef<PreviewHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ambientRef = useRef<HTMLCanvasElement>(null);
  const [ambient, setAmbient] = useState<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [dialog, setDialog] = useState<'export' | 'help' | null>(null);
  const [toast, setToast] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => setAmbient(ambientRef.current), []);

  const change = useCallback(
    (patch: Partial<Look>, group?: string) => set({ ...look, ...patch }, group),
    [look, set],
  );

  const save = useCallback(() => {
    download(new Blob([serializeLook(look)], { type: 'application/json' }), `${look.name}.json`);
    setToast('Пресет сохранён в JSON');
  }, [look]);

  const importFile = useCallback(
    async (file?: File) => {
      if (!file) return;
      try {
        if (file.size > 1_000_000) throw new Error('JSON-пресет должен быть не больше 1 МБ.');
        const { look: next, adapted } = parseLook(await file.text());
        set(next);
        setToast(
          adapted ? `«${next.name}» перенесён из старого формата` : `«${next.name}» загружен`,
        );
      } catch (e) {
        setToast(e instanceof Error ? e.message : 'Не удалось загрузить пресет');
      }
    },
    [set],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog) return;
      const target = e.target as HTMLElement;
      const typing = target.closest('input:not([type=range]),select,textarea');
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === 'KeyZ' && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.code === 'KeyS') {
        e.preventDefault();
        save();
      } else if (mod && e.code === 'KeyO') {
        e.preventDefault();
        fileInput.current?.click();
      } else if (mod && e.code === 'KeyE') {
        e.preventDefault();
        if (ready) setDialog('export');
      } else if (!mod && !typing && e.code === 'Space' && !target.closest('button,[role=slider]')) {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (!mod && !typing && /^Digit[1-6]$/.test(e.code)) {
        const d = DIRECTIONS[Number(e.code.slice(5)) - 1];
        change({ angle: d.angle, distance: 1 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, undo, redo, save, ready, change]);

  const format = FORMATS.find((f) => f.width === look.width && f.height === look.height);

  return (
    <div
      className={`app room-${look.room}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        dragDepth.current++;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDragLeave={() => {
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        void importFile(e.dataTransfer.files[0]);
      }}
    >
      <canvas ref={ambientRef} className="ambient" width={48} height={32} aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          <span className="wordmark">Фотон</span>
          <span className="divider" aria-hidden="true" />
          <input
            className="name-input"
            aria-label="Название сцены"
            value={look.name}
            maxLength={80}
            spellCheck={false}
            onChange={(e) => change({ name: e.target.value }, 'name')}
            onBlur={(e) => {
              if (!e.target.value.trim()) change({ name: 'Без названия' });
            }}
          />
        </div>
        <div className="toolbar">
          <button
            className="icon-button"
            aria-label="Отменить"
            title={`Отменить · ${MOD}Z`}
            disabled={!canUndo}
            onClick={undo}
          >
            <Undo2 size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Повторить"
            title={`Повторить · ⇧${MOD}Z`}
            disabled={!canRedo}
            onClick={redo}
          >
            <Redo2 size={16} />
          </button>
          <span className="divider" aria-hidden="true" />
          <button
            className="icon-button"
            aria-label="Открыть JSON"
            title={`Открыть JSON · ${MOD}O`}
            onClick={() => fileInput.current?.click()}
          >
            <FolderOpen size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Сохранить JSON"
            title={`Сохранить JSON · ${MOD}S`}
            onClick={save}
          >
            <Download size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Справка"
            title="Правила света и клавиши"
            onClick={() => setDialog('help')}
          >
            <CircleHelp size={16} />
          </button>
          <button
            className="button primary"
            disabled={!ready}
            title={`Экспорт · ${MOD}E`}
            onClick={() => setDialog('export')}
          >
            Экспорт
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="stage" aria-label="Холст">
          <div className="stage-bar">
            <div className="formats" role="group" aria-label="Формат">
              {FORMATS.map((f) => (
                <button
                  key={f.label}
                  aria-pressed={format === f}
                  onClick={() => change({ width: f.width, height: f.height })}
                >
                  <i style={{ aspectRatio: `${f.width} / ${f.height}` }} />
                  {f.label}
                </button>
              ))}
            </div>
            <span className="stage-meta">
              {look.width} × {look.height}
              <span className={`save-dot${saved ? '' : ' off'}`} />
              {saved ? 'Сохранено' : 'Автосохранение недоступно'}
            </span>
          </div>
          <Preview
            ref={preview}
            look={look}
            playing={playing}
            onPlayingChange={setPlaying}
            onSourceChange={(angle, distance, group) => change({ angle, distance }, group)}
            onReady={setReady}
            ambient={ambient}
          />
        </section>
        <Inspector look={look} onChange={change} />
      </main>

      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        accept=".json,application/json"
        tabIndex={-1}
        aria-label="Загрузить JSON-пресет"
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {dialog === 'export' && (
        <ExportDialog look={look} preview={preview} onClose={() => setDialog(null)} />
      )}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button className="icon-button" aria-label="Скрыть" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {dragOver && (
        <div className="drop-overlay">
          <FolderOpen size={28} strokeWidth={1.5} />
          <strong>Отпустите JSON-пресет</strong>
          <span>Свет, бренд и формат загрузятся на холст</span>
        </div>
      )}
    </div>
  );
}

const SHORTCUTS = [
  ['1 – 6', 'Направления гайда'],
  ['Пробел', 'Живой свет: пуск и пауза'],
  [`${MOD}Z / ⇧${MOD}Z`, 'Отменить и повторить'],
  [`${MOD}S`, 'Сохранить JSON'],
  [`${MOD}O`, 'Открыть JSON'],
  [`${MOD}E`, 'Экспорт'],
  ['Двойной клик', 'Вернуть ползунок к исходному'],
];

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Правила света" onClose={onClose}>
      <div className="help">
        <ol>
          <li>
            <strong>Один источник.</strong> Свет и отражения подчиняются одному направлению. Тяните
            свет по холсту или по миниатюре в панели.
          </li>
          <li>
            <strong>Мягкое затухание.</strong> От источника свет уходит в тень, противоположная
            сторона остаётся тёмной.
          </li>
          <li>
            <strong>Фотон всегда белый.</strong> Бренд проявляется через цвет стены, среды и
            рефлексов, а не через окраску света.
          </li>
          <li>
            <strong>Свет на главном.</strong> Ставьте смысловой центр макета со стороны потока.
          </li>
        </ol>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>{v}</dt>
              <dd>
                <kbd>{k}</kbd>
              </dd>
            </div>
          ))}
        </dl>
        <a
          className="link"
          href="https://www.figma.com/design/uQJCHZKW5QWN8w1a9lscXf/?node-id=12661-11136"
          target="_blank"
          rel="noreferrer"
        >
          Гайд по свету в Figma <ArrowUpRight size={14} />
        </a>
      </div>
    </Modal>
  );
}
