import { produce } from 'immer';
import { create } from 'zustand';
import type { Clip, ClipKind, Ease, Keyframe, MediaItem, Project, Track, TrackType } from './types';
import {
  clearRange,
  clipEnd,
  clone,
  clipFromMedia,
  EPS,
  makeClip,
  makeTrack,
  newProject,
  projectDuration,
  snapFrame,
  splitClip,
  uid,
} from './engine/project';
import { MOTION_KEYS, PROP_MAP, propAt } from './engine/props';

export type Tool = 'select' | 'razor' | 'ripple' | 'slip';

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  gestureBase: Project | null;

  selection: string[];
  selectedMedia: string | null;
  playhead: number;
  playing: boolean;
  loop: boolean;
  zoom: number;
  tool: Tool;
  snapping: boolean;
  clipboard: Clip[];
  dialog: null | 'export' | 'settings' | 'projects' | 'shortcuts' | 'tour' | 'whatsnew';
  toasts: Toast[];

  edit: (fn: (p: Project) => void, history?: boolean) => void;
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  loadProject: (p: Project) => void;

  setPlayhead: (t: number) => void;
  setPlaying: (b: boolean) => void;
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  set: (patch: Partial<State>) => void;
  toast: (text: string, kind?: Toast['kind']) => void;

  addMedia: (items: MediaItem[]) => void;
  removeMedia: (id: string) => void;
  insertMedia: (mediaId: string, trackId?: string, time?: number) => void;
  addGenerated: (kind: ClipKind, patch?: Partial<Clip>) => void;
  splitAtPlayhead: () => void;
  splitAt: (clipId: string, t: number) => void;
  deleteSelected: (ripple?: boolean) => void;
  closeGap: (trackId: string, t: number) => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  detachAudio: (clipId: string) => void;
  updateClip: (id: string, fn: (c: Clip) => void, history?: boolean) => void;
  setProp: (id: string, key: string, value: number, history?: boolean) => void;
  toggleAnimate: (id: string, key: string) => void;
  toggleKeyframeHere: (id: string, key: string) => void;
  /** Adds (or removes) one keyframe for every motion prop at the playhead. */
  toggleMotionKey: (id: string) => void;
  deleteKeysAt: (id: string, t: number) => void;
  setEaseAt: (id: string, t: number, ease: Ease) => void;
  insertPip: (mediaId: string) => void;
  resetProps: (id: string, keys: string[]) => void;
  addTrack: (type: TrackType) => void;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  addMarker: () => void;
  removeMarker: (id: string) => void;
  setIn: () => void;
  setOut: () => void;
  clearInOut: () => void;
  selectAll: () => void;
}

const HISTORY_LIMIT = 200;
let toastId = 0;

/** Finds a track of `type` free over [start,end), preferring `preferred` order. Creates one if needed. */
function findFreeTrack(p: Project, type: TrackType, start: number, end: number, topFirst = false): string {
  let tracks = p.tracks.filter((t) => t.type === type && !t.locked);
  if (topFirst) tracks = [...tracks].reverse();
  for (const t of tracks) {
    const busy = p.clips.some((c) => c.trackId === t.id && c.start < end - EPS && clipEnd(c) > start + EPS);
    if (!busy) return t.id;
  }
  return pushTrack(p, type).id;
}

function pushTrack(p: Project, type: TrackType): Track {
  const n = p.tracks.filter((t) => t.type === type).length + 1;
  const t = makeTrack(type, n);
  if (type === 'video') {
    const lastV = p.tracks.map((x) => x.type).lastIndexOf('video');
    p.tracks.splice(lastV + 1, 0, t);
  } else p.tracks.push(t);
  return t;
}

export type PipCorner = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';

