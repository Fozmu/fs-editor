import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Clip, Ease, Project, Track } from '../types';
import { getEntry, useMediaVersion } from '../engine/media';
import {
  clearRange,
  clipEnd,
  clone,
  EPS,
  makeClip,
  maxDurFor,
  projectDuration,
  snapFrame,
  snapPoints,
  splitClip,
  trimStartTo,
  uid,
} from '../engine/project';
import { TEXT_PRESETS } from '../engine/presets';
import { Icon } from './Icon';
import { KIND_COLOR } from './Inspector';
import { addTextPreset, importFiles } from './actions';
import { MOD, useMenu, type MenuItem } from './common';

const RULER_H = 28;
const DIVIDER_H = 4;
const SNAP_PX = 8;

type Lane = { kind: 'track'; track: Track; top: number; h: number } | { kind: 'divider'; top: number; h: number };

function computeLanes(tracks: Track[]): Lane[] {
  const v = tracks.filter((t) => t.type === 'video').reverse();
  const a = tracks.filter((t) => t.type === 'audio');
  const lanes: Lane[] = [];
  let y = RULER_H;
  for (const t of v) {
    lanes.push({ kind: 'track', track: t, top: y, h: t.height });
    y += t.height;
  }
  lanes.push({ kind: 'divider', top: y, h: DIVIDER_H });
  y += DIVIDER_H;
  for (const t of a) {
    lanes.push({ kind: 'track', track: t, top: y, h: t.height });
    y += t.height;
  }
  return lanes;
}

