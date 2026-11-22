import { type PointerEvent, type ReactNode, useRef } from 'react';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  id: string;
  name: string;
  subtitle?: string;
  meta?: ReactNode;
  tint: 'attack' | 'ai' | 'human' | 'defense';
  rect: Rect;
  z: number;
  active: boolean;
  className?: string;
  onFocus(): void;
  onChange(rect: Rect): void;
  /** Shows a close button in the title bar. */
  onClose?(): void;
  closeLabel?: string;
  /** Keeps the window's content alive without showing it. */
  hidden?: boolean;
  children: ReactNode;
}

const TOP = 44;

/** An LR-OS window: glass panel, one active at a time, draggable by its title bar, resizable. */
export function Window({
  id,
  name,
  subtitle,
  meta,
  tint,
  rect,
  z,
  active,
  className,
  onFocus,
  onChange,
  onClose,
  closeLabel,
  hidden,
  children,
}: Props) {
  const drag = useRef<{ mode: 'move' | 'size'; px: number; py: number; start: Rect } | null>(null);

  const begin = (mode: 'move' | 'size') => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, px: e.clientX, py: e.clientY, start: rect };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (d.mode === 'move') {
      const x = Math.max(-d.start.w + 80, Math.min(window.innerWidth - 80, d.start.x + dx));
      const y = Math.max(TOP, Math.min(window.innerHeight - 40, d.start.y + dy));
      onChange({ ...d.start, x, y });
    } else onChange({ ...d.start, w: Math.max(280, d.start.w + dx), h: Math.max(170, d.start.h + dy) });
  };
  const end = () => {
    drag.current = null;
  };

  return (
    <section
      id={`win-${id}`}
      className={`win${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      data-tint={tint}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: z }}
      hidden={hidden}
      aria-label={name}
      onPointerDownCapture={onFocus}
    >
      <div
        className="tb"
        onPointerDown={begin('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <i className="glyph" />
        <span className="name">{name}</span>
        {subtitle && <span>{subtitle}</span>}
        {meta && <span className="meta">{meta}</span>}
        {onClose && (
          <button
            type="button"
            className={`win-close${meta ? '' : ' alone'}`}
            aria-label={closeLabel}
            title={closeLabel}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      <div className="body">{children}</div>
      <div
        className="grip"
        onPointerDown={begin('size')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </section>
  );
}
