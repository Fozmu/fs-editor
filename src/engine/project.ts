import type { Clip, ClipKind, MediaItem, Project, Track, TrackType } from '../types';
import { DEFAULT_TEXT, NO_TRANSITION } from './props';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const EPS = 1e-6;

/** Deep copy that also works on immer drafts (project data is plain JSON). */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function makeTrack(type: TrackType, n: number): Track {
  return {
    id: uid(),
    type,
    name: (type === 'video' ? 'V' : 'A') + n,
    hidden: false,
    muted: false,
    solo: false,
    locked: false,
    volume: 1,
    height: type === 'video' ? 64 : 56,
  };
}

export function newProject(name = 'Untitled Project', width = 1920, height = 1080, fps = 30): Project {
  return {
    id: uid(),
    name,
    width,
    height,
    fps,
    bg: '#000000',
    tracks: [makeTrack('video', 1), makeTrack('video', 2), makeTrack('video', 3), makeTrack('audio', 1), makeTrack('audio', 2), makeTrack('audio', 3)],
    clips: [],
    markers: [],
    media: [],
    inPoint: null,
    outPoint: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function makeClip(kind: ClipKind, trackId: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip {
  return {
    id: uid(),
    kind,
    trackId,
    name: kind === 'text' ? 'Text' : kind === 'solid' ? 'Color Matte' : kind === 'adjust' ? 'Adjustment Layer' : 'Clip',
    start,
    dur,
    in: 0,
    speed: 1,
    muted: false,
    props: {},
    keys: {},
    blend: 'source-over',
    flipH: false,
    flipV: false,
    fit: kind === 'text' ? 'none' : 'fit',
    transIn: { ...NO_TRANSITION },
    transOut: { ...NO_TRANSITION },
    text: kind === 'text' ? { ...DEFAULT_TEXT } : undefined,
    color: kind === 'solid' ? '#7c5cff' : undefined,
    ...extra,
  };
}

export function clipFromMedia(m: MediaItem, trackId: string, start: number): Clip {
  const kind: ClipKind = m.kind;
  const dur = m.kind === 'image' ? 5 : Math.max(0.1, m.duration);
  return makeClip(kind, trackId, start, dur, { mediaId: m.id, name: m.name });
}

export const clipEnd = (c: Clip) => c.start + c.dur;

export function projectDuration(p: Project): number {
  let d = 0;
  for (const c of p.clips) d = Math.max(d, clipEnd(c));
  return d;
}

export function trackKindFor(kind: ClipKind): TrackType {
  return kind === 'audio' ? 'audio' : 'video';
}

/** Max timeline duration a clip can have given its media and in point. */
export function maxDurFor(p: Project, c: Clip): number {
  if (c.kind !== 'video' && c.kind !== 'audio') return Infinity;
  const m = p.media.find((x) => x.id === c.mediaId);
  if (!m || !m.duration) return Infinity;
  return Math.max(0.01, (m.duration - c.in) / c.speed);
}

/** Keyframes are anchored to content, so moving the in-point shifts them. */
function shiftKeys(c: Clip, dt: number) {
  const out: Clip['keys'] = {};
  for (const [k, ks] of Object.entries(c.keys)) out[k] = ks.map((kf) => ({ ...kf, t: kf.t - dt }));
  c.keys = out;
}

/** Trims clip start to a new timeline time (mutates). */
export function trimStartTo(c: Clip, newStart: number) {
  const delta = newStart - c.start;
  c.start = newStart;
  c.dur -= delta;
  if (c.kind === 'video' || c.kind === 'audio') c.in += delta * c.speed;
  shiftKeys(c, delta);
}

/** Splits clip at timeline time t. Mutates `c` to be the left part, returns right part. */
export function splitClip(c: Clip, t: number): Clip | null {
  if (t <= c.start + EPS || t >= clipEnd(c) - EPS) return null;
  const right: Clip = clone(c);
  right.id = uid();
  trimStartTo(right, t);
  right.transIn = { ...NO_TRANSITION };
  c.dur = t - c.start;
  c.transOut = { ...NO_TRANSITION };
  if (c.props.fadeOut) c.props.fadeOut = 0;
  if (right.props.fadeIn) right.props.fadeIn = 0;
  return right;
}

/**
 * Overwrite semantics: clears [start,end) on a track, trimming / splitting / removing other clips.
 * Mutates project.
 */
export function clearRange(p: Project, trackId: string, start: number, end: number, except: Set<string>) {
  const add: Clip[] = [];
  p.clips = p.clips.filter((c) => {
    if (c.trackId !== trackId || except.has(c.id)) return true;
    const ce = clipEnd(c);
    if (ce <= start + EPS || c.start >= end - EPS) return true;
    if (c.start >= start - EPS && ce <= end + EPS) return false;
    if (c.start < start && ce > end) {
      const right = splitClip(c, end);
      c.dur = start - c.start;
      if (right) add.push(right);
      return true;
    }
    if (c.start < start) {
      c.dur = start - c.start;
      return true;
    }
    trimStartTo(c, end);
    return true;
  });
  p.clips.push(...add);
}

export interface ActiveLayer {
  clip: Clip;
  /** Clip-local time (seconds since start), may exceed dur for cross-dissolve tails. */
  lt: number;
  /** Extra opacity multiplier from cross-dissolve. */
  tail?: boolean;
}

/** Previous clip on the same track that ends exactly where `c` starts. */
export function prevAdjacent(p: Project, c: Clip): Clip | undefined {
  return p.clips.find((o) => o.trackId === c.trackId && o.id !== c.id && Math.abs(clipEnd(o) - c.start) < 1 / 240);
}

/** Visual layers at time t, bottom to top. */
export function visualLayersAt(p: Project, t: number): ActiveLayer[] {
  const out: ActiveLayer[] = [];
  const vtracks = p.tracks.filter((tr) => tr.type === 'video');
  for (const tr of vtracks) {
    if (tr.hidden) continue;
    const onTrack = p.clips.filter((c) => c.trackId === tr.id);
    for (const c of onTrack) {
      if (t >= c.start - EPS && t < clipEnd(c) - EPS) {
        if (c.transIn.type === 'crossDissolve' && t < c.start + c.transIn.dur) {
          const prev = prevAdjacent(p, c);
          if (prev) out.push({ clip: prev, lt: t - prev.start, tail: true });
        }
        out.push({ clip: c, lt: t - c.start });
      }
    }
  }
  return out;
}

/** Source media time for a clip at clip-local time. */
export function sourceTime(c: Clip, lt: number) {
  return c.in + lt * c.speed;
}

export function snapPoints(p: Project, playhead: number, exclude: Set<string>): number[] {
  const pts = [0, playhead];
  for (const c of p.clips) {
    if (exclude.has(c.id)) continue;
    pts.push(c.start, clipEnd(c));
  }
  for (const m of p.markers) pts.push(m.t);
  if (p.inPoint !== null) pts.push(p.inPoint);
  if (p.outPoint !== null) pts.push(p.outPoint);
  return pts;
}

export function formatTC(t: number, fps: number): string {
  const neg = t < 0;
  t = Math.abs(t);
  const totalFrames = Math.round(t * fps);
  const f = totalFrames % Math.round(fps);
  const s = Math.floor(totalFrames / Math.round(fps));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${neg ? '-' : ''}${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(f)}`;
}

export function formatShort(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)}s`;
}

export const snapFrame = (t: number, fps: number) => Math.round(t * fps) / fps;
