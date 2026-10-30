import { useState } from 'react';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  ChevronDown,
  Moon,
  RotateCcw,
  Sun,
} from 'lucide-react';
import { BRANDS } from '../domain/brands';
import {
  DEFAULT_LOOK,
  DIRECTIONS,
  directionOf,
  RANGES,
  wrapAngle,
  type Look,
  type NumericKey,
} from '../domain/look';
import { DirectionPad } from './DirectionPad';
import { LiveThumb } from './LiveThumb';
import { Card, Segmented, Slider, Toggle } from './controls';
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
  'brightness',
  'spread',
  'softness',
  'haze',
  'rays',
  'rayCount',
  'reflex',
  'grain',
  'distance',
] as const satisfies readonly NumericKey[];

type Patch = Partial<Look>;

export function Inspector({
  look,
  onChange,
}: {
  look: Look;
  onChange: (patch: Patch, group?: string) => void;
}) {
  const [more, setMore] = useState(false);
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
    <aside className="inspector" aria-label="Настройки света">
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
        <Segmented
          label="Характер"
          value={look.character}
          options={[
            { id: 'guide', label: 'Как в гайде' },
            { id: 'vivid', label: 'Выразительный' },
          ]}
          onChange={(character) => onChange({ character })}
        />
        <div className="slider-stack">
          {slider('brightness', 'Яркость', signed)}
          {slider('spread', 'Ширина луча')}
          {slider('softness', 'Мягкость края')}
          {slider('haze', 'Дымка')}
          {slider('rays', 'Лучи', (v) => (v === 0 ? 'Нет' : percent(v)))}
          {look.rays > 0 && slider('rayCount', 'Сколько лучей', (v) => String(Math.round(v)))}
        </div>
        <button className="disclosure" aria-expanded={more} onClick={() => setMore(!more)}>
          Ещё
          <ChevronDown size={14} />
        </button>
        {more && (
          <div className="slider-stack">
            {slider('reflex', 'Рефлекс бренда')}
            {slider('distance', 'Отступ источника')}
            {slider('grain', 'Зерно')}
          </div>
        )}
      </Card>

      <Card
        title="Проход света"
        action={
          <Toggle
            label="Проход света"
            checked={look.motion.enabled}
            onChange={(enabled) => onChange({ motion: { ...look.motion, enabled } })}
          />
        }
      >
        {look.motion.enabled ? (
          <>
            <div className="chip-row" role="group" aria-label="Куда идёт свет">
              {DIRECTIONS.map((d) => {
                const Icon = DIRECTION_ICONS[d.id];
                return (
                  <button
                    key={d.id}
                    className="chip"
                    aria-label={`К: ${d.label}`}
                    title={`Свет приходит: ${d.label}`}
                    disabled={Math.abs(wrapAngle(d.angle - look.angle)) < 0.5}
                    aria-pressed={Math.abs(wrapAngle(d.angle - look.motion.toAngle)) < 0.5}
                    onClick={() => onChange({ motion: { ...look.motion, toAngle: d.angle } })}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                  </button>
                );
              })}
            </div>
            <Slider
              label="Длительность"
              value={look.motion.duration}
              min={3}
              max={20}
              step={1}
              def={8}
              format={(v) => `${v} с`}
              onChange={(duration) =>
                onChange({ motion: { ...look.motion, duration } }, 'duration')
              }
            />
          </>
        ) : (
          <p className="hint">Свет медленно пройдёт по кадру — для видео и моушна.</p>
        )}
      </Card>
    </aside>
  );
}
