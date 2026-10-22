import type { Clip, Project } from '../types';
import { propAt } from './props';

/** Whether a track's audio is audible given mute/solo state. */
export function trackAudible(p: Project, trackId: string): number {
  const tr = p.tracks.find((t) => t.id === trackId);
  if (!tr || tr.muted) return 0;
  const anySolo = p.tracks.some((t) => t.type === 'audio' && t.solo);
  if (anySolo && !(tr.type === 'audio' && tr.solo)) return 0;
  return tr.volume;
}

/** Linear gain of a clip's audio at clip-local time, including fades and track state. */
export function clipGain(p: Project, c: Clip, lt: number): number {
  if (c.kind === 'video' && c.muted) return 0;
  if (lt < 0 || lt > c.dur) return 0;
  let g = propAt(c, 'volume', lt) / 100;
  const fi = c.props.fadeIn ?? 0;
  const fo = c.props.fadeOut ?? 0;
  if (fi > 0 && lt < fi) g *= lt / fi;
  if (fo > 0 && c.dur - lt < fo) g *= Math.max(0, (c.dur - lt) / fo);
  return g * trackAudible(p, c.trackId);
}

export function clipPan(c: Clip, lt: number): number {
  return Math.max(-1, Math.min(1, propAt(c, 'pan', lt) / 100));
}

export const hasAudio = (p: Project, c: Clip) =>
  c.kind === 'audio' || (c.kind === 'video' && !!p.media.find((m) => m.id === c.mediaId)?.hasAudio);
