import type { Clip, Project, TextStyle, TransitionType } from '../types';
import { chromaKey } from './chroma';
import { easeInOut, propAt } from './props';
import { visualLayersAt, type ActiveLayer } from './project';

export type Source = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

export interface SourceProvider {
  /** Returns drawable for a media clip at clip-local time, or null if not ready. */
  get(clip: Clip, lt: number, tail: boolean): Source | null;
}

/** Box of a clip in project pixel space (uncropped), for the viewer overlay. */
export interface ClipRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function srcSize(s: Source): [number, number] {
  if (s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight];
  if (s instanceof HTMLImageElement) return [s.naturalWidth, s.naturalHeight];
  return [s.width, s.height];
}

let layerCanvas: OffscreenCanvas | null = null;
function getLayer(w: number, h: number) {
  if (!layerCanvas) layerCanvas = new OffscreenCanvas(w, h);
  if (layerCanvas.width !== w || layerCanvas.height !== h) {
    layerCanvas.width = w;
    layerCanvas.height = h;
  }
  return layerCanvas;
}

/* ---------------- text ---------------- */

const textCache = new Map<string, OffscreenCanvas>();

export function fontString(s: TextStyle) {
  return `${s.italic ? 'italic ' : ''}${s.weight} ${s.size}px "${s.font}", Inter, sans-serif`;
}

