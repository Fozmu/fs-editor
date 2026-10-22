import type { BlendMode, TextStyle, TransitionType } from '../types';
import { DEFAULT_TEXT } from './props';

export const COLOR_KEYS = ['brightness', 'contrast', 'saturation', 'hue', 'temperature', 'tint', 'grayscale', 'sepia', 'invert', 'vignette'];

export const COLOR_PRESETS: { name: string; props: Record<string, number>; swatch: string }[] = [
  { name: 'None', props: {}, swatch: 'linear-gradient(135deg,#4a6,#36a)' },
  { name: 'Cinematic', props: { contrast: 115, saturation: 85, temperature: -15, vignette: 35 }, swatch: 'linear-gradient(135deg,#0f3b47,#d68b46)' },
  { name: 'Teal & Orange', props: { contrast: 112, saturation: 120, temperature: 25, tint: -10 }, swatch: 'linear-gradient(135deg,#12737a,#ff8a3d)' },
  { name: 'Vivid', props: { contrast: 110, saturation: 145, brightness: 104 }, swatch: 'linear-gradient(135deg,#ff2d74,#ffd23f)' },
  { name: 'Warm', props: { temperature: 45, saturation: 110 }, swatch: 'linear-gradient(135deg,#f7b267,#f25c54)' },
  { name: 'Cool', props: { temperature: -45, saturation: 95 }, swatch: 'linear-gradient(135deg,#6fb1fc,#4364f7)' },
  { name: 'Black & White', props: { grayscale: 100, contrast: 115 }, swatch: 'linear-gradient(135deg,#eee,#222)' },
  { name: 'Noir', props: { grayscale: 100, contrast: 160, brightness: 90, vignette: 60 }, swatch: 'linear-gradient(135deg,#777,#000)' },
  { name: 'Vintage', props: { sepia: 45, contrast: 90, saturation: 80, brightness: 105, vignette: 40 }, swatch: 'linear-gradient(135deg,#c9a66b,#6b4f2a)' },
  { name: 'Faded', props: { contrast: 78, saturation: 70, brightness: 112 }, swatch: 'linear-gradient(135deg,#c8c2d6,#8f9bb3)' },
  { name: 'Dreamy', props: { brightness: 110, contrast: 90, saturation: 115, tint: 15, blur: 0.6 }, swatch: 'linear-gradient(135deg,#f9c5d1,#9795ef)' },
  { name: 'Matrix', props: { tint: -60, saturation: 120, contrast: 120, brightness: 92 }, swatch: 'linear-gradient(135deg,#0a0,#031)' },
];

export const TRANSITIONS: { type: TransitionType; name: string; textOnly?: boolean }[] = [
  { type: 'none', name: 'None' },
  { type: 'fade', name: 'Fade' },
  { type: 'crossDissolve', name: 'Cross Dissolve' },
  { type: 'dipBlack', name: 'Dip to Black' },
  { type: 'dipWhite', name: 'Dip to White' },
  { type: 'slideLeft', name: 'Slide Left' },
  { type: 'slideRight', name: 'Slide Right' },
  { type: 'slideUp', name: 'Slide Up' },
  { type: 'slideDown', name: 'Slide Down' },
  { type: 'zoomIn', name: 'Zoom In' },
  { type: 'zoomOut', name: 'Zoom Out' },
  { type: 'wipeLeft', name: 'Wipe Left' },
  { type: 'wipeRight', name: 'Wipe Right' },
  { type: 'wipeUp', name: 'Wipe Up' },
  { type: 'wipeDown', name: 'Wipe Down' },
  { type: 'iris', name: 'Iris Round' },
  { type: 'blur', name: 'Blur' },
  { type: 'spin', name: 'Spin' },
  { type: 'typewriter', name: 'Typewriter', textOnly: true },
];

export const BLEND_MODES: { v: BlendMode; name: string }[] = [
  { v: 'source-over', name: 'Normal' },
  { v: 'multiply', name: 'Multiply' },
  { v: 'screen', name: 'Screen' },
  { v: 'overlay', name: 'Overlay' },
  { v: 'darken', name: 'Darken' },
  { v: 'lighten', name: 'Lighten' },
  { v: 'color-dodge', name: 'Color Dodge' },
  { v: 'color-burn', name: 'Color Burn' },
  { v: 'hard-light', name: 'Hard Light' },
  { v: 'soft-light', name: 'Soft Light' },
  { v: 'difference', name: 'Difference' },
  { v: 'exclusion', name: 'Exclusion' },
  { v: 'hue', name: 'Hue' },
  { v: 'saturation', name: 'Saturation' },
  { v: 'color', name: 'Color' },
  { v: 'luminosity', name: 'Luminosity' },
];

