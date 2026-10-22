import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { Player } from '../engine/playback';
import { clipEnd, formatTC, projectDuration } from '../engine/project';
import { propAt } from '../engine/props';
import type { ClipRect } from '../engine/render';
import { Icon } from './Icon';
import { downloadBlob } from './actions';

export let player: Player | null = null;

type Quality = 'auto' | 'full' | 'half' | 'quarter';

export function Viewer() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [disp, setDisp] = useState({ w: 640, h: 360 });
  const [quality, setQuality] = useState<Quality>('auto');
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [safe, setSafe] = useState(false);
  const pw = useStore((s) => s.project.width);
  const ph = useStore((s) => s.project.height);

  useEffect(() => {
    const p = new Player(canvasRef.current!);
    player = p;
    (globalThis as unknown as { __player: Player }).__player = p;
    return () => {
      p.destroy();
      player = null;
    };
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const pad = 16;
      const s = zoom === 'fit' ? Math.min((r.width - pad) / pw, (r.height - pad) / ph) : zoom;
      setDisp({ w: Math.max(10, pw * s), h: Math.max(10, ph * s) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pw, ph, zoom]);

  useEffect(() => {
    if (!player) return;
    const dpr = window.devicePixelRatio || 1;
    const auto = Math.min(1, (disp.w * dpr) / pw);
    player.scale = quality === 'full' ? 1 : quality === 'half' ? 0.5 : quality === 'quarter' ? 0.25 : auto;
    player.invalidate();
  }, [disp, quality, pw]);

  return (
    <div className="panel viewer">
      <div className="viewer-stage" ref={stageRef} style={{ overflow: zoom === 'fit' ? 'hidden' : 'auto' }}>
        <div className="viewer-canvas-wrap" style={{ width: disp.w, height: disp.h }}>
          <canvas ref={canvasRef} onPointerDown={(e) => pickClip(e, disp.w / pw)} />
          <Overlay k={disp.w / pw} />
          {safe && (
            <div className="overlay">
              <div className="safe" style={{ left: '5%', top: '5%', right: '5%', bottom: '5%' }} />
              <div className="safe" style={{ left: '10%', top: '10%', right: '10%', bottom: '10%' }} />
            </div>
          )}
        </div>
      </div>
      <Transport quality={quality} setQuality={setQuality} zoom={zoom} setZoom={setZoom} safe={safe} setSafe={setSafe} />
    </div>
  );
}

/** Click on the frame selects the topmost visual clip under the pointer. */
function pickClip(e: React.PointerEvent, k: number) {
  if (!player) return;
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x = (e.clientX - r.left) / k;
  const y = (e.clientY - r.top) / k;
  const ids = [...player.rects.keys()].reverse();
  for (const id of ids) {
    const rc = player.rects.get(id)!;
    const a = (-rc.rot * Math.PI) / 180;
    const dx = x - rc.cx;
    const dy = y - rc.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= rc.w / 2 && Math.abs(ly) <= rc.h / 2) {
      const st = useStore.getState();
      const c = st.project.clips.find((x) => x.id === id);
      if (c && st.project.tracks.find((t) => t.id === c.trackId)?.locked) continue;
      st.select([id]);
      return;
    }
  }
  useStore.getState().select([]);
}

