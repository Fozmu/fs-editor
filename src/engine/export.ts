import {
  ALL_FORMATS,
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  StreamTarget,
  WebMOutputFormat,
  type Quality,
  type StreamTargetChunk,
  type WrappedCanvas,
} from 'mediabunny';
import type { Clip, Project } from '../types';
import { desktop, type FfmpegCodec } from '../desktop';
import { clipGain, clipPan, hasAudio } from './audio';
import { getAudioBuffer, getEntry, mbSource, type MediaEntry } from './media';
import { clipEnd, projectDuration, visualLayersAt } from './project';
import { fontString, renderFrame, type Source, type SourceProvider } from './render';

/** mp4/webm: WebCodecs (browser + desktop). The rest: native ffmpeg (desktop only). */
export type ExportFormat = 'mp4' | 'webm' | 'prores' | 'h265' | 'h264x' | 'gif';

export const FORMAT_INFO: Record<ExportFormat, { label: string; ext: string; desktop?: boolean; audio: boolean; ffmpeg?: FfmpegCodec }> = {
  mp4: { label: 'MP4 · H.264', ext: 'mp4', audio: true },
  webm: { label: 'WebM · VP9', ext: 'webm', audio: true },
  h264x: { label: 'MP4 · x264 HQ', ext: 'mp4', desktop: true, audio: true, ffmpeg: 'h264' },
  h265: { label: 'MP4 · H.265', ext: 'mp4', desktop: true, audio: true, ffmpeg: 'h265' },
  prores: { label: 'MOV · ProRes 422 HQ', ext: 'mov', desktop: true, audio: true, ffmpeg: 'prores' },
  gif: { label: 'GIF', ext: 'gif', desktop: true, audio: false, ffmpeg: 'gif' },
};

export interface ExportSettings {
  format: ExportFormat;
  scale: number;
  fps: number;
  quality: 'low' | 'medium' | 'high' | 'very_high';
  range: 'all' | 'inout';
  audio: boolean;
}

export interface ExportProgress {
  stage: string;
  frac: number;
  eta?: number;
}

const QUALITIES: Record<ExportSettings['quality'], Quality> = {
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  very_high: QUALITY_VERY_HIGH,
};

const SAMPLE_RATE = 48000;

export function exportRange(p: Project, s: Pick<ExportSettings, 'range'>): [number, number] {
  const dur = projectDuration(p);
  if (s.range === 'inout') return [p.inPoint ?? 0, p.outPoint ?? dur];
  return [0, dur];
}

export function exportSize(p: Project, scale: number): [number, number] {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return [even(p.width * scale), even(p.height * scale)];
}

/* ---------------- video frame sources ---------------- */

interface ClipDecoder {
  next(): Promise<Source | null>;
  close(): void;
}

