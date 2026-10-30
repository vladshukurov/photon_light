import { useId, useRef, type CSSProperties, type ReactNode } from 'react';

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" aria-label={title}>
      <header className="section-head">
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
  const index = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );
  return (
    <div
      className="segmented"
      role="group"
      aria-label={label}
      style={{ '--count': options.length, '--index': index } as CSSProperties}
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
 * Ползунок в духе Figma: подпись и значение в одной строке, тонкий трек под
 * ними. Двойной клик возвращает значение по умолчанию.
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
  const id = useId();
  const t = (value - min) / (max - min);
  const origin = def !== undefined && min < 0 ? (def - min) / (max - min) : 0;
  const lastTap = useRef(0);
  return (
    <div className={`slider${disabled ? ' disabled' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id}>{format(value)}</output>
      <div
        className="slider-track"
        style={
          {
            '--from': `${Math.min(origin, t) * 100}%`,
            '--to': `${Math.max(origin, t) * 100}%`,
            '--t': `${t * 100}%`,
          } as CSSProperties
        }
      >
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => {
            const now = Date.now();
            if (def !== undefined && now - lastTap.current < 300) onChange(def);
            lastTap.current = now;
          }}
        />
      </div>
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
