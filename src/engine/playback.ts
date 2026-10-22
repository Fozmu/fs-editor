import type { Clip, Project } from '../types';
import { useStore } from '../store';
import { clipGain, clipPan, hasAudio } from './audio';
import { getEntry, useMediaVersion } from './media';
import { clipEnd, EPS, prevAdjacent, projectDuration, sourceTime } from './project';
import { renderFrame, type ClipRect, type SourceProvider } from './render';

interface ElState {
  el: HTMLMediaElement;
  mediaId: string;
  gain: GainNode | null;
  pan: StereoPannerNode | null;
  lastSeek: number;
}

/**
 * Real-time preview: keeps one media element per active clip in sync with the
 * playhead, routes its audio through Web Audio for gain/pan, and composites frames.
 */
export class Player {
  private ctx: CanvasRenderingContext2D;
  private els = new Map<string, ElState>();
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private raf = 0;
  private dirty = true;
  private startPerf = 0;
  private startT = 0;
  private unsubs: (() => void)[] = [];
  rects = new Map<string, ClipRect>();
  onRendered: (() => void) | null = null;
  scale = 1;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.unsubs.push(
      useStore.subscribe((s, prev) => {
        if (s.project !== prev.project || s.playhead !== prev.playhead) this.dirty = true;
        if (s.playing !== prev.playing) s.playing ? this.startPlayback() : this.stopPlayback();
      }),
      useMediaVersion.subscribe(() => (this.dirty = true)),
    );
    this.loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.unsubs.forEach((u) => u());
    for (const s of this.els.values()) this.killEl(s);
    this.els.clear();
    this.ac?.close();
  }

  setMasterVolume(v: number) {
    if (this.master) this.master.gain.value = v;
  }

  invalidate() {
    this.dirty = true;
  }

  private ensureAudio() {
    if (!this.ac) {
      this.ac = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ac.createGain();
      this.master.connect(this.ac.destination);
      this.rewireAudio();
    }
    if (this.ac.state === 'suspended') this.ac.resume();
  }

  private startPlayback() {
    this.ensureAudio();
    const s = useStore.getState();
    const p = s.project;
    const end = this.rangeEnd(p);
    let t = s.playhead;
    if (t >= end - 1 / p.fps) t = p.inPoint ?? 0;
    this.startT = t;
    this.startPerf = performance.now();
    if (t !== s.playhead) s.setPlayhead(t);
  }

  private stopPlayback() {
    for (const s of this.els.values()) s.el.pause();
    this.dirty = true;
  }

  private rangeEnd(p: Project) {
    return p.outPoint ?? Math.max(projectDuration(p), 0);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const s = useStore.getState();
    const p = s.project;
    let t = s.playhead;
    if (s.playing) {
      t = this.startT + (performance.now() - this.startPerf) / 1000;
      const end = this.rangeEnd(p);
      if (t >= end) {
        if (s.loop && end > 0) {
          this.startT = p.inPoint ?? 0;
          this.startPerf = performance.now();
          t = this.startT;
        } else {
          t = end;
          s.set({ playing: false });
        }
      }
      useStore.setState({ playhead: t });
    }
    this.sync(p, t, s.playing);
    if (s.playing || this.dirty) {
      this.dirty = false;
      this.draw(p, t);
    }
  };

  private sync(p: Project, t: number, playing: boolean) {
    const needed = new Map<string, { clip: Clip; lt: number; tail: boolean; active: boolean }>();
    for (const c of p.clips) {
      if (c.kind !== 'video' && c.kind !== 'audio') continue;
      if (!c.mediaId || !getEntry(c.mediaId)) continue;
      const active = t >= c.start - EPS && t < clipEnd(c) - EPS;
      const upcoming = !active && c.start > t && c.start - t < 1.5;
      if (active || upcoming) needed.set(c.id, { clip: c, lt: t - c.start, tail: false, active });
      if (active && c.transIn.type === 'crossDissolve' && t - c.start < c.transIn.dur) {
        const prev = prevAdjacent(p, c);
        if (prev && prev.kind === 'video') needed.set(prev.id, { clip: prev, lt: t - prev.start, tail: true, active: true });
      }
    }
    // Drop elements no longer needed.
    for (const [id, st] of this.els) {
      const n = needed.get(id);
      if (!n || n.clip.mediaId !== st.mediaId) {
        this.killEl(st);
        this.els.delete(id);
      }
    }
    for (const [id, n] of needed) {
      let st = this.els.get(id);
      if (!st) {
        const made = this.makeEl(n.clip);
        if (!made) continue;
        st = made;
        this.els.set(id, st);
      }
      const { clip: c, lt, active, tail } = n;
      const el = st.el;
      const media = p.media.find((m) => m.id === c.mediaId);
      const maxT = media?.duration ? media.duration - 0.02 : Infinity;
      const target = Math.min(maxT, Math.max(0, active ? sourceTime(c, lt) : c.in));
      const g = active && !tail && hasAudio(p, c) ? clipGain(p, c, lt) : 0;
      if (st.gain && this.ac) st.gain.gain.setTargetAtTime(g, this.ac.currentTime, 0.015);
      if (st.pan && this.ac) st.pan.pan.setTargetAtTime(clipPan(c, lt), this.ac.currentTime, 0.015);
      if (playing && active) {
        if (el.playbackRate !== c.speed) el.playbackRate = c.speed;
        const drift = Math.abs(el.currentTime - target);
        if (target >= maxT) {
          if (!el.paused) el.pause();
        } else if (el.paused) {
          if (drift > 0.05) el.currentTime = target;
          el.play().catch(() => {});
        } else if (drift > 0.3 && performance.now() - st.lastSeek > 400) {
          el.currentTime = target;
          st.lastSeek = performance.now();
        }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > 0.5 / p.fps && !el.seeking) el.currentTime = target;
      }
    }
  }

  private makeEl(c: Clip): ElState | null {
    const entry = getEntry(c.mediaId);
    if (!entry) return null;
    const el = document.createElement(c.kind === 'audio' ? 'audio' : 'video') as HTMLMediaElement;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    (el as HTMLVideoElement).playsInline = true;
    el.src = entry.url;
    el.addEventListener('seeked', () => (this.dirty = true));
    el.addEventListener('loadeddata', () => (this.dirty = true));
    let gain: GainNode | null = null;
    let pan: StereoPannerNode | null = null;
    if (this.ac && this.master) {
      const srcNode = this.ac.createMediaElementSource(el);
      gain = this.ac.createGain();
      gain.gain.value = 0;
      pan = this.ac.createStereoPanner();
      srcNode.connect(gain).connect(pan).connect(this.master);
    } else {
      // Audio graph not yet created (no user gesture): keep silent until it is.
      el.muted = true;
    }
    return { el, mediaId: c.mediaId!, gain, pan, lastSeek: 0 };
  }

  private killEl(s: ElState) {
    s.el.pause();
    s.el.removeAttribute('src');
    s.el.load();
    s.gain?.disconnect();
    s.pan?.disconnect();
  }

  /** Recreate muted (pre-gesture) elements so they get routed through Web Audio. */
  rewireAudio() {
    for (const [id, s] of this.els) {
      if (!s.gain) {
        this.killEl(s);
        this.els.delete(id);
      }
    }
  }

  private provider: SourceProvider = {
    get: (clip) => {
      if (clip.kind === 'image') return getEntry(clip.mediaId)?.image ?? null;
      const st = this.els.get(clip.id);
      if (!st) return null;
      const v = st.el as HTMLVideoElement;
      // Mid-seek the element still holds its last decoded frame; drawing it avoids black flashes.
      return v.readyState >= 2 || v.videoWidth > 0 ? v : null;
    },
  };

  private draw(p: Project, t: number) {
    const w = Math.max(2, Math.round(p.width * this.scale));
    const h = Math.max(2, Math.round(p.height * this.scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.rects.clear();
    renderFrame(this.ctx, p, t, this.provider, { outW: w, outH: h, rects: this.rects });
    this.onRendered?.();
  }

  /** Renders the current frame at full project resolution. */
  snapshot(): Promise<Blob | null> {
    const s = useStore.getState();
    const c = document.createElement('canvas');
    c.width = s.project.width;
    c.height = s.project.height;
    renderFrame(c.getContext('2d')!, s.project, s.playhead, this.provider, { outW: c.width, outH: c.height });
    return new Promise((r) => c.toBlob(r, 'image/png'));
  }
}
