import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { Logo } from './Logo';
import { MOD } from './common';

const DONE_KEY = 'fs-tour-done';

interface Step {
  /** CSS selector of the element to spotlight; none = centered card. */
  target?: string;
  title: string;
  body: ReactNode;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to F.S. Editor',
    body: <>A quick tour of the editor — about a minute. You can skip any time and replay it later from the toolbar.</>,
  },
  {
    target: '.left',
    title: '1 · Bring in your media',
    body: (
      <>
        Click <b>Import</b> or drag video, audio and images onto this panel. Double-click a file — or drag it onto the timeline — to start editing.
      </>
    ),
  },
  {
    target: '.left .tabs',
    title: '2 · Titles & effects',
    body: (
      <>
        <b>Titles</b> has ready-made text styles. <b>Effects</b> has color looks, transitions and quick effects — select a clip, then click one to apply it.
      </>
    ),
  },
  {
    target: '.viewer',
    title: '3 · Preview',
    body: (
      <>
        Your edit plays here. Press <kbd>Space</kbd> to play/pause and <kbd>←</kbd> <kbd>→</kbd> to step frames. Click something in the picture to select it, then drag it to move or pull a corner to resize.
      </>
    ),
  },
  {
    target: '.timeline .tl-main',
    title: '4 · The timeline',
    body: (
      <>
        Drag clips to move them between tracks, drag their edges to trim. Press <kbd>S</kbd> to split at the red playhead and <kbd>Del</kbd> to remove. Right-click any clip for more options.
      </>
    ),
  },
  {
    target: '.tl-toolbar',
    title: '5 · Editing tools',
    body: (
      <>
        <b>Selection</b> (V), <b>Razor</b> (C) to cut, <b>Ripple</b> (B) to trim without leaving gaps, <b>Slip</b> (Y) to change what part of a clip plays. The magnet toggles snapping. Undo with <kbd>{MOD}+Z</kbd>.
      </>
    ),
  },
  {
    target: '.right',
    title: '6 · Effect Controls',
    body: (
      <>
        Everything about the selected clip: position, scale, rotation, crop, color, blur, speed, volume, transitions. Click the <b>stopwatch</b> next to a value to animate it with keyframes.
      </>
    ),
  },
  {
    target: '.topbar .btn.primary',
    title: '7 · Export',
    body: <>When you're happy, hit <b>Export</b> to render an MP4 or WebM video. Your project saves automatically while you work.</>,
  },
  {
    title: "You're ready!",
    body: (
      <>
        Press <kbd>?</kbd> any time to see all keyboard shortcuts. Have fun editing.
      </>
    ),
  },
];

export function shouldShowTour() {
  try {
    return !localStorage.getItem(DONE_KEY);
  } catch {
    return false;
  }
}

function markDone() {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* storage unavailable — tour may show again next time */
  }
}

export function Tour() {
  const open = useStore((s) => s.dialog === 'tour');
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 200 });
  const step = STEPS[i];

  const close = () => {
    markDone();
    useStore.setState({ dialog: null });
    setI(0);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = step.target ? document.querySelector(step.target) : null;
      setRect(el ? el.getBoundingClientRect() : null);
      const c = cardRef.current?.getBoundingClientRect();
      if (c) setCardSize({ w: c.width, h: c.height });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, i, step.target]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') i < STEPS.length - 1 ? setI(i + 1) : close();
      else if (e.key === 'ArrowLeft') setI(Math.max(0, i - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  if (!open) return null;

  const pad = 8;
  const gap = 14;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let cardPos: { left: number; top: number };
  if (!rect) cardPos = { left: (vw - cardSize.w) / 2, top: (vh - cardSize.h) / 2 };
  else {
    const below = rect.bottom + gap;
    const above = rect.top - gap - cardSize.h;
    const right = rect.right + gap;
    const left = rect.left - gap - cardSize.w;
    if (right + cardSize.w < vw - 8 && rect.width < vw * 0.5) cardPos = { left: right, top: rect.top + 8 };
    else if (left > 8 && rect.width < vw * 0.5) cardPos = { left, top: rect.top + 8 };
    else if (below + cardSize.h < vh - 8) cardPos = { left: rect.left + 8, top: below };
    else if (above > 8) cardPos = { left: rect.left + 8, top: above };
    else cardPos = { left: (vw - cardSize.w) / 2, top: (vh - cardSize.h) / 2 };
    cardPos.left = Math.max(8, Math.min(vw - cardSize.w - 8, cardPos.left));
    cardPos.top = Math.max(8, Math.min(vh - cardSize.h - 8, cardPos.top));
  }
  const last = i === STEPS.length - 1;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Tutorial">
      {rect ? (
        <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" ref={cardRef} style={cardPos}>
        {i === 0 && (
          <div className="tour-logo">
            <Logo size={56} />
          </div>
        )}
        <div className="tour-title">{step.title}</div>
        <div className="tour-body">{step.body}</div>
        <div className="tour-foot">
          <div className="tour-dots">
            {STEPS.map((_, j) => (
              <span key={j} className={j === i ? 'on' : ''} />
            ))}
          </div>
          <span className="spacer" style={{ flex: 1 }} />
          {!last && (
            <button className="btn ghost sm" onClick={close}>
              Skip
            </button>
          )}
          {i > 0 && (
            <button className="btn sm" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button className="btn primary sm" onClick={() => (last ? close() : setI(i + 1))} autoFocus>
            {i === 0 ? 'Start tour' : last ? 'Start editing' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
