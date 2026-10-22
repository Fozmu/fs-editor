import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input, UrlSource, type Source as MbSource } from 'mediabunny';
import { create } from 'zustand';
import type { MediaItem, MediaKind } from '../types';
import { desktop, mediaUrl } from '../desktop';
import { useStore } from '../store';
import { uid } from './project';
import { loadMediaBlob, saveMediaBlob } from './storage';

export interface MediaEntry {
  /** Web: the file contents. Desktop: undefined (read from disk via `url`). */
  blob?: Blob;
  url: string;
  image?: HTMLImageElement;
  thumbs?: ImageBitmap[];
  thumbStep?: number;
  peaks?: Float32Array;
  peaksPerSec?: number;
  audio?: Promise<AudioBuffer | null>;
}

const registry = new Map<string, MediaEntry>();

/** Bumps when async derived data (thumbs, waveforms) becomes available so the UI re-renders. */
export const useMediaVersion = create<{
  v: number;
  bump: () => void;
  offline: Record<string, boolean>;
  setOffline: (id: string, off: boolean) => void;
  /** Long-running media job (desktop proxy conversion). */
  busy: { label: string; frac: number } | null;
}>((set) => ({
  v: 0,
  busy: null,
  bump: () => set((s) => ({ v: s.v + 1 })),
  offline: {},
  setOffline: (id, off) => set((s) => ({ offline: { ...s.offline, [id]: off } })),
}));

const bump = () => useMediaVersion.getState().bump();

export const getEntry = (id: string | undefined) => (id ? registry.get(id) : undefined);

/** Fresh mediabunny source for an entry (blob in the browser, ranged reads from disk on desktop). */
export function mbSource(e: MediaEntry): MbSource {
  return e.blob ? new BlobSource(e.blob) : new UrlSource(e.url);
}

const releaseUrl = (url: string) => url.startsWith('blob:') && URL.revokeObjectURL(url);

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|3gp)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

// Containers Chromium can't open natively; on desktop they go through an ffmpeg proxy.
const DESKTOP_VIDEO_EXT = /\.(mts|m2ts|mxf|wmv|flv|mpg|mpeg|vob|ts|dv)$/i;
const DESKTOP_AUDIO_EXT = /\.(aiff?|wma|ac3|amr)$/i;

export function detectKind(f: { name: string; type?: string }): MediaKind | null {
  const type = f.type ?? '';
  if (type.startsWith('video/') || VIDEO_EXT.test(f.name) || (desktop && DESKTOP_VIDEO_EXT.test(f.name))) return 'video';
  if (type.startsWith('audio/') || AUDIO_EXT.test(f.name) || (desktop && DESKTOP_AUDIO_EXT.test(f.name))) return 'audio';
  if (type.startsWith('image/') || IMAGE_EXT.test(f.name)) return 'image';
  return null;
}

function probeElement(url: string, kind: 'video' | 'audio'): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.muted = true;
    const done = () => {
      const d = el.duration;
      const finish = (dur: number) => {
        resolve({ duration: dur, width: (el as HTMLVideoElement).videoWidth || 0, height: (el as HTMLVideoElement).videoHeight || 0 });
        el.removeAttribute('src');
        el.load();
      };
      if (!isFinite(d)) {
        // Some webm files report Infinity until seeked to the end.
        el.currentTime = 1e9;
        el.ontimeupdate = () => {
          el.ontimeupdate = null;
          finish(el.duration);
        };
      } else finish(d);
    };
    el.onloadedmetadata = done;
    el.onerror = () => reject(new Error('Unsupported or corrupt media file'));
    el.src = url;
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unsupported image'));
    img.src = url;
  });
}

async function hasAudioTrack(e: MediaEntry): Promise<boolean> {
  try {
    const input = new Input({ source: mbSource(e), formats: ALL_FORMATS });
    const t = await input.getPrimaryAudioTrack();
    input.dispose();
    return !!t;
  } catch {
    return true;
  }
}