export function Timeline() {
  const project = useStore((s) => s.project);
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const offline = useMediaVersion((s) => s.offline);
  useMediaVersion((s) => s.v);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewW, setViewW] = useState(1000);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [razorX, setRazorX] = useState<number | null>(null);
  const [dropLane, setDropLane] = useState<string | null>(null);

  const lanes = useMemo(() => computeLanes(project.tracks), [project.tracks]);
  const totalH = lanes.length ? lanes[lanes.length - 1].top + lanes[lanes.length - 1].h : RULER_H;
  const dur = projectDuration(project);
  const contentW = Math.max(viewW, (dur + 30) * zoom);
  const selSet = useMemo(() => new Set(selection), [selection]);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------- coordinate helpers ---------- */
  const timeAt = useCallback((clientX: number) => {
    const r = contentRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left) / useStore.getState().zoom);
  }, []);
  const laneAt = useCallback(
    (clientY: number): Track | null => {
      const r = contentRef.current!.getBoundingClientRect();
      const y = clientY - r.top;
      for (const l of lanes) if (l.kind === 'track' && y >= l.top && y < l.top + l.h) return l.track;
      return null;
    },
    [lanes],
  );

  const snap = (t: number, exclude: Set<string>, points?: number[]) => {
    const st = useStore.getState();
    if (!st.snapping) return { t, hit: null as number | null };
    const pts = points ?? snapPoints(st.project, st.playhead, exclude);
    const thr = SNAP_PX / st.zoom;
    let best: number | null = null;
    for (const p of pts) if (Math.abs(p - t) < thr && (best === null || Math.abs(p - t) < Math.abs(best - t))) best = p;
    return best === null ? { t, hit: null } : { t: best, hit: best };
  };

  /* ---------- wheel zoom ---------- */
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      e.preventDefault();
      const st = useStore.getState();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const tAt = (el.scrollLeft + mx) / st.zoom;
      const nz = Math.min(800, Math.max(1, st.zoom * Math.exp(-e.deltaY * 0.0025)));
      st.set({ zoom: nz });
      requestAnimationFrame(() => (el.scrollLeft = tAt * nz - mx));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------- pointer interactions ---------- */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const st = useStore.getState();
    const p = st.project;
    if (target.closest('.ruler')) {
      const mk = target.closest('[data-marker]') as HTMLElement | null;
      if (mk) {
        const m = p.markers.find((x) => x.id === mk.dataset.marker);
        if (m) st.setPlayhead(m.t);
        return;
      }
      scrub(e);
      return;
    }
    const clipEl = target.closest('[data-clip]') as HTMLElement | null;
    if (!clipEl) {
      startMarquee(e);
      return;
    }
    const clip = p.clips.find((c) => c.id === clipEl.dataset.clip);
    if (!clip) return;
    const track = p.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;
    if (st.tool === 'razor') {
      const { t } = snap(timeAt(e.clientX), new Set());
      if (e.shiftKey) {
        st.edit((d) => {
          const add: Clip[] = [];
          const locked = new Set(d.tracks.filter((x) => x.locked).map((x) => x.id));
          for (const c of d.clips) if (!locked.has(c.trackId)) {
            const r = splitClip(c, t);
            if (r) add.push(r);
          }
          d.clips.push(...add);
        });
      } else st.splitAt(clip.id, t);
      return;
    }
    const kf = target.closest('[data-kf]') as HTMLElement | null;
    if (kf) {
      st.select([clip.id]);
      startKeyDrag(e, clip, +kf.dataset.kf!);
      return;
    }
    const edge = target.closest('[data-edge]') as HTMLElement | null;
    // selection
    let sel = st.selection;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) {
      st.toggleSelect(clip.id);
      sel = useStore.getState().selection;
      if (!sel.includes(clip.id)) return;
    } else if (!sel.includes(clip.id)) {
      sel = [clip.id];
      st.select(sel);
    }
    if (edge) startTrim(e, clip, edge.dataset.edge as 'l' | 'r');
    else if (st.tool === 'slip') startSlip(e, clip);
    else startMove(e, clip, sel, additive);
  };

  const scrub = (e: React.PointerEvent) => {
    const st = useStore.getState();
    st.setPlaying(false);
    const apply = (ev: { clientX: number; shiftKey: boolean }) => {
      let t = timeAt(ev.clientX);
      if (ev.shiftKey) t = snap(t, new Set(), snapPoints(useStore.getState().project, -1, new Set())).t;
      useStore.getState().setPlayhead(t);
    };
    apply(e);
    const move = (ev: PointerEvent) => apply(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Click a keyframe diamond to jump to it, drag to retime every key at that time. */
  const startKeyDrag = (e: React.PointerEvent, clip: Clip, t0: number) => {
    const st = useStore.getState();
    const tol = 0.5 / st.project.fps;
    const base = clone(clip.keys);
    const x0 = e.clientX;
    let moved = false;
    let cur = t0;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      if (!moved) {
        moved = true;
        st.beginGesture();
      }
      const s2 = useStore.getState();
      cur = Math.min(clip.dur, Math.max(0, snapFrame(t0 + (ev.clientX - x0) / s2.zoom, s2.project.fps)));
      s2.updateClip(
        clip.id,
        (c) => {
          const out: Clip['keys'] = {};
          for (const [k, ks] of Object.entries(base)) {
            const at = ks.find((kf) => Math.abs(kf.t - t0) < tol);
            // A dragged key replaces whatever key it lands on.
            const rest = ks.filter((kf) => kf !== at && (!at || Math.abs(kf.t - cur) >= tol));
            out[k] = at ? [...rest, { ...at, t: cur }].sort((a, b) => a.t - b.t) : rest;
          }
          c.keys = out;
        },
        false,
      );
      s2.setPlayhead(clip.start + cur);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) useStore.getState().endGesture();
      else useStore.getState().setPlayhead(clip.start + t0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startMarquee = (e: React.PointerEvent) => {
    const st = useStore.getState();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const startSel = additive ? st.selection : [];
    if (!additive) st.select([]);
    const r = contentRef.current!.getBoundingClientRect();
    const x0 = e.clientX - r.left;
    const y0 = e.clientY - r.top;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const rr = contentRef.current!.getBoundingClientRect();
      const x1 = ev.clientX - rr.left;
      const y1 = ev.clientY - rr.top;
      if (!moved && Math.hypot(x1 - x0, y1 - y0) < 4) return;
      moved = true;
      setMarquee({ x0, y0, x1, y1 });
      const st2 = useStore.getState();
      const t0 = Math.min(x0, x1) / st2.zoom;
      const t1 = Math.max(x0, x1) / st2.zoom;
      const ya = Math.min(y0, y1);
      const yb = Math.max(y0, y1);
      const hitTracks = new Set(lanes.filter((l): l is Extract<Lane, { kind: 'track' }> => l.kind === 'track' && l.top < yb && l.top + l.h > ya && !l.track.locked).map((l) => l.track.id));
      const ids = st2.project.clips.filter((c) => hitTracks.has(c.trackId) && c.start < t1 && clipEnd(c) > t0).map((c) => c.id);
      st2.select([...new Set([...startSel, ...ids])]);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startMove = (e: React.PointerEvent, clip: Clip, sel: string[], additive: boolean) => {
    const st = useStore.getState();
    const base = st.project;
    const selIds = new Set(sel);
    const moving = base.clips.filter((c) => selIds.has(c.id));
    const lists: Record<string, Track[]> = {
      video: base.tracks.filter((t) => t.type === 'video'),
      audio: base.tracks.filter((t) => t.type === 'audio'),
    };
    const ptype = base.tracks.find((t) => t.id === clip.trackId)!.type;
    const idxOf = (tid: string) => lists[ptype].findIndex((t) => t.id === tid);
    const pIdx = idxOf(clip.trackId);
    const points = snapPoints(base, st.playhead, selIds);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    let lastD = 0;
    let duplicated = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!moved) {
        moved = true;
        st.beginGesture();
        if (ev.altKey && !duplicated) {
          // Alt-drag: leave copies behind.
          duplicated = true;
          st.edit((d) => {
            for (const c of moving) d.clips.push({ ...clone(c), id: uid() });
          }, false);
        }
      }
      const z = useStore.getState().zoom;
      let dt = (ev.clientX - x0) / z;
      // snapping on any moving edge
      if (useStore.getState().snapping) {
        const thr = SNAP_PX / z;
        let best: { d: number; p: number } | null = null;
        for (const c of moving) {
          for (const edge of [c.start + dt, clipEnd(c) + dt]) {
            for (const p of points) {
              const d = p - edge;
              if (Math.abs(d) < thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, p };
            }
          }
        }
        if (best) {
          dt += best.d;
          setSnapLine(best.p);
        } else setSnapLine(null);
      }
      const minStart = Math.min(...moving.map((c) => c.start));
      dt = Math.max(dt, -minStart);
      // vertical lane change
      const lt = laneAt(ev.clientY);
      let dIdx = lastD;
      if (lt && lt.type === ptype) {
        const cand = idxOf(lt.id) - pIdx;
        const ok = moving.every((c) => {
          const tt = base.tracks.find((t) => t.id === c.trackId)!;
          if (tt.type !== ptype) return true;
          const n = lists[ptype][idxOf(c.trackId) + cand];
          return n && !n.locked;
        });
        if (ok) dIdx = cand;
      }
      lastD = dIdx;
      st.edit((d) => {
        for (const c of d.clips) {
          if (!selIds.has(c.id)) continue;
          const o = moving.find((m) => m.id === c.id)!;
          c.start = Math.max(0, o.start + dt);
          const tt = base.tracks.find((t) => t.id === o.trackId)!;
          if (tt.type === ptype) c.trackId = lists[ptype][idxOf(o.trackId) + dIdx].id;
        }
      }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSnapLine(null);
      if (moved) {
        st.edit((d) => {
          for (const c of d.clips.filter((x) => selIds.has(x.id))) clearRange(d, c.trackId, c.start, clipEnd(c), selIds);
        }, false);
        st.endGesture();
      } else if (!additive) st.select([clip.id]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startTrim = (e: React.PointerEvent, clip: Clip, side: 'l' | 'r') => {
    const st = useStore.getState();
    const base = st.project;
    const ripple = st.tool === 'ripple';
    const fps = base.fps;
    const others = base.clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id);
    const origEnd = clipEnd(clip);
    const prevEnd = Math.max(0, ...others.filter((c) => clipEnd(c) <= clip.start + EPS).map(clipEnd));
    const nextStart = Math.min(Infinity, ...others.filter((c) => c.start >= origEnd - EPS).map((c) => c.start));
    const isMedia = clip.kind === 'video' || clip.kind === 'audio';
    const later = new Set(others.filter((c) => c.start >= origEnd - EPS).map((c) => c.id));
    const points = snapPoints(base, st.playhead, new Set([clip.id]));
    const x0 = e.clientX;
    st.beginGesture();
    document.body.style.cursor = 'ew-resize';
    const move = (ev: PointerEvent) => {
      const z = useStore.getState().zoom;
      const dt = (ev.clientX - x0) / z;
      st.edit((d) => {
        const c = d.clips.find((x) => x.id === clip.id)!;
        Object.assign(c, clone(clip));
        let shift = 0;
        if (side === 'l') {
          let ns = clip.start + dt;
          const s = snap(ns, new Set([clip.id]), points);
          ns = s.t;
          setSnapLine(s.hit);
          const minS = Math.max(ripple ? 0 : prevEnd, isMedia ? clip.start - clip.in / clip.speed : -Infinity, 0);
          ns = Math.min(origEnd - 1 / fps, Math.max(minS, ns));
          trimStartTo(c, ns);
          if (ripple) {
            shift = -(ns - clip.start);
            c.start = clip.start;
          }
        } else {
          let ne = origEnd + dt;
          const s = snap(ne, new Set([clip.id]), points);
          ne = s.t;
          setSnapLine(s.hit);
          const maxE = Math.min(ripple ? Infinity : nextStart, clip.start + maxDurFor(base, clip));
          ne = Math.max(clip.start + 1 / fps, Math.min(maxE, ne));
          c.dur = ne - clip.start;
          if (ripple) shift = ne - origEnd;
        }
        if (ripple) {
          for (const o of d.clips) {
            if (!later.has(o.id)) continue;
            const b = base.clips.find((x) => x.id === o.id)!;
            o.start = Math.max(0, b.start + shift);
          }
        }
      }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      setSnapLine(null);
      st.endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startSlip = (e: React.PointerEvent, clip: Clip) => {
    if (clip.kind !== 'video' && clip.kind !== 'audio') return;
    const st = useStore.getState();
    const m = st.project.media.find((x) => x.id === clip.mediaId);
    if (!m) return;
    const x0 = e.clientX;
    st.beginGesture();
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / useStore.getState().zoom;
      const maxIn = Math.max(0, m.duration - clip.dur * clip.speed);
      st.updateClip(clip.id, (c) => void (c.in = Math.min(maxIn, Math.max(0, clip.in - dt * clip.speed))), false);
      // Show the new in-frame in the viewer.
      useStore.getState().setPlayhead(clip.start);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      st.endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /* ---------- context menus ---------- */
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const st = useStore.getState();
    const target = e.target as HTMLElement;
    const mk = target.closest('[data-marker]') as HTMLElement | null;
    if (mk) {
      const m = st.project.markers.find((x) => x.id === mk.dataset.marker);
      if (!m) return;
      useMenu.getState().open(e.clientX, e.clientY, [
        {
          label: 'Rename marker…',
          action: () => {
            const n = prompt('Marker name', m.label);
            if (n !== null) st.edit((p) => void (p.markers.find((x) => x.id === m.id)!.label = n));
          },
        },
        { label: 'Delete marker', icon: 'trash', danger: true, action: () => st.removeMarker(m.id) },
      ]);
      return;
    }
    const clipEl = target.closest('[data-clip]') as HTMLElement | null;
    const t = timeAt(e.clientX);
    const kfEl = target.closest('[data-kf]') as HTMLElement | null;
    if (clipEl && kfEl) {
      const id = clipEl.dataset.clip!;
      const kt = +kfEl.dataset.kf!;
      st.select([id]);
      const ease = (e: Ease, label: string): MenuItem => ({ label, action: () => st.setEaseAt(id, kt, e) });
      useMenu.getState().open(e.clientX, e.clientY, [
        ease('linear', 'Linear'),
        ease('easeIn', 'Ease In'),
        ease('easeOut', 'Ease Out'),
        ease('easeInOut', 'Ease In/Out'),
        ease('hold', 'Hold'),
        { sep: true },
        { label: 'Delete keyframe', icon: 'trash', danger: true, action: () => st.deleteKeysAt(id, kt) },
      ]);
      return;
    }
    if (clipEl) {
      const id = clipEl.dataset.clip!;
      if (!st.selection.includes(id)) st.select([id]);
      const c = st.project.clips.find((x) => x.id === id)!;
      const m = st.project.media.find((x) => x.id === c.mediaId);
      const items: MenuItem[] = [
        { label: 'Split at playhead', icon: 'split', keys: 'S', action: () => st.splitAtPlayhead() },
        { label: 'Split here', icon: 'razor', action: () => st.splitAt(id, t) },
        { sep: true },
        { label: 'Copy', icon: 'copy', keys: `${MOD}+C`, action: () => st.copy() },
        { label: 'Duplicate', keys: `${MOD}+D`, action: () => st.duplicate() },
        { label: 'Paste at playhead', keys: `${MOD}+V`, disabled: !st.clipboard.length, action: () => st.paste() },
        { sep: true },
      ];
      if (c.kind === 'video' && m?.hasAudio) {
        items.push({ label: c.muted ? 'Unmute clip audio' : 'Mute clip audio', icon: 'mute', action: () => st.updateClip(id, (x) => void (x.muted = !x.muted)) });
        items.push({ label: 'Detach audio', icon: 'unlink', action: () => st.detachAudio(id) });
      }
      if (c.kind !== 'audio')
        items.push({
          label: 'Add fade in/out',
          icon: 'sparkle',
          action: () =>
            st.updateClip(id, (x) => {
              x.transIn = { type: 'fade', dur: Math.min(0.5, x.dur / 3) };
              x.transOut = { type: 'fade', dur: Math.min(0.5, x.dur / 3) };
            }),
        });
      if (c.kind === 'audio' || (c.kind === 'video' && m?.hasAudio))
        items.push({
          label: 'Add audio fades',
          icon: 'volume',
          action: () =>
            st.updateClip(id, (x) => {
              x.props.fadeIn = Math.min(0.5, x.dur / 3);
              x.props.fadeOut = Math.min(0.5, x.dur / 3);
            }),
        });
      items.push(
        { label: 'Reset all effects', icon: 'reset', action: () => st.updateClip(id, (x) => ((x.props = {}), (x.keys = {}), (x.blend = 'source-over'))) },
        { sep: true },
        { label: 'Delete', icon: 'trash', keys: 'Del', danger: true, action: () => st.deleteSelected() },
        { label: 'Ripple delete', icon: 'ripple', keys: 'Shift+Del', danger: true, action: () => st.deleteSelected(true) },
      );
      useMenu.getState().open(e.clientX, e.clientY, items);
      return;
    }
    const lane = laneAt(e.clientY);
    useMenu.getState().open(e.clientX, e.clientY, [
      { label: 'Paste here', disabled: !st.clipboard.length, action: () => (st.setPlayhead(t), st.paste()) },
      { label: 'Close gap', icon: 'ripple', disabled: !lane, action: () => lane && st.closeGap(lane.id, t) },
      { label: 'Add marker here', icon: 'marker', action: () => (st.setPlayhead(t), st.addMarker()) },
      { sep: true },
      { label: 'Add video track', icon: 'plus', action: () => st.addTrack('video') },
      { label: 'Add audio track', icon: 'plus', action: () => st.addTrack('audio') },
    ]);
  };

  /* ---------- drag & drop from bin / OS ---------- */
  const acceptsDrop = (e: React.DragEvent) =>
    ['application/x-fs-media', 'application/x-fs-text', 'application/x-fs-gen', 'Files'].some((t) => e.dataTransfer.types.includes(t));

  const onDragOver = (e: React.DragEvent) => {
    if (!acceptsDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const l = laneAt(e.clientY);
    setDropLane(l?.id ?? null);
    const s = snap(timeAt(e.clientX), new Set());
    setSnapLine(s.hit);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropLane(null);
    setSnapLine(null);
    const st = useStore.getState();
    const lane = laneAt(e.clientY);
    const t = snap(timeAt(e.clientX), new Set()).t;
    const dt = e.dataTransfer;
    const pickTrack = (type: 'video' | 'audio') => (lane && lane.type === type && !lane.locked ? lane.id : undefined);
    const mid = dt.getData('application/x-fs-media');
    if (mid) {
      const m = st.project.media.find((x) => x.id === mid);
      if (m) st.insertMedia(mid, pickTrack(m.kind === 'audio' ? 'audio' : 'video'), t);
      return;
    }
    const ti = dt.getData('application/x-fs-text');
    if (ti) {
      const tid = pickTrack('video');
      if (tid) addTextPreset(TEXT_PRESETS[+ti], { trackId: tid, time: t });
      else {
        st.setPlayhead(t);
        addTextPreset(TEXT_PRESETS[+ti]);
      }
      return;
    }
    const gen = dt.getData('application/x-fs-gen') as 'solid' | 'adjust';
    if (gen) {
      const tid = pickTrack('video');
      if (tid) {
        let id = '';
        st.edit((p) => {
          const c = makeClip(gen, tid, t, 5);
          clearRange(p, tid, t, t + 5, new Set());
          p.clips.push(c);
          id = c.id;
        });
        st.select([id]);
      } else {
        st.setPlayhead(t);
        st.addGenerated(gen);
      }
      return;
    }
    if (dt.files.length) {
      const items = await importFiles(Array.from(dt.files));
      let cur = t;
      for (const m of items) {
        useStore.getState().insertMedia(m.id, pickTrack(m.kind === 'audio' ? 'audio' : 'video'), cur);
        cur += m.kind === 'image' ? 5 : m.duration;
      }
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (tool !== 'razor') return;
    const r = contentRef.current!.getBoundingClientRect();
    setRazorX(e.clientX - r.left);
  };

  return (
    <div className="panel timeline">
      <TimelineToolbar viewW={viewW} />
      <div className="tl-main">
        <div className="tl-heads" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: RULER_H, borderBottom: '1px solid var(--line)', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 4 }}>
            <button className="ibtn sm" title="Add video track" onClick={() => useStore.getState().addTrack('video')}>
              <Icon name="plus" size={12} />
            </button>
            <span className="meta">Tracks</span>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <div style={{ transform: `translateY(${-scrollTop}px)` }}>
              {lanes.map((l, i) =>
                l.kind === 'divider' ? <div key={'d' + i} className="tl-divider" /> : <TrackHead key={l.track.id} track={l.track} />,
              )}
            </div>
          </div>
        </div>
        <div className="tl-scroll" ref={scrollRef} onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}>
          <div
            className={'tl-content tool-' + tool}
            ref={contentRef}
            style={{ width: contentW, height: totalH }}
            onPointerDown={onPointerDown}
            onContextMenu={onContextMenu}
            onDragOver={onDragOver}
            onDragLeave={() => (setDropLane(null), setSnapLine(null))}
            onDrop={onDrop}
            onMouseMove={onMouseMove}
            onMouseLeave={() => setRazorX(null)}
          >
            <Ruler project={project} zoom={zoom} width={contentW} />
            {lanes.map((l, i) =>
              l.kind === 'divider' ? (
                <div key={'d' + i} className="tl-divider" />
              ) : (
                <div
                  key={l.track.id}
                  className={'lane' + (l.track.type === 'audio' ? ' audio' : '') + (dropLane === l.track.id ? ' drop' : '') + (l.track.locked ? ' locked' : '')}
                  style={{ height: l.h, opacity: l.track.hidden ? 0.45 : 1 }}
                >
                  {project.clips
                    .filter((c) => c.trackId === l.track.id)
                    .map((c) => (
                      <ClipView key={c.id} clip={c} zoom={zoom} h={l.h} selected={selSet.has(c.id)} offline={!!(c.mediaId && offline[c.mediaId])} />
                    ))}
                </div>
              ),
            )}
            {project.inPoint !== null || project.outPoint !== null ? (
              <div
                className="inout"
                style={{ left: (project.inPoint ?? 0) * zoom, width: ((project.outPoint ?? dur) - (project.inPoint ?? 0)) * zoom, top: RULER_H, height: totalH - RULER_H, opacity: 0.35 }}
              />
            ) : null}
            <PlayheadLine scrollRef={scrollRef} />
            {snapLine !== null && <div className="snapline" style={{ left: snapLine * zoom }} />}
            {razorX !== null && <div className="razor-line" style={{ left: razorX }} />}
            {marquee && (
              <div
                className="marquee"
                style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- toolbar ---------------- */

function TimelineToolbar({ viewW }: { viewW: number }) {
  const tool = useStore((s) => s.tool);
  const snapping = useStore((s) => s.snapping);
  const zoom = useStore((s) => s.zoom);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const hasSel = useStore((s) => s.selection.length > 0);
  const st = useStore.getState;
  const fit = () => {
    const d = projectDuration(st().project);
    st().set({ zoom: Math.min(800, Math.max(1, (viewW - 40) / Math.max(d, 1))) });
  };
  const tools: { id: typeof tool; icon: string; tip: string }[] = [
    { id: 'select', icon: 'cursor', tip: 'Selection tool (V)' },
    { id: 'razor', icon: 'razor', tip: 'Razor tool (C) — click to cut, Shift+click cuts all tracks' },
    { id: 'ripple', icon: 'ripple', tip: 'Ripple edit tool (B) — trims shift later clips' },
    { id: 'slip', icon: 'split', tip: 'Slip tool (Y) — change source in/out without moving clip' },
  ];
  return (
    <div className="tl-toolbar">
      {tools.map((t) => (
        <button key={t.id} className={'ibtn' + (tool === t.id ? ' on' : '')} title={t.tip} onClick={() => st().set({ tool: t.id })}>
          <Icon name={t.icon} />
        </button>
      ))}
      <span className="sep" />
      <button className={'ibtn' + (snapping ? ' on' : '')} title="Snapping (N)" onClick={() => st().set({ snapping: !snapping })}>
        <Icon name="magnet" />
      </button>
      <button className="ibtn" title="Split at playhead (S)" onClick={() => st().splitAtPlayhead()}>
        <Icon name="split" />
      </button>
      <button className="ibtn" title="Delete (Del)" disabled={!hasSel} onClick={() => st().deleteSelected()}>
        <Icon name="trash" />
      </button>
      <button className="ibtn" title="Ripple delete (Shift+Del)" disabled={!hasSel} onClick={() => st().deleteSelected(true)}>
        <Icon name="ripple" />
      </button>
      <button className="ibtn" title="Add marker (M)" onClick={() => st().addMarker()}>
        <Icon name="marker" />
      </button>
      <span className="sep" />
      <button className="ibtn" title={`Undo (${MOD}+Z)`} disabled={!canUndo} onClick={() => st().undo()}>
        <Icon name="undo" />
      </button>
      <button className="ibtn" title={`Redo (${MOD}+Shift+Z)`} disabled={!canRedo} onClick={() => st().redo()}>
        <Icon name="redo" />
      </button>
      <span className="sep" />
      <button className="btn sm ghost" onClick={() => st().addTrack('video')}>
        <Icon name="plus" size={12} /> Video track
      </button>
      <button className="btn sm ghost" onClick={() => st().addTrack('audio')}>
        <Icon name="plus" size={12} /> Audio track
      </button>
      <span className="spacer" style={{ flex: 1 }} />
      <button className="ibtn" title="Zoom out (-)" onClick={() => st().set({ zoom: Math.max(1, zoom / 1.4) })}>
        <Icon name="zoomOut" />
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        style={{ width: 120 }}
        value={(Math.log(zoom) / Math.log(800)) * 1000}
        onChange={(e) => st().set({ zoom: Math.exp((+e.target.value / 1000) * Math.log(800)) })}
        title="Timeline zoom"
      />
      <button className="ibtn" title="Zoom in (=)" onClick={() => st().set({ zoom: Math.min(800, zoom * 1.4) })}>
        <Icon name="zoomIn" />
      </button>
      <button className="ibtn" title="Zoom to fit (\)" onClick={fit}>
        <Icon name="fit" />
      </button>
    </div>
  );
}

/* ---------------- ruler ---------------- */

function Ruler({ project, zoom, width }: { project: Project; zoom: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(width, 32000);
    c.width = w * dpr;
    c.height = RULER_H * dpr;
    c.style.width = w + 'px';
    c.style.height = RULER_H + 'px';
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, RULER_H);
    const steps = [1 / project.fps, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const major = steps.find((s) => s * zoom >= 80) ?? 600;
    const minor = steps.slice().reverse().find((s) => s < major && s * zoom >= 8 && Math.abs(major / s - Math.round(major / s)) < 1e-6) ?? major / 2;
    g.fillStyle = '#5b5f68';
    for (let t = 0; t * zoom < w; t += minor) g.fillRect(Math.round(t * zoom), RULER_H - 6, 1, 6);
    g.fillStyle = '#8b8f99';
    g.font = '10px Inter, sans-serif';
    for (let i = 0; i * major * zoom < w; i++) {
      const t = i * major;
      const x = Math.round(t * zoom);
      g.fillRect(x, RULER_H - 13, 1, 13);
      const mm = Math.floor(t / 60);
      const ss = t - mm * 60;
      const label = major < 1 ? `${mm}:${ss.toFixed(2).padStart(5, '0')}` : `${mm}:${String(Math.floor(ss)).padStart(2, '0')}`;
      g.fillText(label, x + 3, 11);
    }
  }, [zoom, width, project.fps]);
  return (
    <div className="ruler" style={{ width }}>
      <canvas ref={ref} />
      {(project.inPoint !== null || project.outPoint !== null) && (
        <div
          className="inout"
          style={{ left: (project.inPoint ?? 0) * zoom, width: Math.max(2, ((project.outPoint ?? projectDuration(project)) - (project.inPoint ?? 0)) * zoom) }}
        />
      )}
      {project.markers.map((m) => (
        <div key={m.id} data-marker={m.id} className="marker" title={m.label} style={{ left: m.t * zoom, background: m.color }} />
      ))}
    </div>
  );
}

/* ---------------- playhead ---------------- */

function PlayheadLine({ scrollRef }: { scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const playhead = useStore((s) => s.playhead);
  const zoom = useStore((s) => s.zoom);
  const playing = useStore((s) => s.playing);
  const x = playhead * zoom;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    if (x > el.scrollLeft + el.clientWidth - 30 || x < el.scrollLeft) el.scrollLeft = x - 40;
  }, [x, playing, scrollRef]);
  return <div className="playhead" style={{ left: x }} />;
}

/* ---------------- track header ---------------- */

function TrackHead({ track }: { track: Track }) {
  const st = useStore.getState;
  const up = (patch: Partial<Track>) => st().updateTrack(track.id, patch);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = track.height;
    st().beginGesture();
    const move = (ev: PointerEvent) => st().updateTrack(track.id, { height: Math.max(28, Math.min(240, h0 + ev.clientY - y0)) });
    const upF = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', upF);
      st().endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', upF);
  };
  return (
    <div
      className={'tl-head' + (track.type === 'audio' ? ' audio' : '')}
      style={{ height: track.height }}
      onContextMenu={(e) => {
        e.preventDefault();
        useMenu.getState().open(e.clientX, e.clientY, [
          {
            label: 'Rename track…',
            action: () => {
              const n = prompt('Track name', track.name);
              if (n) up({ name: n });
            },
          },
          { label: `Add ${track.type} track`, icon: 'plus', action: () => st().addTrack(track.type) },
          { sep: true },
          { label: 'Delete track', icon: 'trash', danger: true, action: () => st().removeTrack(track.id) },
        ]);
      }}
    >
      <span className="tname" title={track.name}>
        {track.name}
      </span>
      {track.type === 'video' && (
        <button className={'ibtn sm' + (track.hidden ? ' on' : '')} title="Toggle track output" onClick={() => up({ hidden: !track.hidden })}>
          <Icon name={track.hidden ? 'eyeOff' : 'eye'} size={13} />
        </button>
      )}
      <button className={'ibtn sm' + (track.muted ? ' on' : '')} title="Mute track" onClick={() => up({ muted: !track.muted })}>
        <Icon name={track.muted ? 'mute' : 'volume'} size={13} />
      </button>
      {track.type === 'audio' && (
        <button className={'ibtn sm' + (track.solo ? ' on' : '')} title="Solo track" onClick={() => up({ solo: !track.solo })} style={{ fontWeight: 800, fontSize: 11 }}>
          S
        </button>
      )}
      <button className={'ibtn sm' + (track.locked ? ' on' : '')} title="Lock track" onClick={() => up({ locked: !track.locked })}>
        <Icon name={track.locked ? 'lock' : 'unlock'} size={13} />
      </button>
      {track.type === 'audio' && track.height >= 40 && (
        <input
          className="vol"
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={track.volume}
          title={`Track volume ${Math.round(track.volume * 100)}%`}
          onPointerDown={() => st().beginGesture()}
          onPointerUp={() => st().endGesture()}
          onChange={(e) => up({ volume: +e.target.value })}
        />
      )}
      <div className="resize" onPointerDown={startResize} />
    </div>
  );
}

/* ---------------- clip ---------------- */

const ClipView = memo(function ClipView({ clip, zoom, h, selected, offline }: { clip: Clip; zoom: number; h: number; selected: boolean; offline: boolean }) {
  const v = useMediaVersion((s) => s.v);
  // Only the selected clip follows the playhead (to highlight its current keyframe).
  const playhead = useStore((s) => (selected ? s.playhead : -1));
  const fps = useStore((s) => s.project.fps);
  const ref = useRef<HTMLCanvasElement>(null);
  const left = clip.start * zoom;
  const width = Math.max(3, clip.dur * zoom);
  const innerH = h - 6;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = Math.max(1, Math.min(Math.ceil(width), 6000));
    const H = innerH;
    c.width = W;
    c.height = H;
    c.style.width = width + 'px';
    c.style.height = H + 'px';
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const e = getEntry(clip.mediaId);
    if (!e) return;
    const pxScale = width / W;
    if ((clip.kind === 'video' || clip.kind === 'image') && e.thumbs?.length) {
      const bmp0 = e.thumbs[0];
      const tileW = Math.max(8, (bmp0.width / bmp0.height) * H);
      for (let x = 0; x < W; x += tileW / pxScale) {
        const sec = (x * pxScale) / zoom;
        const src = clip.in + sec * clip.speed;
        const idx = e.thumbStep === Infinity || !e.thumbStep ? 0 : Math.min(e.thumbs.length - 1, Math.max(0, Math.floor(src / e.thumbStep)));
        g.drawImage(e.thumbs[idx], x, 0, tileW / pxScale, H);
      }
    }
    if (e.peaks && e.peaksPerSec && (clip.kind === 'audio' || (clip.kind === 'video' && !clip.muted && h >= 56))) {
      const wh = clip.kind === 'audio' ? H - 14 : H * 0.35;
      const base = H - 2;
      const vol = Math.min(2, (clip.props.volume ?? 100) / 100);
      g.fillStyle = clip.kind === 'audio' ? 'rgba(210,255,235,0.75)' : 'rgba(255,255,255,0.55)';
      if (clip.kind === 'video') {
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(0, H - wh - 2, W, wh + 2);
        g.fillStyle = 'rgba(160,255,210,0.8)';
      }
      const n = e.peaks.length;
      for (let x = 0; x < W; x++) {
        const s0 = clip.in + ((x * pxScale) / zoom) * clip.speed;
        const s1 = clip.in + (((x + 1) * pxScale) / zoom) * clip.speed;
        const a = Math.floor(s0 * e.peaksPerSec);
        const b = Math.max(a + 1, Math.floor(s1 * e.peaksPerSec));
        if (a >= n) break;
        let mx = 0;
        for (let i = a; i < b && i < n; i++) if (e.peaks[i] > mx) mx = e.peaks[i];
        const ph = Math.max(1, Math.min(1, mx * vol) * wh);
        if (clip.kind === 'audio') g.fillRect(x, base - wh / 2 - ph / 2 + 2, 1, ph);
        else g.fillRect(x, base - ph, 1, ph);
      }
    }
  }, [clip.mediaId, clip.in, clip.speed, clip.dur, clip.kind, clip.muted, clip.props.volume, width, innerH, zoom, v, h]);

  const kfTimes = useMemo(() => {
    const s = new Set<number>();
    for (const ks of Object.values(clip.keys)) for (const k of ks) if (k.t >= 0 && k.t <= clip.dur) s.add(Math.round(k.t * 1000) / 1000);
    return [...s];
  }, [clip.keys, clip.dur]);

  const bg = KIND_COLOR[clip.kind];
  const label = clip.kind === 'text' ? clip.text?.content.split('\n')[0] || 'Text' : clip.name;
  const hasFx = Object.keys(clip.props).some((k) => !['x', 'y', 'scale', 'volume', 'fadeIn', 'fadeOut'].includes(k)) || Object.keys(clip.keys).length > 0;

  return (
    <div
      data-clip={clip.id}
      className={'clip' + (selected ? ' sel' : '') + (offline ? ' offline' : '')}
      style={{ left, width, background: clip.kind === 'solid' ? clip.color : bg }}
      title={`${clip.name}\n${clip.dur.toFixed(2)}s${clip.speed !== 1 ? ` @ ${clip.speed}×` : ''}${offline ? '\nMEDIA OFFLINE' : ''}`}
    >
      {(clip.mediaId || clip.kind === 'audio') && <canvas ref={ref} className="strip" />}
      <div className="clip-label">
        {clip.speed !== 1 && <span className="clip-badge">{+clip.speed.toFixed(2)}×</span>}
        {clip.muted && <span className="clip-badge">muted</span>}
        {hasFx && <span className="clip-badge">fx</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      </div>
      {clip.transIn.type !== 'none' && <div className="trans" style={{ left: 0, width: Math.min(width, clip.transIn.dur * zoom) }} />}
      {clip.transOut.type !== 'none' && <div className="trans out" style={{ right: 0, width: Math.min(width, clip.transOut.dur * zoom) }} />}
      {kfTimes.map((t) => (
        <div key={t} data-kf={t} className={'kfdot' + (selected && Math.abs(playhead - clip.start - t) < 0.5 / fps ? ' on' : '')} style={{ left: t * zoom }} title="Keyframe: drag to move, right-click for easing" />
      ))}
      <div className="edge l" data-edge="l" />
      <div className="edge r" data-edge="r" />
    </div>
  );
});
