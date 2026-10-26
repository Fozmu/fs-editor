import type { Source } from './render';

/**
 * Chroma key (green / blue screen). Runs as a WebGL2 shader on an OffscreenCanvas; falls back to a
 * per-pixel CPU pass where WebGL2 is unavailable. Pixels close to the key color in CbCr space are
 * made transparent, with a soft edge and spill suppression (desaturates key-colored fringes).
 */
export interface KeyParams {
  /** #rrggbb */
  color: string;
  /** 0..100: chroma distance treated as fully keyed. */
  similarity: number;
  /** 0..100: width of the soft edge beyond `similarity`. */
  smoothness: number;
  /** 0..100: spill suppression strength. */
  spill: number;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function cbcr(r: number, g: number, b: number): [number, number] {
  return [-0.1146 * r - 0.3854 * g + 0.5 * b, 0.5 * r - 0.4542 * g - 0.0458 * b];
}

// Shader inputs are scaled so the UI ranges (0..100) map onto sensible chroma distances.
const SIM_SCALE = 0.004;
const SMOOTH_SCALE = 0.003;

const VS = `#version 300 es
in vec2 p;
out vec2 uv;
void main() {
  uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D tex;
uniform vec2 keyCC;
uniform float sim;
uniform float smooth_;
uniform float spill;
in vec2 uv;
out vec4 o;
vec2 cbcr(vec3 c) {
  return vec2(-0.1146 * c.r - 0.3854 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4542 * c.g - 0.0458 * c.b);
}
void main() {
  vec4 c = texture(tex, uv);
  float d = distance(cbcr(c.rgb), keyCC);
  float base = d - sim;
  float a = c.a * pow(clamp(base / max(smooth_, 1e-4), 0.0, 1.0), 1.5);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float s = pow(clamp(base / max(spill, 1e-4), 0.0, 1.0), 1.5);
  vec3 rgb = spill > 0.0 ? mix(vec3(l), c.rgb, s) : c.rgb;
  o = vec4(rgb * a, a);
}`;

interface GL {
  canvas: OffscreenCanvas;
  gl: WebGL2RenderingContext;
  u: Record<'keyCC' | 'sim' | 'smooth_' | 'spill', WebGLUniformLocation | null>;
}

let glState: GL | null | undefined;

function initGL(): GL | null {
  try {
    const canvas = new OffscreenCanvas(2, 2);
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const u = {
      keyCC: gl.getUniformLocation(prog, 'keyCC'),
      sim: gl.getUniformLocation(prog, 'sim'),
      smooth_: gl.getUniformLocation(prog, 'smooth_'),
      spill: gl.getUniformLocation(prog, 'spill'),
    };
    canvas.addEventListener('contextlost', () => (glState = undefined));
    return { canvas, gl, u };
  } catch (e) {
    console.warn('Chroma key: WebGL2 unavailable, using CPU fallback', e);
    return null;
  }
}

let cpuCanvas: OffscreenCanvas | null = null;

function keyCPU(src: Source, w: number, h: number, k: KeyParams): OffscreenCanvas {
  if (!cpuCanvas) cpuCanvas = new OffscreenCanvas(w, h);
  if (cpuCanvas.width !== w || cpuCanvas.height !== h) {
    cpuCanvas.width = w;
    cpuCanvas.height = h;
  }
  const ctx = cpuCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const [kr, kg, kb] = hexToRgb(k.color);
  const [kcb, kcr] = cbcr(kr, kg, kb);
  const sim = k.similarity * SIM_SCALE;
  const sm = Math.max(1e-4, k.smoothness * SMOOTH_SCALE);
  const sp = k.spill * SMOOTH_SCALE;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const [cb, cr] = cbcr(r, g, b);
    const base = Math.hypot(cb - kcb, cr - kcr) - sim;
    d[i + 3] *= Math.pow(Math.min(1, Math.max(0, base / sm)), 1.5);
    if (sp > 0) {
      const s = Math.pow(Math.min(1, Math.max(0, base / sp)), 1.5);
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) * 255 * (1 - s);
      d[i] = l + d[i] * s;
      d[i + 1] = l + d[i + 1] * s;
      d[i + 2] = l + d[i + 2] * s;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cpuCanvas;
}

/**
 * Returns a keyed copy of `src` at w×h. The returned canvas is reused across calls, so draw it
 * before keying the next source.
 */
export function chromaKey(src: Source, w: number, h: number, k: KeyParams): OffscreenCanvas {
  if (glState === undefined) glState = initGL();
  if (!glState) return keyCPU(src, w, h, k);
  const { canvas, gl, u } = glState;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl.viewport(0, 0, w, h);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
  const [r, g, b] = hexToRgb(k.color);
  gl.uniform2fv(u.keyCC, cbcr(r, g, b));
  gl.uniform1f(u.sim, k.similarity * SIM_SCALE);
  gl.uniform1f(u.smooth_, k.smoothness * SMOOTH_SCALE);
  gl.uniform1f(u.spill, k.spill * SMOOTH_SCALE);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return canvas;
}
