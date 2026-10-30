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
import { Section, Segmented, Slider, Toggle } from './controls';
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
  const tuned = (['brightness', 'spread', 'softness', 'haze'] as const).some(
    (k) => look[k] !== DEFAULT_LOOK[k],
  );

  return (
    <aside className="inspector" aria-label="Настройки света">
      <Section
        title="Источник"
        action={
          <span className="section-meta">
            {current ? current.label : `${Math.round(wrapAngle(look.angle))}°`}
          </span>
        }
      >
        <DirectionPad
          look={look}
          onChange={(angle, distance, group) =>
            onChange({ angle: wrapAngle(angle), distance }, group)
          }
        />
        <div className="direction-row" role="group" aria-label="Направление света">
          {DIRECTIONS.map((d) => {
            const Icon = DIRECTION_ICONS[d.id];
            return (
              <button
                key={d.id}
                className="icon-chip"
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
      </Section>

      <Section title="Бренд">
        <div className="brand-grid" role="group" aria-label="Бренд">
          {BRANDS.map((b) => (
            <button
              key={b.id}
              className="brand-chip"
              aria-pressed={look.brand === b.id}
              onClick={() => onChange({ brand: b.id })}
            >
              <i
                className="brand-swatch"
                style={{
                  background: `radial-gradient(120% 90% at 30% 20%, ${b.accent}55, transparent 60%), linear-gradient(180deg, ${b.swatch.join(', ')})`,
                }}
              />
              <span>{b.label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Комната и характер">
        <div className="stack">
          <Segmented
            label="Комната"
            value={look.room}
            options={[
              { id: 'dark', label: 'Тёмная', icon: <Moon size={14} /> },
              { id: 'light', label: 'Светлая', icon: <Sun size={14} /> },
            ]}
            onChange={(room) => onChange({ room })}
          />
          <Segmented
            label="Характер"
            value={look.character}
            options={[
              { id: 'guide', label: 'Как в гайде' },
              { id: 'vivid', label: 'Выразительный' },
            ]}
            onChange={(character) => onChange({ character })}
          />
        </div>
      </Section>

      <Section
        title="Свет"
        action={
          <button
            className="ghost-button"
            disabled={!tuned}
            onClick={() =>
              onChange({
                brightness: DEFAULT_LOOK.brightness,
                spread: DEFAULT_LOOK.spread,
                softness: DEFAULT_LOOK.softness,
                haze: DEFAULT_LOOK.haze,
              })
            }
          >
            <RotateCcw size={12} />
            Сбросить
          </button>
        }
      >
        <div className="stack">
          {slider('brightness', 'Яркость', signed)}
          {slider('spread', 'Ширина луча')}
          {slider('softness', 'Мягкость края')}
          {slider('haze', 'Дымка')}
        </div>
      </Section>

      <Section title="Лучи">
        <div className="stack">
          {slider('rays', 'Выраженность', (v) => (v === 0 ? 'Выкл' : percent(v)))}
          {slider('rayCount', 'Количество', (v) => String(Math.round(v)), look.rays === 0)}
        </div>
      </Section>

      <Section
        title="Движение"
        action={
          <Toggle
            label="Проход света"
            checked={look.motion.enabled}
            onChange={(enabled) => onChange({ motion: { ...look.motion, enabled } })}
          />
        }
      >
        {look.motion.enabled ? (
          <div className="stack">
            <p className="hint">Свет проходит по кадру от текущего места к выбранному.</p>
            <div className="direction-row" role="group" aria-label="Куда идёт свет">
              {DIRECTIONS.map((d) => {
                const Icon = DIRECTION_ICONS[d.id];
                const same = Math.abs(wrapAngle(d.angle - look.angle)) < 0.5;
                return (
                  <button
                    key={d.id}
                    className="icon-chip"
                    aria-label={`К: ${d.label}`}
                    title={`К: ${d.label}`}
                    disabled={same}
                    aria-pressed={Math.abs(wrapAngle(d.angle - look.motion.toAngle)) < 0.5}
                    onClick={() => onChange({ motion: { ...look.motion, toAngle: d.angle } })}
                  >
                    <Icon size={16} strokeWidth={1.75} />
                  </button>
                );
              })}
            </div>
            <Slider
              label="Длительность прохода"
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
          </div>
        ) : (
          <p className="hint">
            Включите, чтобы свет медленно прошёл по кадру — для видео и моушна. Дымка и лучи в видео
            живут всегда.
          </p>
        )}
      </Section>

      <section className="section">
        <button className="disclosure" aria-expanded={more} onClick={() => setMore(!more)}>
          <span>Тонкая настройка</span>
          <ChevronDown size={14} />
        </button>
        {more && (
          <div className="stack">
            {slider('reflex', 'Брендовый рефлекс')}
            {slider('distance', 'Отступ источника', (v) => `${Math.round(v * 100)}%`)}
            {slider('grain', 'Зерно')}
          </div>
        )}
      </section>
    </aside>
  );
}