function Overlay({ k }: { k: number }) {
  const sel = useStore((s) => (s.selection.length === 1 ? s.selection[0] : null));
  const [rect, setRect] = useState<ClipRect | null>(null);

  useEffect(() => {
    if (!player) return;
    const pl = player;
    let last = '';
    pl.onRendered = () => {
      const r = sel ? (pl.rects.get(sel) ?? null) : null;
      const key = r ? `${r.cx.toFixed(1)},${r.cy.toFixed(1)},${r.w.toFixed(1)},${r.h.toFixed(1)},${r.rot.toFixed(2)}` : '';
      if (key !== last) {
        last = key;
        setRect(r ? { ...r } : null);
      }
    };
    pl.invalidate();
    return () => {
      pl.onRendered = null;
    };
  }, [sel]);

  if (!sel || !rect) return null;

  const startDrag = (e: React.PointerEvent, mode: 'move' | 'scale') => {
    e.stopPropagation();
    e.preventDefault();
    const st = useStore.getState();
    const c = st.project.clips.find((x) => x.id === sel);
    if (!c) return;
    const lt = Math.max(0, st.playhead - c.start);
    const x0 = propAt(c, 'x', lt);
    const y0 = propAt(c, 'y', lt);
    const s0 = propAt(c, 'scale', lt);
    const px = e.clientX;
    const py = e.clientY;
    const wrap = (e.currentTarget as HTMLElement).closest('.viewer-canvas-wrap')!.getBoundingClientRect();
    const cxs = wrap.left + rect.cx * k;
    const cys = wrap.top + rect.cy * k;
    const d0 = Math.hypot(px - cxs, py - cys) || 1;
    st.beginGesture();
    const move = (ev: PointerEvent) => {
      const s = useStore.getState();
      if (mode === 'move') {
        let nx = x0 + (ev.clientX - px) / k;
        let ny = y0 + (ev.clientY - py) / k;
        if (ev.shiftKey) {
          if (Math.abs(nx - x0) > Math.abs(ny - y0)) ny = y0;
          else nx = x0;
        }
        // Snap to center
        if (Math.abs(nx) < 8 / k) nx = 0;
        if (Math.abs(ny) < 8 / k) ny = 0;
        s.setProp(sel, 'x', Math.round(nx), false);
        s.setProp(sel, 'y', Math.round(ny), false);
      } else {
        const d = Math.hypot(ev.clientX - cxs, ev.clientY - cys);
        s.setProp(sel, 'scale', Math.max(1, +(s0 * (d / d0)).toFixed(1)), false);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      useStore.getState().endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const w = rect.w * k;
  const h = rect.h * k;
  const handles = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  return (
    <div className="overlay">
      <div
        className="box"
        style={{ left: rect.cx * k - w / 2, top: rect.cy * k - h / 2, width: w, height: h, transform: `rotate(${rect.rot}deg)` }}
        onPointerDown={(e) => startDrag(e, 'move')}
      >
        {handles.map(([hx, hy], i) => (
          <div
            key={i}
            className="handle"
            style={{ left: hx < 0 ? -5 : w - 5, top: hy < 0 ? -5 : h - 5, cursor: hx * hy > 0 ? 'nwse-resize' : 'nesw-resize' }}
            onPointerDown={(e) => startDrag(e, 'scale')}
          />
        ))}
      </div>
    </div>
  );
}

function Transport({
  quality,
  setQuality,
  zoom,
  setZoom,
  safe,
  setSafe,
}: {
  quality: Quality;
  setQuality: (q: Quality) => void;
  zoom: 'fit' | number;
  setZoom: (z: 'fit' | number) => void;
  safe: boolean;
  setSafe: (b: boolean) => void;
}) {
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const loop = useStore((s) => s.loop);
  const fps = useStore((s) => s.project.fps);
  const dur = useStore((s) => projectDuration(s.project));
  const st = useStore.getState;

  const editPoints = () => {
    const p = st().project;
    const pts = new Set<number>([0]);
    for (const c of p.clips) {
      pts.add(c.start);
      pts.add(clipEnd(c));
    }
    return [...pts].sort((a, b) => a - b);
  };

  return (
    <div className="transport">
      <span className="tc" title="Current time">
        {formatTC(playhead, fps)}
      </span>
      <span className="spacer" />
      <button className="ibtn" title="Mark In (I)" onClick={() => st().setIn()}>
        <Icon name="inPt" />
      </button>
      <button className="ibtn" title="Mark Out (O)" onClick={() => st().setOut()}>
        <Icon name="outPt" />
      </button>
      <button className="ibtn" title="Go to previous edit (↑)" onClick={() => st().setPlayhead([...editPoints()].reverse().find((t) => t < playhead - 1e-4) ?? 0)}>
        <Icon name="toStart" />
      </button>
      <button className="ibtn" title="Step back 1 frame (←)" onClick={() => st().setPlayhead(playhead - 1 / fps)}>
        <Icon name="stepBack" />
      </button>
      <button className="play-btn" title="Play / Pause (Space)" onClick={() => st().setPlaying(!playing)}>
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <button className="ibtn" title="Step forward 1 frame (→)" onClick={() => st().setPlayhead(playhead + 1 / fps)}>
        <Icon name="stepFwd" />
      </button>
      <button className="ibtn" title="Go to next edit (↓)" onClick={() => st().setPlayhead(editPoints().find((t) => t > playhead + 1e-4) ?? dur)}>
        <Icon name="toEnd" />
      </button>
      <button className={'ibtn' + (loop ? ' on' : '')} title="Loop playback" onClick={() => st().set({ loop: !loop })}>
        <Icon name="loop" />
      </button>
      <button
        className="ibtn"
        title="Export frame as PNG"
        onClick={async () => {
          const b = await player?.snapshot();
          if (b) downloadBlob(b, `${st().project.name} ${formatTC(playhead, fps).replace(/:/g, '-')}.png`);
        }}
      >
        <Icon name="camera" />
      </button>
      <span className="spacer" />
      <button className={'ibtn' + (safe ? ' on' : '')} title="Safe margins" onClick={() => setSafe(!safe)}>
        <Icon name="fit" />
      </button>
      <select className="select" value={String(zoom)} onChange={(e) => setZoom(e.target.value === 'fit' ? 'fit' : +e.target.value)} title="Viewer zoom">
        <option value="fit">Fit</option>
        <option value="0.25">25%</option>
        <option value="0.5">50%</option>
        <option value="1">100%</option>
      </select>
      <select className="select" value={quality} onChange={(e) => setQuality(e.target.value as Quality)} title="Playback resolution">
        <option value="auto">Auto</option>
        <option value="full">Full</option>
        <option value="half">1/2</option>
        <option value="quarter">1/4</option>
      </select>
      <span className="tc dim" title="Sequence duration">
        {formatTC(dur, fps)}
      </span>
    </div>
  );
}