export function renderText(s: TextStyle, frac = 1): OffscreenCanvas {
  const key = JSON.stringify(s) + '|' + frac.toFixed(3);
  const hit = textCache.get(key);
  if (hit) return hit;
  const content = s.uppercase ? s.content.toUpperCase() : s.content;
  const lines = content.split('\n');
  const meas = new OffscreenCanvas(4, 4).getContext('2d')!;
  meas.font = fontString(s);
  if ('letterSpacing' in meas) (meas as unknown as { letterSpacing: string }).letterSpacing = `${s.letterSpacing}px`;
  const widths = lines.map((l) => meas.measureText(l || ' ').width);
  const lineH = s.size * s.lineHeight;
  const textW = Math.max(1, ...widths);
  const textH = lineH * lines.length;
  const pad = s.boxEnabled ? s.boxPadding : 0;
  const margin = Math.ceil(s.strokeWidth + (s.shadowBlur ? s.shadowBlur * 2 + Math.max(Math.abs(s.shadowX), Math.abs(s.shadowY)) : 0) + 4);
  const W = Math.ceil(textW + pad * 2 + margin * 2);
  const H = Math.ceil(textH + pad * 2 + margin * 2);
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.font = fontString(s);
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${s.letterSpacing}px`;
  if (s.boxEnabled) {
    ctx.fillStyle = s.boxColor;
    ctx.beginPath();
    ctx.roundRect(margin, margin, textW + pad * 2, textH + pad * 2, s.boxRadius);
    ctx.fill();
  }
  const total = content.replace(/\n/g, '').length;
  let remaining = Math.round(total * frac);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  lines.forEach((line, i) => {
    if (remaining <= 0) return;
    const shown = line.slice(0, remaining);
    remaining -= line.length;
    const lw = widths[i];
    let x = margin + pad;
    if (s.align === 'center') x += (textW - lw) / 2;
    else if (s.align === 'right') x += textW - lw;
    const y = margin + pad + lineH * i + lineH / 2;
    if (s.shadowBlur > 0 || s.shadowX || s.shadowY) {
      ctx.shadowColor = s.shadowColor;
      ctx.shadowBlur = s.shadowBlur;
      ctx.shadowOffsetX = s.shadowX;
      ctx.shadowOffsetY = s.shadowY;
    }
    if (s.strokeWidth > 0) {
      ctx.strokeStyle = s.strokeColor;
      ctx.lineWidth = s.strokeWidth * 2;
      ctx.strokeText(shown, x, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = s.color;
    ctx.fillText(shown, x, y);
    ctx.shadowColor = 'transparent';
  });
  if (textCache.size > 300) textCache.clear();
  textCache.set(key, c);
  return c;
}

/* ---------------- transitions ---------------- */

interface TrState {
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
  rot: number;
  blur: number;
  chars: number;
  clip: ((ctx: Canvas2D) => void) | null;
  overlay: { color: string; a: number } | null;
}

function applyTransition(type: TransitionType, p: number, dir: 'in' | 'out', s: TrState, W: number, H: number) {
  const q = 1 - p; // amount remaining
  const sign = dir === 'in' ? 1 : -1;
  switch (type) {
    case 'fade':
    case 'crossDissolve':
      s.alpha *= p;
      break;
    case 'dipBlack':
    case 'dipWhite':
      s.overlay = { color: type === 'dipBlack' ? '#000' : '#fff', a: q };
      break;
    case 'slideLeft':
    case 'pushLeft':
      s.dx += sign * q * W;
      break;
    case 'slideRight':
      s.dx -= sign * q * W;
      break;
    case 'slideUp':
      s.dy += sign * q * H;
      break;
    case 'slideDown':
      s.dy -= sign * q * H;
      break;
    case 'zoomIn':
      s.scale *= dir === 'in' ? 0.3 + 0.7 * p : 1 + 0.6 * q;
      s.alpha *= p;
      break;
    case 'zoomOut':
      s.scale *= dir === 'in' ? 1 + 0.6 * q : 0.3 + 0.7 * p;
      s.alpha *= p;
      break;
    case 'wipeLeft':
      s.clip = (c) => c.rect(dir === 'in' ? W * q : 0, 0, W * p, H);
      break;
    case 'wipeRight':
      s.clip = (c) => c.rect(dir === 'in' ? 0 : W * q, 0, W * p, H);
      break;
    case 'wipeUp':
      s.clip = (c) => c.rect(0, dir === 'in' ? H * q : 0, W, H * p);
      break;
    case 'wipeDown':
      s.clip = (c) => c.rect(0, dir === 'in' ? 0 : H * q, W, H * p);
      break;
    case 'iris':
      s.clip = (c) => c.arc(W / 2, H / 2, Math.hypot(W, H) * 0.5 * p, 0, Math.PI * 2);
      break;
    case 'blur':
      s.blur += q * 40;
      s.alpha *= p;
      break;
    case 'spin':
      s.rot += sign * q * 360;
      s.scale *= p;
      break;
    case 'typewriter':
      s.chars = Math.min(s.chars, p);
      break;
  }
}

function transitionState(c: Clip, lt: number, tail: boolean, W: number, H: number): TrState {
  const s: TrState = { alpha: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0, chars: 1, clip: null, overlay: null };
  if (tail) return s;
  const ti = c.transIn;
  if (ti.type !== 'none' && ti.dur > 0 && lt < ti.dur) {
    const p = ti.type === 'typewriter' ? lt / ti.dur : easeInOut(lt / ti.dur);
    applyTransition(ti.type, p, 'in', s, W, H);
  }
  const to = c.transOut;
  const rem = c.dur - lt;
  if (to.type !== 'none' && to.dur > 0 && rem < to.dur) {
    const p = to.type === 'typewriter' ? rem / to.dur : easeInOut(rem / to.dur);
    applyTransition(to.type === 'crossDissolve' ? 'fade' : to.type, p, 'out', s, W, H);
  }
  return s;
}

/* ---------------- filters ---------------- */

function colorFilter(c: Clip, lt: number, extraBlur: number, scaleToOutput: number): string {
  const parts: string[] = [];
  const b = propAt(c, 'brightness', lt);
  const co = propAt(c, 'contrast', lt);
  const sa = propAt(c, 'saturation', lt);
  const hu = propAt(c, 'hue', lt);
  const gr = propAt(c, 'grayscale', lt);
  const se = propAt(c, 'sepia', lt);
  const iv = propAt(c, 'invert', lt);
  const bl = propAt(c, 'blur', lt) + extraBlur;
  if (b !== 100) parts.push(`brightness(${b}%)`);
  if (co !== 100) parts.push(`contrast(${co}%)`);
  if (sa !== 100) parts.push(`saturate(${sa}%)`);
  if (hu !== 0) parts.push(`hue-rotate(${hu}deg)`);
  if (gr > 0) parts.push(`grayscale(${gr}%)`);
  if (se > 0) parts.push(`sepia(${se}%)`);
  if (iv > 0) parts.push(`invert(${iv}%)`);
  if (bl > 0) parts.push(`blur(${bl * scaleToOutput}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

function tintAndVignette(L: OffscreenCanvasRenderingContext2D, c: Clip, lt: number, W: number, H: number, cx: number, cy: number, w: number, h: number) {
  const temp = propAt(c, 'temperature', lt);
  const tint = propAt(c, 'tint', lt);
  const vig = propAt(c, 'vignette', lt);
  if (!temp && !tint && !vig) return;
  L.save();
  L.globalCompositeOperation = 'source-atop';
  if (temp) {
    L.fillStyle = temp > 0 ? `rgba(255,150,40,${(temp / 100) * 0.28})` : `rgba(40,130,255,${(-temp / 100) * 0.28})`;
    L.fillRect(0, 0, W, H);
  }
  if (tint) {
    L.fillStyle = tint > 0 ? `rgba(220,40,220,${(tint / 100) * 0.2})` : `rgba(40,220,80,${(-tint / 100) * 0.2})`;
    L.fillRect(0, 0, W, H);
  }
  if (vig) {
    const r = Math.hypot(w, h) / 2;
    const g = L.createRadialGradient(cx, cy, r * (1 - (vig / 100) * 0.7) * 0.6, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${Math.min(1, vig / 100 + 0.15)})`);
    L.fillStyle = g;
    L.fillRect(0, 0, W, H);
  }
  L.restore();
}

/* ---------------- main ---------------- */

export interface RenderOptions {
  /** Output canvas size may differ from project size (preview scaling). */
  outW: number;
  outH: number;
  rects?: Map<string, ClipRect>;
}

/**
 * Draws the composited frame at time t. All geometry is defined in project pixels and
 * scaled to the output canvas.
 */
export function renderFrame(ctx: Canvas2D, p: Project, t: number, src: SourceProvider, opts: RenderOptions) {
  const { outW, outH } = opts;
  const k = outW / p.width;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, outW, outH);
  ctx.restore();
  const layers = visualLayersAt(p, t);
  for (const layer of layers) drawLayer(ctx, p, layer, src, outW, outH, k, opts.rects);
}

function drawLayer(ctx: Canvas2D, p: Project, layer: ActiveLayer, src: SourceProvider, W: number, H: number, k: number, rects?: Map<string, ClipRect>) {
  const { clip: c, tail } = layer;
  const lt = layer.lt;
  const tr = transitionState(c, lt, !!tail, W, H);
  const opacity = (propAt(c, 'opacity', lt) / 100) * tr.alpha;
  const L = getLayer(W, H).getContext('2d')!;
  L.setTransform(1, 0, 0, 1, 0, 0);
  L.globalCompositeOperation = 'source-over';
  L.globalAlpha = 1;
  L.filter = 'none';
  L.clearRect(0, 0, W, H);

  let cx = W / 2;
  let cy = H / 2;
  let bw = W;
  let bh = H;

  if (c.kind === 'adjust') {
    L.filter = colorFilter(c, lt, tr.blur, k);
    L.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
    L.filter = 'none';
    tintAndVignette(L, c, lt, W, H, cx, cy, bw, bh);
  } else {
    let source: Source | null = null;
    let sw = p.width;
    let sh = p.height;
    if (c.kind === 'text' && c.text) {
      source = renderText(c.text, tr.chars);
      sw = source.width;
      sh = source.height;
    } else if (c.kind === 'video' || c.kind === 'image') {
      source = src.get(c, lt, !!tail);
      if (!source) return;
      [sw, sh] = srcSize(source);
      if (!sw || !sh) return;
    }
    // base size in project px
    let w: number;
    let h: number;
    switch (c.kind === 'solid' ? 'stretch' : c.fit) {
      case 'fill': {
        const s = Math.max(p.width / sw, p.height / sh);
        w = sw * s;
        h = sh * s;
        break;
      }
      case 'stretch':
        w = p.width;
        h = p.height;
        break;
      case 'none':
        w = sw;
        h = sh;
        break;
      default: {
        const s = Math.min(p.width / sw, p.height / sh);
        w = sw * s;
        h = sh * s;
      }
    }
    const sc = propAt(c, 'scale', lt) / 100;
    w *= sc * (propAt(c, 'scaleX', lt) / 100);
    h *= sc * (propAt(c, 'scaleY', lt) / 100);
    const x = propAt(c, 'x', lt);
    const y = propAt(c, 'y', lt);
    const rot = propAt(c, 'rotation', lt);
    if (rects && !tail) rects.set(c.id, { cx: p.width / 2 + x, cy: p.height / 2 + y, w, h, rot });

    cx = (p.width / 2 + x) * k + tr.dx;
    cy = (p.height / 2 + y) * k + tr.dy;
    bw = w * k * tr.scale;
    bh = h * k * tr.scale;

    const cl = propAt(c, 'cropL', lt) / 100;
    const cr = propAt(c, 'cropR', lt) / 100;
    const ct = propAt(c, 'cropT', lt) / 100;
    const cb = propAt(c, 'cropB', lt) / 100;
    const cw = 1 - cl - cr;
    const ch = 1 - ct - cb;
    if (cw <= 0 || ch <= 0) return;

    L.translate(cx, cy);
    L.rotate(((rot + tr.rot) * Math.PI) / 180);
    L.scale(c.flipH ? -1 : 1, c.flipV ? -1 : 1);
    const x0 = -bw / 2 + cl * bw;
    const y0 = -bh / 2 + ct * bh;
    const dw = bw * cw;
    const dh = bh * ch;
    const radius = propAt(c, 'radius', lt) * k * tr.scale;
    if (radius > 0) {
      L.beginPath();
      L.roundRect(x0, y0, dw, dh, Math.min(radius, dw / 2, dh / 2));
      L.clip();
    }
    L.filter = colorFilter(c, lt, tr.blur, k);
    if (c.kind === 'solid') {
      L.fillStyle = c.color || '#000';
      L.fillRect(x0, y0, dw, dh);
    } else if (source) {
      if (c.keyColor && (c.kind === 'video' || c.kind === 'image')) {
        // Key at no more than the drawn size: cheaper for small previews, same result on export.
        const kw = Math.max(1, Math.min(sw, Math.round(Math.abs(bw))));
        const kh = Math.max(1, Math.min(sh, Math.round(Math.abs(bh))));
        source = chromaKey(source, kw, kh, {
          color: c.keyColor,
          similarity: propAt(c, 'keySim', lt),
          smoothness: propAt(c, 'keySmooth', lt),
          spill: propAt(c, 'keySpill', lt),
        });
        sw = kw;
        sh = kh;
      }
      L.drawImage(source as CanvasImageSource, cl * sw, ct * sh, cw * sw, ch * sh, x0, y0, dw, dh);
    }
    L.filter = 'none';
    L.setTransform(1, 0, 0, 1, 0, 0);
    tintAndVignette(L, c, lt, W, H, cx, cy, bw, bh);
  }

  // composite
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  ctx.globalCompositeOperation = c.kind === 'adjust' ? 'source-over' : c.blend;
  if (tr.clip) {
    ctx.beginPath();
    tr.clip(ctx);
    ctx.clip();
  }
  const shadow = propAt(c, 'shadow', lt);
  if (shadow > 0 && c.kind !== 'adjust') {
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = shadow * k;
    ctx.shadowOffsetY = (shadow / 3) * k;
  }
  ctx.drawImage(L.canvas, 0, 0);
  ctx.restore();
  if (tr.overlay && tr.overlay.a > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = tr.overlay.a;
    ctx.fillStyle = tr.overlay.color;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}