/** Position + scale that puts a clip in a corner of the frame at `size`% of its fitted size. */
export function pipProps(p: Project, c: Clip, corner: PipCorner, size: number) {
  const m = p.media.find((x) => x.id === c.mediaId);
  const sw = m?.width || p.width;
  const sh = m?.height || p.height;
  const fit = Math.min(p.width / sw, p.height / sh);
  const w = sw * fit * (size / 100);
  const h = sh * fit * (size / 100);
  const margin = Math.round(Math.min(p.width, p.height) * 0.04);
  const col = { l: -1, c: 0, r: 1 }[corner[1] as 'l' | 'c' | 'r'];
  const row = { t: -1, m: 0, b: 1 }[corner[0] as 't' | 'm' | 'b'];
  return {
    scale: size,
    x: Math.round(col * (p.width / 2 - w / 2 - margin)),
    y: Math.round(row * (p.height / 2 - h / 2 - margin)),
  };
}

export const useStore = create<State>((set, get) => ({
  project: newProject(),
  past: [],
  future: [],
  gestureBase: null,
  selection: [],
  selectedMedia: null,
  playhead: 0,
  playing: false,
  loop: false,
  zoom: 80,
  tool: 'select',
  snapping: true,
  clipboard: [],
  dialog: null,
  toasts: [],

  edit: (fn, history = true) => {
    const { project, past, gestureBase } = get();
    const next = produce(project, (d) => {
      fn(d);
      d.updatedAt = Date.now();
    });
    if (next === project) return;
    if (history && !gestureBase) set({ project: next, past: [...past.slice(-HISTORY_LIMIT), project], future: [] });
    else set({ project: next });
  },
  beginGesture: () => set({ gestureBase: get().project }),
  endGesture: () => {
    const { gestureBase, project, past } = get();
    if (gestureBase && gestureBase !== project) set({ past: [...past.slice(-HISTORY_LIMIT), gestureBase], future: [], gestureBase: null });
    else set({ gestureBase: null });
  },
  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future] });
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project] });
  },
  loadProject: (p) => set({ project: p, past: [], future: [], selection: [], playhead: 0, playing: false, selectedMedia: null }),

  setPlayhead: (t) => {
    const p = get().project;
    set({ playhead: Math.max(0, snapFrame(t, p.fps)) });
  },
  setPlaying: (b) => set({ playing: b }),
  select: (ids) => set({ selection: ids }),
  toggleSelect: (id) => {
    const s = get().selection;
    set({ selection: s.includes(id) ? s.filter((x) => x !== id) : [...s, id] });
  },
  set: (patch) => set(patch),
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 6000 : 3000);
  },

  addMedia: (items) =>
    get().edit((p) => {
      p.media.push(...items);
    }),
  removeMedia: (id) => {
    get().edit((p) => {
      p.media = p.media.filter((m) => m.id !== id);
      p.clips = p.clips.filter((c) => c.mediaId !== id);
    });
    set({ selectedMedia: null, selection: [] });
  },
  insertMedia: (mediaId, trackId, time) => {
    const { project, playhead } = get();
    const m = project.media.find((x) => x.id === mediaId);
    if (!m) return;
    const t = time ?? playhead;
    let newId = '';
    get().edit((p) => {
      const type: TrackType = m.kind === 'audio' ? 'audio' : 'video';
      const probe = clipFromMedia(m, '', t);
      const tid = trackId ?? findFreeTrack(p, type, t, t + probe.dur);
      const c = clipFromMedia(m, tid, t);
      if (m.kind === 'image') c.dur = 5;
      clearRange(p, tid, c.start, clipEnd(c), new Set());
      p.clips.push(c);
      newId = c.id;
      // Auto-match sequence settings to first video like Premiere does.
      if (m.kind === 'video' && p.clips.filter((x) => x.kind === 'video').length === 1 && m.width && m.height && p.clips.length === 1) {
        p.width = m.width - (m.width % 2);
        p.height = m.height - (m.height % 2);
      }
    });
    set({ selection: [newId] });
  },
  addGenerated: (kind, patch) => {
    const { playhead } = get();
    let newId = '';
    get().edit((p) => {
      const dur = 5;
      const tid = findFreeTrack(p, 'video', playhead, playhead + dur, kind === 'text' || kind === 'adjust');
      const c = makeClip(kind, tid, playhead, dur, patch);
      p.clips.push(c);
      newId = c.id;
    });
    set({ selection: [newId] });
  },
  splitAtPlayhead: () => {
    const { project, playhead, selection } = get();
    const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id));
    const under = project.clips.filter((c) => !locked.has(c.trackId) && playhead > c.start + EPS && playhead < clipEnd(c) - EPS);
    const targets = selection.length ? under.filter((c) => selection.includes(c.id)) : under;
    const ids = new Set((targets.length ? targets : under).map((c) => c.id));
    if (!ids.size) return;
    get().edit((p) => {
      const add: Clip[] = [];
      for (const c of p.clips) {
        if (!ids.has(c.id)) continue;
        const r = splitClip(c, playhead);
        if (r) add.push(r);
      }
      p.clips.push(...add);
    });
  },
  splitAt: (clipId, t) =>
    get().edit((p) => {
      const c = p.clips.find((x) => x.id === clipId);
      if (!c) return;
      const r = splitClip(c, snapFrame(t, p.fps));
      if (r) p.clips.push(r);
    }),
  deleteSelected: (ripple = false) => {
    const { selection, project } = get();
    if (!selection.length) return;
    const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id));
    get().edit((p) => {
      const removed = p.clips.filter((c) => selection.includes(c.id) && !locked.has(c.trackId));
      p.clips = p.clips.filter((c) => !removed.includes(c));
      if (ripple) {
        // Shift later clips on the same tracks left by removed duration.
        const sorted = [...removed].sort((a, b) => b.start - a.start);
        for (const r of sorted) {
          for (const c of p.clips) {
            if (c.trackId === r.trackId && c.start >= clipEnd(r) - EPS) c.start -= r.dur;
          }
        }
      }
    });
    set({ selection: [] });
  },
  closeGap: (trackId, t) =>
    get().edit((p) => {
      const onTrack = p.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
      const before = onTrack.filter((c) => clipEnd(c) <= t + EPS);
      const after = onTrack.filter((c) => c.start >= t - EPS);
      if (!after.length) return;
      const gapStart = before.length ? Math.max(...before.map(clipEnd)) : 0;
      const shift = after[0].start - gapStart;
      if (shift <= EPS) return;
      for (const c of after) c.start -= shift;
    }),
  copy: () => {
    const { selection, project } = get();
    const clips = project.clips.filter((c) => selection.includes(c.id));
    if (clips.length) {
      set({ clipboard: clone(clips) });
      get().toast(`Copied ${clips.length} clip${clips.length > 1 ? 's' : ''}`);
    }
  },
  paste: () => {
    const { clipboard, playhead } = get();
    if (!clipboard.length) return;
    const minStart = Math.min(...clipboard.map((c) => c.start));
    const ids: string[] = [];
    get().edit((p) => {
      for (const src of clipboard) {
        const c: Clip = { ...clone(src), id: uid(), start: playhead + (src.start - minStart) };
        if (!p.tracks.some((t) => t.id === c.trackId)) c.trackId = findFreeTrack(p, c.kind === 'audio' ? 'audio' : 'video', c.start, clipEnd(c));
        clearRange(p, c.trackId, c.start, clipEnd(c), new Set());
        p.clips.push(c);
        ids.push(c.id);
      }
    });
    set({ selection: ids });
  },
  duplicate: () => {
    const { selection, project } = get();
    const src = project.clips.filter((c) => selection.includes(c.id));
    if (!src.length) return;
    const end = Math.max(...src.map(clipEnd));
    const start = Math.min(...src.map((c) => c.start));
    const ids: string[] = [];
    get().edit((p) => {
      for (const s of src) {
        const c: Clip = { ...clone(s), id: uid(), start: s.start + (end - start) };
        clearRange(p, c.trackId, c.start, clipEnd(c), new Set());
        p.clips.push(c);
        ids.push(c.id);
      }
    });
    set({ selection: ids });
  },
  detachAudio: (clipId) => {
    let newId = '';
    get().edit((p) => {
      const v = p.clips.find((c) => c.id === clipId);
      if (!v || v.kind !== 'video') return;
      const tid = findFreeTrack(p, 'audio', v.start, clipEnd(v));
      const a = makeClip('audio', tid, v.start, v.dur, {
        mediaId: v.mediaId,
        name: v.name + ' (audio)',
        in: v.in,
        speed: v.speed,
        props: Object.fromEntries(['volume', 'pan', 'fadeIn', 'fadeOut'].filter((k) => k in v.props).map((k) => [k, v.props[k]])),
        keys: Object.fromEntries(['volume', 'pan'].filter((k) => v.keys[k]).map((k) => [k, clone(v.keys[k])])),
      });
      p.clips.push(a);
      v.muted = true;
      newId = a.id;
    });
    if (newId) {
      set({ selection: [newId] });
      get().toast('Audio detached to audio track');
    }
  },
  updateClip: (id, fn, history = true) =>
    get().edit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (c) fn(c);
    }, history),
  setProp: (id, key, value, history = true) => {
    const { playhead } = get();
    get().edit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c) return;
      const def = PROP_MAP[key];
      if (def) value = Math.min(def.max, Math.max(def.min, value));
      const ks = c.keys[key];
      if (ks && ks.length) {
        const lt = Math.min(c.dur, Math.max(0, playhead - c.start));
        const tol = 0.5 / p.fps;
        const hit = ks.find((k) => Math.abs(k.t - lt) < tol);
        if (hit) hit.v = value;
        else {
          // A motion keyframe is a whole pose: pin the other animated motion props here too.
          if (MOTION_KEYS.includes(key))
            for (const k of MOTION_KEYS) {
              const other = c.keys[k];
              if (k === key || !other?.length || other.some((kf) => Math.abs(kf.t - lt) < tol)) continue;
              other.push({ t: lt, v: propAt(c, k, lt), ease: 'linear' });
              other.sort((a, b) => a.t - b.t);
            }
          ks.push({ t: lt, v: value, ease: 'linear' });
          ks.sort((a, b) => a.t - b.t);
        }
      } else c.props[key] = value;
    }, history);
  },
  toggleAnimate: (id, key) => {
    const { playhead } = get();
    get().edit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c) return;
      const lt = Math.min(c.dur, Math.max(0, playhead - c.start));
      const cur = propAt(c, key, lt);
      if (c.keys[key]?.length) {
        delete c.keys[key];
        c.props[key] = cur;
      } else {
        c.keys[key] = [{ t: lt, v: cur, ease: 'linear' }];
      }
    });
  },
  toggleKeyframeHere: (id, key) => {
    const { playhead } = get();
    get().edit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c) return;
      const lt = Math.min(c.dur, Math.max(0, playhead - c.start));
      const cur = propAt(c, key, lt);
      const ks: Keyframe[] = c.keys[key] ?? [];
      const tol = 0.5 / p.fps;
      const idx = ks.findIndex((k) => Math.abs(k.t - lt) < tol);
      if (idx >= 0) ks.splice(idx, 1);
      else {
        ks.push({ t: lt, v: cur, ease: 'linear' });
        ks.sort((a, b) => a.t - b.t);
      }
      if (ks.length) c.keys[key] = ks;
      else {
        delete c.keys[key];
        c.props[key] = cur;
      }
    });
  },
  toggleMotionKey: (id) => {
    const { playhead } = get();
    get().edit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c || c.kind === 'audio') return;
      const lt = Math.min(c.dur, Math.max(0, playhead - c.start));
      const tol = 0.5 / p.fps;
      const keyed = MOTION_KEYS.some((k) => c.keys[k]?.some((kf) => Math.abs(kf.t - lt) < tol));
      for (const k of MOTION_KEYS) {
        const cur = propAt(c, k, lt);
        if (keyed) {
          if (!c.keys[k]) continue;
          const rest = c.keys[k].filter((kf) => Math.abs(kf.t - lt) >= tol);
          if (rest.length) c.keys[k] = rest;
          else {
            delete c.keys[k];
            c.props[k] = cur;
          }
        } else {
          const ks = c.keys[k] ?? [];
          ks.push({ t: lt, v: cur, ease: 'linear' });
          ks.sort((a, b) => a.t - b.t);
          c.keys[k] = ks;
        }
      }
    });
  },
  deleteKeysAt: (id, t) =>
    get().edit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c) return;
      const tol = 0.5 / p.fps;
      for (const k of Object.keys(c.keys)) {
        const v = propAt(c, k, t);
        const rest = c.keys[k].filter((kf) => Math.abs(kf.t - t) >= tol);
        if (rest.length) c.keys[k] = rest;
        else {
          delete c.keys[k];
          c.props[k] = v;
        }
      }
    }),
  setEaseAt: (id, t, ease) =>
    get().edit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c) return;
      const tol = 0.5 / p.fps;
      for (const ks of Object.values(c.keys)) for (const kf of ks) if (Math.abs(kf.t - t) < tol) kf.ease = ease;
    }),
  insertPip: (mediaId) => {
    const { project, playhead } = get();
    const m = project.media.find((x) => x.id === mediaId);
    if (!m || m.kind === 'audio') return;
    let newId = '';
    get().edit((p) => {
      const probe = clipFromMedia(m, '', playhead);
      // Over the main video: the topmost free video track, so the overlay sits above everything.
      const tid = findFreeTrack(p, 'video', playhead, playhead + probe.dur, true);
      const c = clipFromMedia(m, tid, playhead);
      if (m.kind === 'image') c.dur = 5;
      Object.assign(c.props, pipProps(p, c, 'tr', 35), { radius: 24, border: 6, shadow: 20 });
      c.borderColor = '#ffffff';
      p.clips.push(c);
      newId = c.id;
    });
    set({ selection: [newId] });
  },
  resetProps: (id, keys) =>
    get().edit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c) return;
      for (const k of keys) {
        delete c.props[k];
        delete c.keys[k];
      }
    }),
  addTrack: (type) =>
    get().edit((p) => {
      pushTrack(p, type);
    }),
  removeTrack: (id) => {
    const p0 = get().project;
    const tr = p0.tracks.find((t) => t.id === id);
    if (!tr || p0.tracks.filter((t) => t.type === tr.type).length <= 1) {
      get().toast('Keep at least one track of each type', 'error');
      return;
    }
    get().edit((p) => {
      p.tracks = p.tracks.filter((t) => t.id !== id);
      p.clips = p.clips.filter((c) => c.trackId !== id);
      let v = 0;
      let a = 0;
      for (const t of p.tracks) {
        if (/^[VA]\d+$/.test(t.name)) t.name = t.type === 'video' ? `V${++v}` : `A${++a}`;
        else if (t.type === 'video') v++;
        else a++;
      }
    });
  },
  updateTrack: (id, patch) =>
    get().edit((p) => {
      const t = p.tracks.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    }),
  addMarker: () => {
    const { playhead } = get();
    get().edit((p) => {
      if (p.markers.some((m) => Math.abs(m.t - playhead) < 1 / p.fps)) return;
      p.markers.push({ id: uid(), t: playhead, label: `Marker ${p.markers.length + 1}`, color: '#f5c542' });
      p.markers.sort((a, b) => a.t - b.t);
    });
  },
  removeMarker: (id) =>
    get().edit((p) => {
      p.markers = p.markers.filter((m) => m.id !== id);
    }),
  setIn: () => {
    const { playhead } = get();
    get().edit((p) => {
      p.inPoint = playhead;
      if (p.outPoint !== null && p.outPoint <= playhead) p.outPoint = null;
    });
  },
  setOut: () => {
    const { playhead } = get();
    get().edit((p) => {
      p.outPoint = playhead;
      if (p.inPoint !== null && p.inPoint >= playhead) p.inPoint = null;
    });
  },
  clearInOut: () =>
    get().edit((p) => {
      p.inPoint = null;
      p.outPoint = null;
    }),
  selectAll: () => set({ selection: get().project.clips.map((c) => c.id) }),
}));

export const getProjectDuration = () => projectDuration(useStore.getState().project);

// Handy for debugging and automated tests.
(globalThis as unknown as { __fs: typeof useStore }).__fs = useStore;
