import { useRef, type PointerEvent } from 'react';
import { DIRECTIONS, directionOf, type Look } from '../domain/look';
import { edgePoint, frameHalf } from '../domain/scene';
import { LiveThumb } from './LiveThumb';

/*
  Миниатюра кадра с источником вокруг него. Шесть точек — направления гайда,
  круглая ручка — сам свет, её можно тянуть в любое место. Пунктир — путь
  прохода, если включено движение.
*/

const BOX = 220;
const PAD = 30;
// Миниатюра не в масштабе: источник рисуется у края кадра с отступом в
// пикселях, иначе при настоящем расстоянии кадр в панели стал бы крошечным.
const OUT_PX = 13,
  OUT_PER_DISTANCE = 14;

export function DirectionPad({
  look,
  onChange,
}: {
  look: Look;
  onChange: (angle: number, distance: number, group: string) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const aspect = look.width / look.height;
  // Кадр вписан в 160 × 76: вертикальные форматы не раздувают панель по высоте.
  const fitW = BOX - PAD * 2,
    fitH = 76;
  const fw = aspect >= fitW / fitH ? fitW : fitH * aspect;
  const fh = fw / aspect;
  // Высота поля постоянная: смена формата не двигает панель.
  const W = BOX,
    H = fitH + PAD * 2;
  const cx = W / 2,
    cy = H / 2;
  const [hw, hh] = frameHalf(aspect);
  const toXY = (angle: number, distance: number) => {
    const [ex, ey] = edgePoint(angle, aspect);
    const x = (ex / hw) * (fw / 2),
      y = -(ey / hh) * (fh / 2);
    const l = Math.hypot(x, y) || 1;
    const out = OUT_PX + (distance - 1) * OUT_PER_DISTANCE;
    return [cx + x + (x / l) * out, cy + y + (y / l) * out] as const;
  };

  const drag = (e: PointerEvent<SVGSVGElement>) => {
    const rect = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const u = (x - cx) / (fw / 2),
      v = -(y - cy) / (fh / 2);
    const angle = (Math.atan2(u / 0.6, v) * 180) / Math.PI;
    const [ex, ey] = toXY(angle, 1);
    const edgeL = Math.hypot(ex - cx, ey - cy) - OUT_PX;
    const along = Math.hypot(x - cx, y - cy) - edgeL;
    const distance = Math.min(2, Math.max(0.2, 1 + (along - OUT_PX) / OUT_PER_DISTANCE));
    const s = { angle, distance };
    // рядом с направлением гайда — прилипает к нему
    const snap = DIRECTIONS.find((d) => Math.abs(((d.angle - s.angle + 540) % 360) - 180) < 6);
    const near = snap && Math.abs(s.distance - 1) < 0.18;
    onChange(near ? snap.angle : s.angle, near ? 1 : s.distance, 'source');
  };

  const [sx, sy] = toXY(look.angle, look.distance);
  const target = look.motion.enabled ? toXY(look.motion.toAngle, look.distance) : null;
  const path = target ? arcPath(look, toXY) : '';
  const current = directionOf(look.angle);

  return (
    <div className="direction-pad">
      <LiveThumb
        look={look}
        width={Math.round(fw * 2)}
        height={Math.round(fh * 2)}
        className="pad-thumb"
        style={{
          left: `${((cx - fw / 2) / W) * 100}%`,
          top: `${((cy - fh / 2) / H) * 100}%`,
          width: `${(fw / W) * 100}%`,
          height: `${(fh / H) * 100}%`,
        }}
      />
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        aria-label="Положение источника"
        aria-valuemin={-180}
        aria-valuemax={180}
        aria-valuenow={Math.round(look.angle)}
        aria-valuetext={current?.label ?? `${Math.round(look.angle)}°`}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) drag(e);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 1;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange(look.angle - step, look.distance, 'source-key');
          }
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            onChange(look.angle + step, look.distance, 'source-key');
          }
        }}
      >
        <rect className="pad-frame" x={cx - fw / 2} y={cy - fh / 2} width={fw} height={fh} rx="4" />
        {path && <path className="pad-path" d={path} />}
        {DIRECTIONS.map((d) => {
          const [x, y] = toXY(d.angle, 1);
          return (
            <circle
              key={d.id}
              className={`pad-snap${current?.id === d.id ? ' active' : ''}`}
              cx={x}
              cy={y}
              r={3}
            />
          );
        })}
        {target && <circle className="pad-target" cx={target[0]} cy={target[1]} r={6} />}
        <circle className="pad-halo" cx={sx} cy={sy} r={13} />
        <circle className="pad-source" cx={sx} cy={sy} r={6} />
      </svg>
    </div>
  );
}

function arcPath(look: Look, toXY: (angle: number, distance: number) => readonly [number, number]) {
  const delta = ((look.motion.toAngle - look.angle + 540) % 360) - 180;
  const steps = Math.max(2, Math.ceil(Math.abs(delta) / 4));
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const [x, y] = toXY(look.angle + (delta * i) / steps, look.distance);
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}
