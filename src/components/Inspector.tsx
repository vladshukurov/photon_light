import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  Moon,
  RotateCcw,
  Sun,
} from 'lucide-react';
import { BRANDS } from '../domain/brands';
import {
  DEFAULT_LOOK,
  DIRECTIONS,
  directionOf,
  FORMATS,
  RANGES,
  wrapAngle,
  type Look,
  type NumericKey,
} from '../domain/look';
import { DirectionPad } from './DirectionPad';
import { LiveThumb } from './LiveThumb';
import { Card, Segmented, Slider } from './controls';
import { percent, signed } from './format';

/** Стрелка показывает, куда идёт свет: источник сверху слева светит вниз вправо. */
const DIRECTION_ICONS = {
  'top-left': ArrowDownRight,
  top: ArrowDown,
  'top-right': ArrowDownLeft,
  'bottom-left': ArrowUpRight,
  bottom: ArrowUp,
  'bottom-right': ArrowUpLeft,
} as const;

/** Всё, что двигает ползунками: «Сбросить» возвращает именно это, не трогая свет и бренд. */
const TUNING = [
  'expression',
  'brightness',
  'spread',
  'softness',
  'haze',
  'rays',
  'rayCount',
  'grain',
] as const satisfies readonly NumericKey[];

type Patch = Partial<Look>;

export function Inspector({
  look,
  onChange,
}: {
  look: Look;
  onChange: (patch: Patch, group?: string) => void;
}) {
  const slider = (key: NumericKey, label: string, format = percent, disabled = false) => (
    <Slider
      label={label}
      value={look[key]}
      min={RANGES[key].min}
      max={RANGES[key].max}
      step={key === 'rayCount' ? 1 : 0.01}
      def={RANGES[key].def}
      format={format}
      disabled={disabled}
      onChange={(v) => onChange({ [key]: v }, key)}
    />
  );
  const current = directionOf(look.angle);
  const tuned = TUNING.some((k) => look[k] !== DEFAULT_LOOK[k]);

  return (
    <>
      <aside className="panel panel-left" aria-label="Формат, источник и окружение">
        <Card
          title="Формат"
          action={
            <span className="card-meta">
              {look.width} × {look.height}
            </span>
          }
        >
          <Segmented
            label="Формат"
            value={
              FORMATS.find((f) => f.width === look.width && f.height === look.height)?.label ?? ''
            }
            options={FORMATS.map((f) => ({
              id: f.label,
              label: f.label,
              icon: <i className="ratio" style={{ aspectRatio: `${f.width} / ${f.height}` }} />,
            }))}
            onChange={(label) => {
              const f = FORMATS.find((x) => x.label === label)!;
              onChange({ width: f.width, height: f.height });
            }}
          />
        </Card>
        <Card
          title="Источник"
          action={
            <span className="card-meta">
              {current && look.distance === 1
                ? current.label
                : `${Math.round(wrapAngle(look.angle))}°`}
            </span>
          }
        >
          <DirectionPad
            look={look}
            onChange={(angle, distance, group) =>
              onChange({ angle: wrapAngle(angle), distance }, group)
            }
          />
          <div className="chip-row" role="group" aria-label="Направление света">
            {DIRECTIONS.map((d) => {
              const Icon = DIRECTION_ICONS[d.id];
              return (
                <button
                  key={d.id}
                  className="chip"
                  aria-label={d.label}
                  title={d.label}
                  aria-pressed={current?.id === d.id && look.distance === 1}
                  onClick={() => onChange({ angle: d.angle, distance: 1 })}
                >
                  <Icon size={16} strokeWidth={1.75} />
                </button>
              );
            })}
          </div>
        </Card>

        <Card title="Окружение">
          <div className="brand-grid" role="group" aria-label="Бренд">
            {BRANDS.map((b) => (
              <button
                key={b.id}
                className="brand-card"
                aria-pressed={look.brand === b.id}
                aria-label={b.label}
                onClick={() => onChange({ brand: b.id })}
              >
                <LiveThumb
                  look={{ ...look, brand: b.id }}
                  width={232}
                  height={144}
                  className="brand-thumb"
                />
                <span>{b.label}</span>
              </button>
            ))}
          </div>
          {look.brand === 'vk' && (
            <Segmented
              label="Версия VK"
              value={look.tone}
              options={[
                { id: 'mono', label: 'Ч/б' },
                { id: 'blue', label: 'Синий отлив' },
              ]}
              onChange={(tone) => onChange({ tone })}
            />
          )}
          <Segmented
            label="Комната"
            value={look.room}
            options={[
              { id: 'dark', label: 'Тёмная', icon: <Moon size={14} /> },
              { id: 'light', label: 'Светлая', icon: <Sun size={14} /> },
            ]}
            onChange={(room) => onChange({ room })}
          />
        </Card>
      </aside>
      <aside className="panel panel-right" aria-label="Настройки света">
        <Card
          title="Свет"
          action={
            <button
              className="ghost-button"
              disabled={!tuned}
              title="Вернуть все ползунки к исходным"
              onClick={() =>
                onChange(Object.fromEntries(TUNING.map((k) => [k, DEFAULT_LOOK[k]])) as Patch)
              }
            >
              <RotateCcw size={12} />
              Сбросить
            </button>
          }
        >
          <div className="slider-stack">
            {slider('expression', 'Выразительность')}
            {slider('brightness', 'Яркость', signed)}
            {slider('spread', 'Ширина луча')}
            {slider('softness', 'Мягкость края')}
            {slider('haze', 'Дымка')}
            {slider('rays', 'Лучи', (v) => (v === 0 ? 'Нет' : percent(v)))}
            {look.rays > 0 && slider('rayCount', 'Сколько лучей', (v) => String(Math.round(v)))}
          </div>
        </Card>
        <Card
          title="Надпись"
          action={
            look.text ? (
              <button className="ghost-button" onClick={() => onChange({ text: '' })}>
                Убрать
              </button>
            ) : undefined
          }
        >
          <textarea
            className="text-input"
            aria-label="Текст надписи"
            placeholder="Текст, на который падает свет"
            rows={2}
            maxLength={120}
            spellCheck={false}
            value={look.text}
            onChange={(e) => onChange({ text: e.target.value }, 'text')}
          />
          {look.text.trim() && <div className="slider-stack">{slider('textSize', 'Размер')}</div>}
        </Card>
      </aside>
    </>
  );
}
