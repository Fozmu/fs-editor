export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  mime: string;
  size: number;
  /** Seconds. Images use 0 (unbounded). */
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  addedAt: number;
  /** Desktop: absolute path of the original file (media is referenced, not copied). */
  path?: string;
  /** Desktop: edit-friendly transcode used when Chromium can't decode the original. */
  proxyPath?: string;
}

export type ClipKind = 'video' | 'audio' | 'image' | 'text' | 'solid' | 'adjust';
export type TrackType = 'video' | 'audio';

export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';

export interface Keyframe {
  /** Seconds relative to clip start. */
  t: number;
  v: number;
  ease: Ease;
}

export type TransitionType =
  | 'none'
  | 'fade'
  | 'crossDissolve'
  | 'dipBlack'
  | 'dipWhite'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'pushLeft'
  | 'zoomIn'
  | 'zoomOut'
  | 'wipeLeft'
  | 'wipeRight'
  | 'wipeUp'
  | 'wipeDown'
  | 'iris'
  | 'blur'
  | 'spin'
  | 'typewriter';

export interface Transition {
  type: TransitionType;
  dur: number;
}

export interface TextStyle {
  content: string;
  font: string;
  size: number;
  weight: number;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
  boxEnabled: boolean;
  boxColor: string;
  boxPadding: number;
  boxRadius: number;
  uppercase: boolean;
}

export type FitMode = 'fit' | 'fill' | 'stretch' | 'none';

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface Clip {
  id: string;
  kind: ClipKind;
  trackId: string;
  name: string;
  /** Timeline position, seconds. */
  start: number;
  /** Timeline duration, seconds. */
  dur: number;
  /** Source in-point, seconds (media clips). */
  in: number;
  mediaId?: string;
  speed: number;
  /** Mutes embedded audio of video clips. */
  muted: boolean;
  props: Record<string, number>;
  keys: Record<string, Keyframe[]>;
  blend: BlendMode;
  flipH: boolean;
  flipV: boolean;
  fit: FitMode;
  transIn: Transition;
  transOut: Transition;
  text?: TextStyle;
  color?: string;
  label?: string;
}

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  hidden: boolean;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  volume: number;
  height: number;
}

export interface Marker {
  id: string;
  t: number;
  label: string;
  color: string;
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  bg: string;
  /** Ordered: video tracks (index 0 = V1, bottom layer) then audio tracks. */
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  media: MediaItem[];
  inPoint: number | null;
  outPoint: number | null;
  createdAt: number;
  updatedAt: number;
  /** Desktop: where this project was last saved as a .fsproj file. */
  filePath?: string;
}
