import type { Clip, ClipKind, Ease, Keyframe, TextStyle, Transition } from '../types';

export interface PropDef {
  key: string;
  label: string;
  group: 'transform' | 'crop' | 'color' | 'effects' | 'audio';
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  /** Soft slider range; number input allows min..max. */
  sliderMin?: number;
  sliderMax?: number;
}

export const PROP_DEFS: PropDef[] = [
  { key: 'x', label: 'Position X', group: 'transform', min: -20000, max: 20000, step: 1, def: 0, unit: 'px', sliderMin: -2000, sliderMax: 2000 },
  { key: 'y', label: 'Position Y', group: 'transform', min: -20000, max: 20000, step: 1, def: 0, unit: 'px', sliderMin: -2000, sliderMax: 2000 },
  { key: 'scale', label: 'Scale', group: 'transform', min: 0, max: 2000, step: 0.1, def: 100, unit: '%', sliderMax: 400 },
  { key: 'scaleX', label: 'Width', group: 'transform', min: 0, max: 2000, step: 0.1, def: 100, unit: '%', sliderMax: 400 },
  { key: 'scaleY', label: 'Height', group: 'transform', min: 0, max: 2000, step: 0.1, def: 100, unit: '%', sliderMax: 400 },
  { key: 'rotation', label: 'Rotation', group: 'transform', min: -3600, max: 3600, step: 0.1, def: 0, unit: '°', sliderMin: -180, sliderMax: 180 },
  { key: 'opacity', label: 'Opacity', group: 'transform', min: 0, max: 100, step: 0.1, def: 100, unit: '%' },

  { key: 'cropL', label: 'Crop Left', group: 'crop', min: 0, max: 100, step: 0.1, def: 0, unit: '%' },
  { key: 'cropR', label: 'Crop Right', group: 'crop', min: 0, max: 100, step: 0.1, def: 0, unit: '%' },
  { key: 'cropT', label: 'Crop Top', group: 'crop', min: 0, max: 100, step: 0.1, def: 0, unit: '%' },
  { key: 'cropB', label: 'Crop Bottom', group: 'crop', min: 0, max: 100, step: 0.1, def: 0, unit: '%' },
  { key: 'radius', label: 'Corner Radius', group: 'crop', min: 0, max: 2000, step: 1, def: 0, unit: 'px', sliderMax: 400 },
  { key: 'border', label: 'Border', group: 'crop', min: 0, max: 400, step: 1, def: 0, unit: 'px', sliderMax: 60 },

  { key: 'brightness', label: 'Brightness', group: 'color', min: 0, max: 300, step: 1, def: 100, unit: '%', sliderMax: 200 },
  { key: 'contrast', label: 'Contrast', group: 'color', min: 0, max: 300, step: 1, def: 100, unit: '%', sliderMax: 200 },
  { key: 'saturation', label: 'Saturation', group: 'color', min: 0, max: 400, step: 1, def: 100, unit: '%', sliderMax: 250 },
  { key: 'hue', label: 'Hue', group: 'color', min: -180, max: 180, step: 1, def: 0, unit: '°' },
  { key: 'temperature', label: 'Temperature', group: 'color', min: -100, max: 100, step: 1, def: 0 },
  { key: 'tint', label: 'Tint', group: 'color', min: -100, max: 100, step: 1, def: 0 },
  { key: 'grayscale', label: 'Black & White', group: 'color', min: 0, max: 100, step: 1, def: 0, unit: '%' },
  { key: 'sepia', label: 'Sepia', group: 'color', min: 0, max: 100, step: 1, def: 0, unit: '%' },
  { key: 'invert', label: 'Invert', group: 'color', min: 0, max: 100, step: 1, def: 0, unit: '%' },

  { key: 'blur', label: 'Gaussian Blur', group: 'effects', min: 0, max: 200, step: 0.5, def: 0, unit: 'px', sliderMax: 60 },
  { key: 'vignette', label: 'Vignette', group: 'effects', min: 0, max: 100, step: 1, def: 0, unit: '%' },
  { key: 'shadow', label: 'Drop Shadow', group: 'effects', min: 0, max: 200, step: 1, def: 0, unit: 'px', sliderMax: 80 },

  { key: 'volume', label: 'Volume', group: 'audio', min: 0, max: 400, step: 1, def: 100, unit: '%', sliderMax: 200 },
  { key: 'pan', label: 'Pan', group: 'audio', min: -100, max: 100, step: 1, def: 0 },
  { key: 'fadeIn', label: 'Fade In', group: 'audio', min: 0, max: 60, step: 0.05, def: 0, unit: 's', sliderMax: 5 },
  { key: 'fadeOut', label: 'Fade Out', group: 'audio', min: 0, max: 60, step: 0.05, def: 0, unit: 's', sliderMax: 5 },
];

export const PROP_MAP: Record<string, PropDef> = Object.fromEntries(PROP_DEFS.map((d) => [d.key, d]));

/** Props keyed together by the viewer's keyframe button (InShot-style). */
export const MOTION_KEYS = ['x', 'y', 'scale', 'rotation', 'opacity'];

/** Props whose keyframes are not supported (durations). */
export const STATIC_PROPS = new Set(['fadeIn', 'fadeOut']);

export function groupsFor(kind: ClipKind): PropDef['group'][] {
  switch (kind) {
    case 'video':
      return ['transform', 'crop', 'color', 'effects', 'audio'];
    case 'audio':
      return ['audio'];
    case 'adjust':
      return ['color', 'effects'];
    case 'solid':
      return ['transform', 'crop', 'effects'];
    default:
      return ['transform', 'crop', 'color', 'effects'];
  }
}

export const NO_TRANSITION: Transition = { type: 'none', dur: 0.5 };

export const DEFAULT_TEXT: TextStyle = {
  content: 'Your Title',
  font: 'Inter',
  size: 120,
  weight: 800,
  italic: false,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.15,
  letterSpacing: 0,
  strokeColor: '#000000',
  strokeWidth: 0,
  shadowColor: 'rgba(0,0,0,0.6)',
  shadowBlur: 0,
  shadowX: 0,
  shadowY: 4,
  boxEnabled: false,
  boxColor: 'rgba(0,0,0,0.65)',
  boxPadding: 24,
  boxRadius: 12,
  uppercase: false,
};

function applyEase(p: number, ease: Ease): number {
  switch (ease) {
    case 'easeIn':
      return p * p * p;
    case 'easeOut':
      return 1 - Math.pow(1 - p, 3);
    case 'easeInOut':
      return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    case 'hold':
      return 0;
    default:
      return p;
  }
}

export function interpKeys(keys: Keyframe[], t: number): number {
  if (keys.length === 1 || t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const p = span <= 0 ? 1 : (t - a.t) / span;
      return a.v + (b.v - a.v) * applyEase(p, a.ease);
    }
  }
  return last.v;
}

/** Value of a prop at clip-local time `lt` (seconds since clip start). */
export function propAt(clip: Clip, key: string, lt: number): number {
  const ks = clip.keys[key];
  if (ks && ks.length) return interpKeys(ks, lt);
  const v = clip.props[key];
  return v === undefined ? (PROP_MAP[key]?.def ?? 0) : v;
}

export function easeInOut(p: number) {
  return applyEase(Math.min(1, Math.max(0, p)), 'easeInOut');
}
