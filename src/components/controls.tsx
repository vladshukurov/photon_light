import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';

/** Плавающая стеклянная поверхность. Группы разделяются воздухом, а не линиями. */
export function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card" aria-label={title}>
      <header className="card-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string; icon?: ReactNode }[];
  onChange: (id: T) => void;
}) {
  // Значение не из списка (например, свой размер из JSON) — ни одна кнопка не выбрана.
  const index = options.findIndex((o) => o.id === value);
  return (
    <div
      className="segmented"
      role="group"
      aria-label={label}
      style={{ '--count': options.length, '--index': Math.max(0, index) } as CSSProperties}
      data-empty={index < 0 || undefined}
    >
      <i className="segmented-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.id} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.icon}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Ползунок-пилюля: подпись и значение внутри заливки. Протяжка относительная,
 * как скраб в Figma — значение не прыгает под курсор, тянуть можно точно.
 * Клик без протяжки ставит значение в точку, двойной клик и точка справа
 * возвращают исходное. Стрелки — шаг, Shift — десять шагов.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  def,
  format,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  def?: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const drag = useRef<{ x: number; value: number; moved: boolean } | null>(null);
  const span = max - min;
  const t = (value - min) / span;
  const origin = def !== undefined && min < 0 ? (def - min) / span : 0;
  const changed = def !== undefined && Math.abs(value - def) > step / 2;
  const snap = (v: number) => {
    const q = Math.round((Math.min(max, Math.max(min, v)) - min) / step) * step + min;
    return Number(q.toFixed(4));
  };
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return snap(min + ((e.clientX - r.left) / r.width) * span);
  };
  return (
    <div className={`slider${disabled ? ' disabled' : ''}${changed ? ' changed' : ''}`}>
      <div
        className="slider-pill"
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        style={
          {
            '--from': `${Math.min(origin, t) * 100}%`,
            '--to': `${Math.max(origin, t) * 100}%`,
            '--t': t,
          } as CSSProperties
        }
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, value, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) < 3) return;
          d.moved = true;
          const width = e.currentTarget.getBoundingClientRect().width;
          const fine = e.altKey ? 0.2 : 1;
          onChange(snap(d.value + (dx / width) * span * fine));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved && e.detail < 2) onChange(at(e));
        }}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => def !== undefined && !disabled && onChange(def)}
        onKeyDown={(e) => {
          const k = (e.shiftKey ? 10 : 1) * step;
          const keys: Record<string, number> = {
            ArrowRight: value + k,
            ArrowUp: value + k,
            ArrowLeft: value - k,
            ArrowDown: value - k,
            Home: min,
            End: max,
          };
          if (e.key in keys) {
            e.preventDefault();
            onChange(snap(keys[e.key]));
          } else if ((e.key === 'Backspace' || e.key === 'Delete') && def !== undefined) {
            e.preventDefault();
            onChange(def);
          }
        }}
      >
        <i className="slider-fill" aria-hidden="true" />
        <i className="slider-thumb" aria-hidden="true" />
        <span className="slider-label">{label}</span>
        <span className="slider-value">{format(value)}</span>
      </div>
      <button
        className="slider-reset"
        tabIndex={changed ? 0 : -1}
        aria-label={`Вернуть «${label}»`}
        title="Вернуть исходное · двойной клик"
        disabled={!changed || disabled}
        onClick={() => def !== undefined && onChange(def)}
      />
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}
