import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { useStore } from '../store';
import { Icon } from './Icon';

/** Numeric field: drag horizontally to scrub, click to type. */
export function NumField({
  value,
  onChange,
  step = 1,
  min = -Infinity,
  max = Infinity,
  digits = 1,
  suffix,
  className = 'num',
}: {
  value: number;
  onChange: (v: number, final: boolean) => void;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  suffix?: string;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const shown = text ?? `${+value.toFixed(digits)}${suffix ?? ''}`;

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (document.activeElement === ref.current) return;
    e.preventDefault();
    const x0 = e.clientX;
    const v0 = value;
    let scrubbing = false;
    const { beginGesture, endGesture } = useStore.getState();
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!scrubbing && Math.abs(dx) > 3) {
        scrubbing = true;
        beginGesture();
        document.body.style.cursor = 'ew-resize';
      }
      if (scrubbing) {
        const mul = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
        onChange(clamp(v0 + Math.round(dx) * step * mul), false);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      if (scrubbing) endGesture();
      else {
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const commit = () => {
    if (text === null) return;
    const v = parseFloat(text);
    if (!isNaN(v)) onChange(clamp(v), true);
    setText(null);
  };

  return (
    <input
      ref={ref}
      className={className}
      value={shown}
      style={{ cursor: 'ew-resize' }}
      onPointerDown={onPointerDown}
      onFocus={() => setText(String(+value.toFixed(digits)))}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(null);
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
          onChange(clamp(value + d), true);
          setText(null);
        }
        e.stopPropagation();
      }}
    />
  );
}

/** Range slider that records a single undo step per drag. */
export function Slider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number, final: boolean) => void }) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={Math.min(max, Math.max(min, value))}
      onPointerDown={() => useStore.getState().beginGesture()}
      onPointerUp={() => useStore.getState().endGesture()}
      onChange={(e) => onChange(parseFloat(e.target.value), false)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <div className="section-h" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevD' : 'chevR'} size={12} />
        {title}
        <span className="spacer" />
        <span onClick={(e) => e.stopPropagation()}>{right}</span>
      </div>
      {open && <div className="section-b">{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal-h">
          {title}
          <span className="spacer" />
          <button className="ibtn" onClick={onClose} title="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- context menu ---------- */

export interface MenuItem {
  label?: string;
  icon?: string;
  keys?: string;
  disabled?: boolean;
  danger?: boolean;
  action?: () => void;
  sep?: boolean;
}

export const useMenu = create<{ x: number; y: number; items: MenuItem[] | null; open: (x: number, y: number, items: MenuItem[]) => void; close: () => void }>((set) => ({
  x: 0,
  y: 0,
  items: null,
  open: (x, y, items) => set({ x, y, items }),
  close: () => set({ items: null }),
}));

export function ContextMenu() {
  const { x, y, items, close } = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    if (!items) return;
    const r = ref.current?.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - (r?.width ?? 200) - 8), y: Math.min(y, window.innerHeight - (r?.height ?? 200) - 8) });
    const off = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      close();
    };
    window.addEventListener('pointerdown', off, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', off, true);
      window.removeEventListener('blur', close);
    };
  }, [items, x, y, close]);
  if (!items) return null;
  return (
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.sep ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            style={it.danger ? { color: 'var(--danger)' } : undefined}
            onClick={() => {
              close();
              it.action?.();
            }}
          >
            {it.icon ? <Icon name={it.icon} size={14} /> : <span style={{ width: 14 }} />}
            {it.label}
            {it.keys && <span className="k">{it.keys}</span>}
          </button>
        ),
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function fmtBytes(n: number) {
  if (n < 1024) return n + ' B';
  if (n < 1024 ** 2) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + ' MB';
  return (n / 1024 ** 3).toFixed(2) + ' GB';
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';