export const FONTS = ['Inter', 'Montserrat', 'Poppins', 'Bebas Neue', 'Anton', 'Oswald', 'Playfair Display', 'Roboto Mono', 'Pacifico', 'Permanent Marker', 'Arial', 'Georgia', 'Impact', 'Courier New'];

export interface TextPreset {
  name: string;
  style: Partial<TextStyle>;
  props?: Record<string, number>;
  transIn?: TransitionType;
  transOut?: TransitionType;
}

export const TEXT_PRESETS: TextPreset[] = [
  { name: 'Title', style: { content: 'Big Title', size: 150, weight: 800 }, transIn: 'fade', transOut: 'fade' },
  { name: 'Subtitle', style: { content: 'Subtitle text', size: 64, weight: 500 }, props: { y: 380 }, transIn: 'fade', transOut: 'fade' },
  {
    name: 'Lower Third',
    style: { content: 'Daniel Dziubek\nFozmu Studios', size: 54, weight: 700, align: 'left', boxEnabled: true, boxColor: 'rgba(19,212,124,0.92)', boxRadius: 8, boxPadding: 22 },
    props: { x: -560, y: 330 },
    transIn: 'slideRight',
    transOut: 'slideLeft',
  },
  { name: 'Caption', style: { content: 'This is a caption', size: 58, weight: 700, boxEnabled: true, boxColor: 'rgba(0,0,0,0.7)', boxRadius: 10, boxPadding: 18 }, props: { y: 400 } },
  { name: 'Outline', style: { content: 'OUTLINE', font: 'Anton', size: 180, weight: 400, color: 'rgba(0,0,0,0)', strokeColor: '#ffffff', strokeWidth: 3 }, transIn: 'zoomOut' },
  { name: 'Neon', style: { content: 'NEON', font: 'Montserrat', size: 160, weight: 900, color: '#ffffff', shadowColor: '#ff2bd6', shadowBlur: 40, shadowY: 0 }, transIn: 'blur' },
  { name: 'Cinematic', style: { content: 'C I N E M A T I C', font: 'Oswald', size: 90, weight: 400, letterSpacing: 18 }, transIn: 'fade', transOut: 'fade' },
  { name: 'Impact Meme', style: { content: 'WHEN THE EDIT HITS', font: 'Anton', size: 120, weight: 400, strokeWidth: 6, strokeColor: '#000', uppercase: true }, props: { y: -400 } },
  { name: 'Handwritten', style: { content: 'with love', font: 'Pacifico', size: 120, weight: 400 }, transIn: 'wipeRight' },
  { name: 'Typewriter', style: { content: 'Once upon a time...', font: 'Roboto Mono', size: 72, weight: 400 }, transIn: 'typewriter' },
  { name: 'Bold Social', style: { content: 'WAIT FOR IT', font: 'Poppins', size: 110, weight: 900, color: '#ffe14d', strokeWidth: 5, strokeColor: '#000', shadowBlur: 0, shadowX: 6, shadowY: 6, shadowColor: '#000' }, transIn: 'zoomIn' },
  { name: 'Serif Elegant', style: { content: 'Chapter One', font: 'Playfair Display', size: 120, weight: 400, italic: true }, transIn: 'fade', transOut: 'fade' },
];

export const textStyle = (s: Partial<TextStyle>): TextStyle => ({ ...DEFAULT_TEXT, ...s });

export const RESOLUTIONS: { name: string; w: number; h: number }[] = [
  { name: '4K UHD (3840×2160)', w: 3840, h: 2160 },
  { name: '1440p (2560×1440)', w: 2560, h: 1440 },
  { name: '1080p HD (1920×1080)', w: 1920, h: 1080 },
  { name: '720p HD (1280×720)', w: 1280, h: 720 },
  { name: 'Vertical 9:16 (1080×1920)', w: 1080, h: 1920 },
  { name: 'Square 1:1 (1080×1080)', w: 1080, h: 1080 },
  { name: 'Portrait 4:5 (1080×1350)', w: 1080, h: 1350 },
  { name: 'Cinema 2.39:1 (1920×804)', w: 1920, h: 804 },
];

export const FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