export async function importFile(file: File): Promise<MediaItem> {
  const p = desktop?.pathForFile(file);
  if (p) return importPath(p, file.name, file.size);
  const kind = detectKind(file);
  if (!kind) throw new Error(`Unsupported file type: ${file.name}`);
  const id = uid();
  const url = URL.createObjectURL(file);
  const entry: MediaEntry = { blob: file, url };
  let duration = 0;
  let width = 0;
  let height = 0;
  let hasAudio = false;
  try {
    if (kind === 'image') {
      const img = await loadImage(url);
      entry.image = img;
      width = img.naturalWidth || 1920;
      height = img.naturalHeight || 1080;
    } else {
      const meta = await probeElement(url, kind);
      duration = meta.duration;
      width = meta.width;
      height = meta.height;
      hasAudio = kind === 'audio' ? true : await hasAudioTrack(entry);
    }
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  registry.set(id, entry);
  await saveMediaBlob(id, file);
  const item: MediaItem = {
    id,
    name: file.name,
    kind,
    mime: file.type,
    size: file.size,
    duration,
    width,
    height,
    hasAudio,
    addedAt: Date.now(),
  };
  derive(item);
  return item;
}

/** Restores registry entries from IndexedDB for a loaded project. */
export async function restoreMedia(items: MediaItem[]) {
  for (const m of items) {
    if (registry.has(m.id)) continue;
    if (m.path) {
      await restorePath(m);
      continue;
    }
    const blob = await loadMediaBlob(m.id).catch(() => undefined);
    if (!blob) {
      useMediaVersion.getState().setOffline(m.id, true);
      continue;
    }
    const entry: MediaEntry = { blob, url: URL.createObjectURL(blob) };
    registry.set(m.id, entry);
    if (m.kind === 'image') entry.image = await loadImage(entry.url).catch(() => undefined);
    derive(m);
  }
  bump();
}

/** Re-links an offline media item to a new file. */
export async function relinkMedia(m: MediaItem, file: File) {
  const p = desktop?.pathForFile(file);
  if (p) return relinkPath(m, p);
  const old = registry.get(m.id);
  if (old) releaseUrl(old.url);
  const entry: MediaEntry = { blob: file, url: URL.createObjectURL(file) };
  if (m.kind === 'image') entry.image = await loadImage(entry.url);
  registry.set(m.id, entry);
  await saveMediaBlob(m.id, file);
  useMediaVersion.getState().setOffline(m.id, false);
  derive(m);
  bump();
}

export function forgetMedia(id: string) {
  const e = registry.get(id);
  if (e) releaseUrl(e.url);
  registry.delete(id);
}

/* ---------- derived data: thumbnails & waveforms ---------- */

const queue: (() => Promise<void>)[] = [];
let running = false;
async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift()!;
    try {
      await job();
    } catch (e) {
      console.warn('[media] derive failed', e);
    }
  }
  running = false;
}

function derive(m: MediaItem) {
  if (m.kind === 'video') queue.push(() => makeThumbs(m));
  if (m.kind === 'image') queue.push(() => makeImageThumb(m));
  if (m.hasAudio) queue.push(() => makePeaks(m));
  pump();
}

async function makeImageThumb(m: MediaItem) {
  const e = registry.get(m.id);
  if (!e?.image) return;
  const h = 90;
  const w = Math.max(1, Math.round((m.width / m.height) * h));
  e.thumbs = [await createImageBitmap(e.image, { resizeWidth: w, resizeHeight: h })];
  e.thumbStep = Infinity;
  bump();
}