async function makeSinkDecoder(entry: MediaEntry, times: number[], maxW: number, maxH: number): Promise<ClipDecoder | null> {
  const input = new Input({ source: mbSource(entry), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) {
    input.dispose();
    return null;
  }
  const dw = track.displayWidth;
  const dh = track.displayHeight;
  const s = Math.min(1, Math.max(maxW / dw, maxH / dh));
  const sink = new CanvasSink(track, { width: Math.round(dw * s), height: Math.round(dh * s), fit: 'fill', poolSize: 3 });
  const gen = sink.canvasesAtTimestamps(times);
  let last: WrappedCanvas | null = null;
  return {
    async next() {
      const r = await gen.next();
      if (!r.done && r.value) last = r.value;
      return last ? last.canvas : null;
    },
    close() {
      gen.return(undefined).catch(() => {});
      input.dispose();
    },
  };
}

/** Slow fallback for codecs WebCodecs can't decode but the <video> element can. */
function makeElementDecoder(url: string, times: number[]): ClipDecoder {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  let i = 0;
  const ready = new Promise((r) => (v.onloadeddata = r));
  return {
    async next() {
      await ready;
      const t = times[i++];
      if (t === undefined) return v;
      if (Math.abs(v.currentTime - t) > 1e-3) {
        v.currentTime = t;
        await new Promise((r) => (v.onseeked = r));
      }
      return v;
    },
    close() {
      v.removeAttribute('src');
      v.load();
    },
  };
}

/* ---------------- audio mixdown ---------------- */

async function mixAudio(p: Project, t0: number, t1: number, onProgress: (f: number) => void): Promise<AudioBuffer | null> {
  const clips = p.clips.filter((c) => hasAudio(p, c) && !(c.kind === 'video' && c.muted) && clipEnd(c) > t0 && c.start < t1 && c.mediaId);
  if (!clips.length) return null;
  const len = Math.max(1, Math.ceil((t1 - t0) * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(2, len, SAMPLE_RATE);
  let done = 0;
  for (const c of clips) {
    const buf = await getAudioBuffer(c.mediaId!);
    onProgress(++done / clips.length);
    if (!buf) continue;
    const cs = Math.max(c.start, t0);
    const ce = Math.min(clipEnd(c), t1);
    if (ce <= cs) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = c.speed;
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    src.connect(gain).connect(pan).connect(ctx.destination);
    const when = cs - t0;
    const step = 1 / 60;
    gain.gain.setValueAtTime(clipGain(p, c, cs - c.start), when);
    pan.pan.setValueAtTime(clipPan(c, cs - c.start), when);
    for (let tt = cs + step; tt < ce + step; tt += step) {
      const te = Math.min(tt, ce);
      gain.gain.linearRampToValueAtTime(clipGain(p, c, te - c.start), te - t0);
      pan.pan.linearRampToValueAtTime(clipPan(c, te - c.start), te - t0);
    }
    const offset = c.in + (cs - c.start) * c.speed;
    if (offset >= buf.duration) continue;
    src.start(when, offset, (ce - cs) * c.speed);
  }
  return ctx.startRendering();
}

function sliceBuffer(buf: AudioBuffer, from: number, to: number): AudioBuffer {
  const n = Math.max(1, to - from);
  const out = new AudioBuffer({ length: n, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(from, to), c);
  return out;
}

/* ---------------- main ---------------- */

/** Where the encoded file goes. */
export type ExportTarget = { kind: 'download' } | { kind: 'handle'; handle: FileSystemFileHandle } | { kind: 'path'; path: string };

export async function pickSaveFile(name: string, format: ExportFormat): Promise<ExportTarget | null> {
  const info = FORMAT_INFO[format];
  if (desktop) {
    const path = await desktop.saveExportDialog({ name, ext: info.ext, label: info.label });
    return path ? { kind: 'path', path } : null;
  }
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> };
  if (!w.showSaveFilePicker) return { kind: 'download' };
  try {
    const handle = await w.showSaveFilePicker({
      suggestedName: `${name}.${info.ext}`,
      types: [{ description: info.label, accept: { [format === 'webm' ? 'video/webm' : 'video/mp4']: ['.' + info.ext] } }],
    });
    return { kind: 'handle', handle };
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    return { kind: 'download' };
  }
}

/** A writable stream that writes positioned chunks to a local file through the desktop bridge. */
async function desktopWritable(path: string): Promise<{ stream: WritableStream<StreamTargetChunk>; abort: () => Promise<void> }> {
  const d = desktop!;
  const id = await d.fileOpen(path);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await d.fileClose(id);
  };
  return {
    stream: new WritableStream<StreamTargetChunk>({
      write: (c) => d.fileWrite(id, c.position, c.data),
      close,
    }),
    abort: async () => {
      await close();
      await d.fileRemove(path);
    },
  };
}

interface Plan {
  t0: number;
  t1: number;
  W: number;
  H: number;
  fps: number;
  frames: number;
}

async function prepare(p: Project, s: ExportSettings, onProgress: (pr: ExportProgress) => void): Promise<Plan> {
  const [t0, t1] = exportRange(p, s);
  if (t1 - t0 <= 0) throw new Error('Nothing to export — the timeline (or In/Out range) is empty.');
  const [W, H] = exportSize(p, s.scale);
  onProgress({ stage: 'Preparing fonts', frac: 0 });
  await document.fonts.ready;
  await Promise.all(
    p.clips.filter((c) => c.kind === 'text' && c.text).map((c) => document.fonts.load(fontString(c.text!), c.text!.content).catch(() => [])),
  );
  return { t0, t1, W, H, fps: s.fps, frames: Math.max(1, Math.round((t1 - t0) * s.fps)) };
}

/**
 * Renders every frame of the range into `ctx` and calls `onFrame` after each one.
 * Video clips are decoded sequentially with WebCodecs (falling back to a seeking <video>).
 */
async function renderLoop(
  p: Project,
  pl: Plan,
  ctx: OffscreenCanvasRenderingContext2D,
  signal: AbortSignal,
  onFrame: (i: number) => Promise<void>,
  onProgress: (pr: ExportProgress) => void,
) {
  const { t0, fps, frames, W, H } = pl;
  // Plan which source timestamps each video clip needs, in frame order.
  const plan = new Map<string, { clip: Clip; times: number[]; last: number }>();
  for (let i = 0; i < frames; i++) {
    const t = t0 + i / fps;
    for (const l of visualLayersAt(p, t)) {
      if (l.clip.kind !== 'video') continue;
      let e = plan.get(l.clip.id);
      if (!e) plan.set(l.clip.id, (e = { clip: l.clip, times: [], last: i }));
      const m = p.media.find((x) => x.id === l.clip.mediaId);
      const maxT = m?.duration ? m.duration - 1e-3 : Infinity;
      e.times.push(Math.min(maxT, Math.max(0, l.clip.in + l.lt * l.clip.speed)));
      e.last = i;
    }
  }

  const decoders = new Map<string, ClipDecoder>();
  const current = new Map<string, Source | null>();
  const provider: SourceProvider = {
    get: (clip) => (clip.kind === 'image' ? (getEntry(clip.mediaId)?.image ?? null) : (current.get(clip.id) ?? null)),
  };
  const started = performance.now();
  try {
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException('Export canceled', 'AbortError');
      const t = t0 + i / fps;
      current.clear();
      for (const l of visualLayersAt(p, t)) {
        const c = l.clip;
        if (c.kind !== 'video') continue;
        let d = decoders.get(c.id);
        if (!d) {
          const entry = getEntry(c.mediaId);
          const cp = plan.get(c.id);
          if (!entry || !cp) continue;
          d = (await makeSinkDecoder(entry, cp.times, W * 1.5, H * 1.5).catch(() => null)) ?? makeElementDecoder(entry.url, cp.times);
          decoders.set(c.id, d);
        }
        current.set(c.id, await d.next());
      }
      renderFrame(ctx, p, t, provider, { outW: W, outH: H });
      await onFrame(i);
      for (const [id, cp] of plan) {
        if (cp.last === i) {
          decoders.get(id)?.close();
          decoders.delete(id);
          plan.delete(id);
        }
      }
      if (i % 3 === 0) {
        const el = (performance.now() - started) / 1000;
        onProgress({ stage: `Rendering frame ${i + 1} / ${frames}`, frac: 0.05 + 0.93 * ((i + 1) / frames), eta: (el / (i + 1)) * (frames - i - 1) });
      }
    }
  } finally {
    for (const d of decoders.values()) d.close();
  }
}

export async function exportVideo(
  p: Project,
  s: ExportSettings,
  onProgress: (pr: ExportProgress) => void,
  signal: AbortSignal,
  dest: ExportTarget,
): Promise<Blob | null> {
  if (FORMAT_INFO[s.format].ffmpeg) {
    if (dest.kind !== 'path') throw new Error('This format needs the desktop app.');
    await exportFfmpeg(p, s, onProgress, signal, dest.path);
    return null;
  }
  const pl = await prepare(p, s, onProgress);
  const { W, H, fps } = pl;
  const streamed = dest.kind !== 'download';
  const format = s.format === 'mp4' ? new Mp4OutputFormat({ fastStart: streamed ? false : 'in-memory' }) : new WebMOutputFormat();
  const quality = QUALITIES[s.quality];
  const vPrefs = s.format === 'mp4' ? (['avc', 'hevc', 'av1', 'vp9'] as const) : (['vp9', 'av1', 'vp8'] as const);
  const videoCodec = await getFirstEncodableVideoCodec(
    vPrefs.filter((c) => format.getSupportedVideoCodecs().includes(c)),
    { width: W, height: H, quality },
  );
  if (!videoCodec) throw new Error(`This browser can't encode ${s.format.toUpperCase()} video at ${W}×${H}. Try WebM or a lower resolution.`);

  let audio: AudioBuffer | null = null;
  let audioCodec = null;
  if (s.audio) {
    const aPrefs = s.format === 'mp4' ? (['aac', 'opus'] as const) : (['opus', 'vorbis'] as const);
    audioCodec = await getFirstEncodableAudioCodec(
      aPrefs.filter((c) => format.getSupportedAudioCodecs().includes(c)),
      { numberOfChannels: 2, sampleRate: SAMPLE_RATE, quality },
    );
    if (audioCodec) {
      onProgress({ stage: 'Mixing audio', frac: 0 });
      audio = await mixAudio(p, pl.t0, pl.t1, (f) => onProgress({ stage: 'Mixing audio', frac: f * 0.05 }));
    }
  }

  let abortDest: () => Promise<void> = async () => {};
  let target: BufferTarget | StreamTarget;
  if (dest.kind === 'handle') {
    const writable = await dest.handle.createWritable();
    abortDest = () => writable.abort();
    target = new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>, { chunked: true });
  } else if (dest.kind === 'path') {
    const w = await desktopWritable(dest.path);
    abortDest = w.abort;
    target = new StreamTarget(w.stream, { chunked: true });
  } else target = new BufferTarget();

  const output = new Output({ format, target });
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const vsrc = new CanvasSource(canvas, { codec: videoCodec, bitrate: quality, keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: fps });
  let asrc: AudioBufferSource | null = null;
  if (audio && audioCodec) {
    asrc = new AudioBufferSource({ codec: audioCodec, bitrate: quality });
    output.addAudioTrack(asrc);
  }
  await output.start();

  let audioPos = 0;
  const audioChunk = SAMPLE_RATE; // 1s
  const pushAudio = async (upTo: number) => {
    if (!asrc || !audio) return;
    while (audioPos < upTo) {
      const to = Math.min(audio.length, audioPos + audioChunk);
      await asrc.add(sliceBuffer(audio, audioPos, to));
      audioPos = to;
    }
  };
  try {
    await renderLoop(
      p,
      pl,
      ctx,
      signal,
      async (i) => {
        await vsrc.add(i / fps, 1 / fps);
        if (audio) await pushAudio(Math.min(audio.length, Math.ceil(((i + 1) / fps) * SAMPLE_RATE) + audioChunk));
      },
      onProgress,
    );
    if (audio) await pushAudio(audio.length);
    onProgress({ stage: 'Finalizing', frac: 0.99 });
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    await abortDest().catch(() => {});
    throw e;
  }
  onProgress({ stage: 'Done', frac: 1 });
  if (target instanceof BufferTarget) return new Blob([target.buffer!], { type: format.mimeType });
  return null;
}

/** Desktop: renders frames and pipes raw RGBA into a native ffmpeg encoder. */
async function exportFfmpeg(p: Project, s: ExportSettings, onProgress: (pr: ExportProgress) => void, signal: AbortSignal, path: string) {
  const d = desktop;
  const info = FORMAT_INFO[s.format];
  if (!d || !info.ffmpeg) throw new Error('This format needs the desktop app.');
  const pl = await prepare(p, s, onProgress);
  let wav: Uint8Array | undefined;
  if (s.audio && info.audio) {
    onProgress({ stage: 'Mixing audio', frac: 0 });
    const mix = await mixAudio(p, pl.t0, pl.t1, (f) => onProgress({ stage: 'Mixing audio', frac: f * 0.05 }));
    if (mix) wav = encodeWav(mix);
  }
  const job = await d.exportStart({ path, width: pl.W, height: pl.H, fps: pl.fps, codec: info.ffmpeg, audioWav: wav });
  const canvas = new OffscreenCanvas(pl.W, pl.H);
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
  try {
    await renderLoop(p, pl, ctx, signal, async () => {
      const img = ctx.getImageData(0, 0, pl.W, pl.H);
      await d.exportFrame(job, new Uint8Array(img.data.buffer));
    }, onProgress);
    onProgress({ stage: 'Finalizing', frac: 0.99 });
    await d.exportEnd(job);
  } catch (e) {
    await d.exportEnd(job, true).catch(() => {});
    await d.fileRemove(path).catch(() => {});
    throw e;
  }
  onProgress({ stage: 'Done', frac: 1 });
}

/** 16-bit PCM WAV. */
export function encodeWav(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, t: string) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(out.buffer);
}