async function makeThumbs(m: MediaItem) {
  const e = registry.get(m.id);
  if (!e) return;
  const count = Math.min(60, Math.max(6, Math.ceil(m.duration / 2)));
  const step = m.duration / count;
  const times = Array.from({ length: count }, (_, i) => i * step + step / 2);
  const out: ImageBitmap[] = [];
  try {
    const input = new Input({ source: mbSource(e), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error('cannot decode');
    const sink = new CanvasSink(track, { height: 90 });
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (wc) out.push(await createImageBitmap(wc.canvas));
      else if (out.length) out.push(out[out.length - 1]);
    }
    input.dispose();
  } catch {
    // Fallback: seek a video element.
    const v = document.createElement('video');
    v.muted = true;
    v.src = e.url;
    await new Promise((r) => (v.onloadeddata = r));
    for (const t of times) {
      v.currentTime = t;
      await new Promise((r) => (v.onseeked = r));
      out.push(await createImageBitmap(v, { resizeHeight: 90, resizeWidth: Math.round((v.videoWidth / v.videoHeight) * 90) || 160 }));
    }
  }
  e.thumbs = out;
  e.thumbStep = step;
  bump();
}

/** Decodes the whole audio track of a media item (cached). */
export function getAudioBuffer(id: string): Promise<AudioBuffer | null> {
  const e = registry.get(id);
  if (!e) return Promise.resolve(null);
  if (!e.audio) e.audio = decodeAudio(e);
  return e.audio;
}

async function decodeAudio(e: MediaEntry): Promise<AudioBuffer | null> {
  try {
    const input = new Input({ source: mbSource(e), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) throw new Error('cannot decode');
    const sink = new AudioBufferSink(track);
    const chunks: { buffer: AudioBuffer; timestamp: number }[] = [];
    for await (const wb of sink.buffers()) chunks.push(wb);
    input.dispose();
    if (!chunks.length) return null;
    const sr = chunks[0].buffer.sampleRate;
    const ch = Math.min(2, Math.max(...chunks.map((c) => c.buffer.numberOfChannels)));
    const t0 = Math.min(0, chunks[0].timestamp);
    const last = chunks[chunks.length - 1];
    const total = Math.ceil((last.timestamp - t0 + last.buffer.duration) * sr);
    const outBuf = new AudioBuffer({ length: Math.max(1, total), numberOfChannels: ch, sampleRate: sr });
    for (const c of chunks) {
      const off = Math.round((c.timestamp - t0) * sr);
      if (off < 0) continue;
      for (let i = 0; i < ch; i++) {
        const data = c.buffer.getChannelData(Math.min(i, c.buffer.numberOfChannels - 1));
        const room = total - off;
        outBuf.copyToChannel(room < data.length ? data.subarray(0, room) : data, i, off);
      }
    }
    return outBuf;
  } catch {
    try {
      const ac = new OfflineAudioContext(2, 1, 48000);
      const data = e.blob ? await e.blob.arrayBuffer() : await (await fetch(e.url)).arrayBuffer();
      return await ac.decodeAudioData(data);
    } catch {
      return null;
    }
  }
}

async function makePeaks(m: MediaItem) {
  const buf = await getAudioBuffer(m.id);
  const e = registry.get(m.id);
  if (!buf || !e) return;
  const pps = 200;
  const n = Math.ceil(buf.duration * pps);
  const peaks = new Float32Array(n);
  const block = buf.sampleRate / pps;
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  for (let i = 0; i < n; i++) {
    let mx = 0;
    const s0 = Math.floor(i * block);
    const s1 = Math.min(buf.length, Math.floor((i + 1) * block));
    for (const d of chans) for (let s = s0; s < s1; s += 4) {
      const a = Math.abs(d[s]);
      if (a > mx) mx = a;
    }
    peaks[i] = mx;
  }
  e.peaks = peaks;
  e.peaksPerSec = pps;
  bump();
}

/* ---------- desktop: media referenced by path ---------- */

const KIND_FROM_PROBE = (name: string): MediaKind | null => detectKind({ name });

/** Opens a local file for editing; transcodes to a proxy when Chromium can't decode it. */
export async function importPath(path: string, name: string, size: number): Promise<MediaItem> {
  if (!desktop) throw new Error('Desktop only');
  const kind = KIND_FROM_PROBE(name);
  if (!kind) throw new Error(`Unsupported file type: ${name}`);
  const id = uid();
  const item: MediaItem = { id, name, kind, mime: '', size, duration: 0, width: 0, height: 0, hasAudio: false, addedAt: Date.now(), path };
  const entry = await openLocal(item, path);
  registry.set(id, entry);
  derive(item);
  return item;
}

/** Probes a file via <video>/<audio>/<img>, falling back to an ffmpeg proxy. Fills in `item` metadata. */
async function openLocal(item: MediaItem, path: string): Promise<MediaEntry> {
  const d = desktop!;
  const src = item.proxyPath ?? path;
  const url = mediaUrl(src);
  if (item.kind === 'image') {
    const img = await loadImage(url);
    item.width = img.naturalWidth || 1920;
    item.height = img.naturalHeight || 1080;
    return { url, image: img };
  }
  const info = await d.probe(path).catch(() => null);
  try {
    const meta = await probeElement(url, item.kind);
    if (item.kind === 'video' && info?.hasVideo && !meta.width) throw new Error('no video decoder');
    item.duration = meta.duration || info?.duration || 0;
    item.width = meta.width || info?.width || 0;
    item.height = meta.height || info?.height || 0;
    item.hasAudio = item.kind === 'audio' ? true : (info?.hasAudio ?? true);
    return { url };
  } catch {
    if (item.proxyPath) throw new Error(`Can't open ${item.name}`);
    const proxy = await withProgress(`Converting ${item.name}`, (job) => d.proxy(path, job));
    item.proxyPath = proxy;
    return openLocal(item, path);
  }
}

async function withProgress<T>(label: string, fn: (jobId: string) => Promise<T>): Promise<T> {
  const job = uid();
  const st = useMediaVersion.getState();
  const off = desktop!.on('ffmpeg:progress', (p) => {
    if (p.jobId === job) useMediaVersion.setState({ busy: { label, frac: p.frac } });
  });
  useMediaVersion.setState({ busy: { label, frac: 0 } });
  try {
    return await fn(job);
  } finally {
    off();
    useMediaVersion.setState({ busy: null });
    st.bump();
  }
}

async function restorePath(m: MediaItem) {
  const d = desktop;
  if (!d || !m.path || !(await d.stat(m.path)).exists) {
    useMediaVersion.getState().setOffline(m.id, true);
    return;
  }
  if (m.proxyPath && !(await d.stat(m.proxyPath)).exists) delete m.proxyPath;
  try {
    const copy = { ...m };
    registry.set(m.id, await openLocal(copy, m.path));
    useMediaVersion.getState().setOffline(m.id, false);
    syncItem(copy);
    derive(copy);
  } catch {
    useMediaVersion.getState().setOffline(m.id, true);
  }
}

async function relinkPath(m: MediaItem, path: string) {
  const old = registry.get(m.id);
  if (old) releaseUrl(old.url);
  const copy: MediaItem = { ...m, path, proxyPath: undefined };
  registry.set(m.id, await openLocal(copy, path));
  useMediaVersion.getState().setOffline(m.id, false);
  syncItem(copy);
  derive(copy);
  bump();
}

/** Writes refreshed file metadata (path, proxy, size) back into the project without an undo step. */
function syncItem(item: MediaItem) {
  useStore.getState().edit((p) => {
    const m = p.media.find((x) => x.id === item.id);
    if (!m) return;
    if (m.path !== item.path) m.path = item.path;
    if (m.proxyPath !== item.proxyPath) m.proxyPath = item.proxyPath;
    for (const k of ['duration', 'width', 'height', 'hasAudio'] as const) if (item[k] && m[k] !== item[k]) (m as unknown as Record<string, unknown>)[k] = item[k];
  }, false);
}
