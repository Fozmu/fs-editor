import { useStore } from '../store';
import type { Clip, Ease, FitMode, TextStyle, TransitionType } from '../types';
import { groupsFor, PROP_DEFS, propAt, STATIC_PROPS, type PropDef } from '../engine/props';
import { BLEND_MODES, COLOR_KEYS, COLOR_PRESETS, FONTS, TRANSITIONS } from '../engine/presets';
import { formatTC, maxDurFor, projectDuration } from '../engine/project';
import { hasAudio } from '../engine/audio';
import { Icon } from './Icon';
import { NumField, Section, Slider } from './common';

export const KIND_COLOR: Record<Clip['kind'], string> = {
  video: 'var(--clipVideo)',
  image: 'var(--clipImage)',
  audio: 'var(--clipAudio)',
  text: 'var(--clipText)',
  solid: 'var(--clipSolid)',
  adjust: 'var(--clipAdjust)',
};

const GROUP_TITLES: Record<PropDef['group'], string> = {
  transform: 'Motion',
  crop: 'Crop & Shape',
  key: 'Chroma Key',
  color: 'Lumetri Color',
  effects: 'Effects',
  audio: 'Audio',
};

export function Inspector() {
  const sel = useStore((s) => s.selection);
  const clip = useStore((s) => (s.selection.length === 1 ? s.project.clips.find((c) => c.id === s.selection[0]) : undefined));
  return (
    <div className="panel right">
      <div className="tabs">
        <span className="tab on">Effect Controls</span>
      </div>
      <div className="panel-body">{clip ? <ClipInspector clip={clip} /> : sel.length > 1 ? <Multi n={sel.length} /> : <ProjectInfo />}</div>
    </div>
  );
}

function ProjectInfo() {
  const p = useStore((s) => s.project);
  return (
    <div>
      <div className="insp-empty">
        <Icon name="cursor" size={26} />
        <p>Select a clip on the timeline or in the viewer to edit its motion, color, effects, transitions and audio.</p>
      </div>
      <Section title="Sequence">
        <div className="row plain">
          <label>Resolution</label>
          <span className="meta">
            {p.width} × {p.height}
          </span>
        </div>
        <div className="row plain">
          <label>Frame rate</label>
          <span className="meta">{p.fps} fps</span>
        </div>
        <div className="row plain">
          <label>Duration</label>
          <span className="meta">{formatTC(projectDuration(p), p.fps)}</span>
        </div>
        <div className="row plain">
          <label>Clips</label>
          <span className="meta">{p.clips.length}</span>
        </div>
        <button className="btn sm" onClick={() => useStore.setState({ dialog: 'settings' })}>
          <Icon name="settings" size={14} /> Sequence settings
        </button>
      </Section>
    </div>
  );
}

function Multi({ n }: { n: number }) {
  const st = useStore.getState;
  return (
    <div className="insp-empty">
      <p>
        <b>{n} clips selected</b>
      </p>
      <div className="chip-row" style={{ justifyContent: 'center' }}>
        <button className="btn sm" onClick={() => st().copy()}>
          Copy
        </button>
        <button className="btn sm" onClick={() => st().duplicate()}>
          Duplicate
        </button>
        <button className="btn sm danger" onClick={() => st().deleteSelected()}>
          Delete
        </button>
      </div>
    </div>
  );
}

function ClipInspector({ clip }: { clip: Clip }) {
  const playhead = useStore((s) => s.playhead);
  const project = useStore((s) => s.project);
  const st = useStore.getState;
  const media = project.media.find((m) => m.id === clip.mediaId);
  const lt = Math.min(clip.dur, Math.max(0, playhead - clip.start));
  const inClip = playhead >= clip.start && playhead <= clip.start + clip.dur;
  const groups = groupsFor(clip.kind).filter((g) => g !== 'audio' || hasAudio(project, clip));
  const upd = (fn: (c: Clip) => void, history = true) => st().updateClip(clip.id, fn, history);

  return (
    <div>
      <div className="clip-title">
        <span className="dot" style={{ background: KIND_COLOR[clip.kind] }} />
        <input value={clip.name} onChange={(e) => upd((c) => void (c.name = e.target.value), false)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div style={{ padding: '6px 10px' }} className="meta">
        {clip.kind.toUpperCase()} · In {formatTC(clip.start, project.fps)} · Dur {formatTC(clip.dur, project.fps)}
        {media && media.width ? ` · ${media.width}×${media.height}` : ''}
        {!inClip && <div style={{ color: 'var(--warn)', marginTop: 4 }}>Playhead is outside this clip — keyframes are set at the nearest edge.</div>}
      </div>

      <Section title="Clip">
        {clip.kind !== 'adjust' && clip.kind !== 'audio' && clip.kind !== 'solid' && (
          <div className="row plain">
            <label>Scale to frame</label>
            <div className="seg">
              {(['fit', 'fill', 'stretch', 'none'] as FitMode[]).map((f) => (
                <button key={f} className={clip.fit === f ? 'on' : ''} onClick={() => upd((c) => void (c.fit = f))}>
                  {f === 'none' ? '1:1' : f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}
        {(clip.kind === 'video' || clip.kind === 'audio') && (
          <>
            <div className="row plain">
              <label>Speed</label>
              <NumField
                value={clip.speed * 100}
                min={5}
                max={1600}
                step={1}
                digits={0}
                suffix="%"
                onChange={(v, final) => setSpeed(clip, v / 100, final)}
              />
            </div>
            <div className="chip-row">
              {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
                <button key={s} className={'chip' + (Math.abs(clip.speed - s) < 1e-6 ? ' on' : '')} onClick={() => setSpeed(clip, s, true)}>
                  {s}×
                </button>
              ))}
            </div>
          </>
        )}
        {(clip.kind === 'image' || clip.kind === 'text' || clip.kind === 'solid' || clip.kind === 'adjust') && (
          <div className="row plain">
            <label>Duration (s)</label>
            <NumField value={clip.dur} min={1 / project.fps} max={36000} step={0.1} digits={2} onChange={(v) => upd((c) => void (c.dur = v))} />
          </div>
        )}
        {clip.kind !== 'audio' && clip.kind !== 'adjust' && (
          <>
            <div className="row plain">
              <label>Blend mode</label>
              <select className="select" value={clip.blend} onChange={(e) => upd((c) => void (c.blend = e.target.value as Clip['blend']))}>
                {BLEND_MODES.map((b) => (
                  <option key={b.v} value={b.v}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="chip-row">
              <button className={'chip' + (clip.flipH ? ' on' : '')} onClick={() => upd((c) => void (c.flipH = !c.flipH))}>
                Flip Horizontal
              </button>
              <button className={'chip' + (clip.flipV ? ' on' : '')} onClick={() => upd((c) => void (c.flipV = !c.flipV))}>
                Flip Vertical
              </button>
            </div>
          </>
        )}
        {clip.kind === 'video' && media?.hasAudio && (
          <div className="chip-row">
            <button className={'chip' + (clip.muted ? ' on' : '')} onClick={() => upd((c) => void (c.muted = !c.muted))}>
              {clip.muted ? 'Audio muted' : 'Mute audio'}
            </button>
            <button className="chip" onClick={() => st().detachAudio(clip.id)}>
              Detach audio
            </button>
          </div>
        )}
        {clip.kind === 'solid' && (
          <div className="row plain">
            <label>Color</label>
            <input type="color" value={clip.color ?? '#000000'} onChange={(e) => upd((c) => void (c.color = e.target.value), false)} onBlur={() => upd(() => {})} />
          </div>
        )}
      </Section>

      {clip.kind === 'text' && clip.text && <TextSection clip={clip} />}

      {groups.map((g) => (
        <Section
          key={g}
          title={GROUP_TITLES[g]}
          defaultOpen={g !== 'crop' && g !== 'effects' && (g !== 'key' || !!clip.keyColor)}
          right={
            <button className="ibtn sm" title="Reset section" onClick={() => st().resetProps(clip.id, PROP_DEFS.filter((d) => d.group === g).map((d) => d.key))}>
              <Icon name="reset" size={13} />
            </button>
          }
        >
          {g === 'color' && (
            <div className="chip-row" style={{ marginBottom: 6 }}>
              {COLOR_PRESETS.map((pr) => (
                <button
                  key={pr.name}
                  className="chip"
                  onClick={() =>
                    upd((c) => {
                      for (const k of COLOR_KEYS) {
                        delete c.props[k];
                        delete c.keys[k];
                      }
                      Object.assign(c.props, pr.props);
                    })
                  }
                >
                  {pr.name}
                </button>
              ))}
            </div>
          )}
          {g === 'key' && <KeyControls clip={clip} />}
          {(g !== 'key' || clip.keyColor) &&
            PROP_DEFS.filter((d) => d.group === g).map((d) => <PropRow key={d.key} clip={clip} def={d} lt={lt} />)}
        </Section>
      ))}

      {clip.kind !== 'audio' && <TransitionSection clip={clip} />}
    </div>
  );
}

const KEY_SWATCHES = [
  { name: 'Green', color: '#00b140' },
  { name: 'Blue', color: '#0047bb' },
];

interface EyeDropperCtor {
  new (): { open(): Promise<{ sRGBHex: string }> };
}

function KeyControls({ clip }: { clip: Clip }) {
  const st = useStore.getState;
  const upd = (fn: (c: Clip) => void, history = true) => st().updateClip(clip.id, fn, history);
  const Dropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  const pick = async () => {
    if (!Dropper) return;
    // Sample the unkeyed image: turn keying off while the dropper is open.
    const prev = clip.keyColor;
    upd((c) => void delete c.keyColor, false);
    try {
      const { sRGBHex } = await new Dropper().open();
      upd((c) => void (c.keyColor = toHex(sRGBHex)));
    } catch {
      upd((c) => void (c.keyColor = prev), false);
    }
  };
  return (
    <>
      <div className="chip-row">
        <button className={'chip' + (clip.keyColor ? ' on' : '')} onClick={() => upd((c) => void (c.keyColor = c.keyColor ? undefined : KEY_SWATCHES[0].color))}>
          {clip.keyColor ? 'Keying on' : 'Remove background color'}
        </button>
      </div>
      {clip.keyColor && (
        <>
          <div className="row plain">
            <label>Key color</label>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="color" value={clip.keyColor} onChange={(e) => upd((c) => void (c.keyColor = e.target.value), false)} onBlur={() => upd(() => {})} />
              {Dropper && (
                <button className="ibtn sm" title="Pick key color from screen" onClick={pick}>
                  <Icon name="eyedropper" size={13} />
                </button>
              )}
            </div>
          </div>
          <div className="chip-row">
            {KEY_SWATCHES.map((k) => (
              <button key={k.name} className={'chip' + (clip.keyColor === k.color ? ' on' : '')} onClick={() => upd((c) => void (c.keyColor = k.color))}>
                {k.name} screen
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function setSpeed(clip: Clip, s: number, final: boolean) {
  const st = useStore.getState();
  st.updateClip(
    clip.id,
    (c) => {
      const srcDur = c.dur * c.speed;
      c.speed = Math.max(0.05, Math.min(16, s));
      c.dur = srcDur / c.speed;
      const max = maxDurFor(st.project, c);
      if (c.dur > max) c.dur = max;
    },
    final,
  );
}

function PropRow({ clip, def, lt }: { clip: Clip; def: PropDef; lt: number }) {
  const st = useStore.getState;
  const value = propAt(clip, def.key, lt);
  const keys = clip.keys[def.key];
  const animated = !!keys?.length;
  const fps = useStore((s) => s.project.fps);
  const tol = 0.5 / fps;
  const onKey = keys?.find((k) => Math.abs(k.t - lt) < tol);
  const prev = keys ? [...keys].reverse().find((k) => k.t < lt - tol) : undefined;
  const next = keys?.find((k) => k.t > lt + tol);
  const canAnimate = !STATIC_PROPS.has(def.key);
  const set = (v: number, final: boolean) => st().setProp(clip.id, def.key, v, final);
  const goto = (t: number) => st().setPlayhead(clip.start + t);
  const isDefault = !animated && (clip.props[def.key] === undefined || clip.props[def.key] === def.def);

  return (
    <>
      <div className="row">
        {canAnimate ? (
          <button className={'sw' + (animated ? ' on' : '')} title={animated ? 'Disable keyframes' : 'Toggle animation (keyframes)'} onClick={() => st().toggleAnimate(clip.id, def.key)}>
            <Icon name="stopwatch" size={13} />
          </button>
        ) : (
          <span />
        )}
        <label title={def.label} style={isDefault ? undefined : { color: 'var(--tx0)' }}>
          {def.label}
        </label>
        <Slider value={value} min={def.sliderMin ?? def.min} max={def.sliderMax ?? def.max} step={def.step} onChange={set} />
        <NumField value={value} min={def.min} max={def.max} step={def.step} digits={def.step < 1 ? (def.step < 0.1 ? 2 : 1) : 0} onChange={set} />
        {animated ? (
          <div className="kf-nav">
            <button disabled={!prev} onClick={() => prev && goto(prev.t)} title="Previous keyframe">
              <Icon name="chevL" size={11} />
            </button>
            <button className={onKey ? 'on' : ''} onClick={() => st().toggleKeyframeHere(clip.id, def.key)} title={onKey ? 'Remove keyframe' : 'Add keyframe'}>
              <Icon name="keyframe" size={10} />
            </button>
            <button disabled={!next} onClick={() => next && goto(next.t)} title="Next keyframe">
              <Icon name="chevR" size={11} />
            </button>
          </div>
        ) : (
          <span />
        )}
      </div>
      {onKey && (
        <div className="row" style={{ minHeight: 22 }}>
          <span />
          <label className="meta">Interpolation</label>
          <select
            className="select"
            style={{ height: 22 }}
            value={onKey.ease}
            onChange={(e) =>
              st().updateClip(clip.id, (c) => {
                const k = c.keys[def.key]?.find((k) => Math.abs(k.t - lt) < tol);
                if (k) k.ease = e.target.value as Ease;
              })
            }
          >
            <option value="linear">Linear</option>
            <option value="easeIn">Ease In</option>
            <option value="easeOut">Ease Out</option>
            <option value="easeInOut">Ease In/Out (Bezier)</option>
            <option value="hold">Hold</option>
          </select>
          <span />
          <span />
        </div>
      )}
    </>
  );
}

function TransitionSection({ clip }: { clip: Clip }) {
  const st = useStore.getState;
  const opts = TRANSITIONS.filter((t) => !t.textOnly || clip.kind === 'text');
  const row = (which: 'transIn' | 'transOut', label: string) => (
    <>
      <div className="row plain">
        <label>{label}</label>
        <select
          className="select"
          value={clip[which].type}
          onChange={(e) => st().updateClip(clip.id, (c) => void (c[which] = { ...c[which], type: e.target.value as TransitionType }))}
        >
          {opts
            .filter((t) => which === 'transIn' || t.type !== 'crossDissolve')
            .map((t) => (
              <option key={t.type} value={t.type}>
                {t.name}
              </option>
            ))}
        </select>
      </div>
      {clip[which].type !== 'none' && (
        <div className="row plain">
          <label className="meta">Duration (s)</label>
          <NumField
            value={clip[which].dur}
            min={0.04}
            max={Math.max(0.05, clip.dur)}
            step={0.05}
            digits={2}
            onChange={(v, final) => st().updateClip(clip.id, (c) => void (c[which] = { ...c[which], dur: v }), final)}
          />
        </div>
      )}
    </>
  );
  return (
    <Section title="Transitions">
      {row('transIn', 'In')}
      {row('transOut', 'Out')}
      {clip.transIn.type === 'crossDissolve' && <div className="note">Cross Dissolve blends with the clip directly before this one on the same track.</div>}
    </Section>
  );
}

function TextSection({ clip }: { clip: Clip }) {
  const t = clip.text!;
  const st = useStore.getState;
  const set = <K extends keyof TextStyle>(k: K, v: TextStyle[K], history = true) => st().updateClip(clip.id, (c) => void (c.text![k] = v), history);
  return (
    <Section title="Text">
      <textarea className="txt" value={t.content} onChange={(e) => set('content', e.target.value, false)} onBlur={() => st().updateClip(clip.id, () => {})} onKeyDown={(e) => e.stopPropagation()} />
      <div className="row plain">
        <label>Font</label>
        <select className="select" value={t.font} onChange={(e) => set('font', e.target.value)} style={{ fontFamily: t.font }}>
          {FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="row plain">
        <label>Size</label>
        <NumField value={t.size} min={4} max={1000} step={1} digits={0} onChange={(v, f) => set('size', v, f)} />
      </div>
      <div className="row plain">
        <label>Weight</label>
        <div className="seg">
          {[300, 400, 500, 700, 900].map((w) => (
            <button key={w} className={t.weight === w ? 'on' : ''} onClick={() => set('weight', w)}>
              {w}
            </button>
          ))}
        </div>
      </div>
      <div className="row plain">
        <label>Align</label>
        <div className="seg">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} className={t.align === a ? 'on' : ''} onClick={() => set('align', a)}>
              {a}
            </button>
          ))}
        </div>
      </div>
      <div className="chip-row">
        <button className={'chip' + (t.italic ? ' on' : '')} onClick={() => set('italic', !t.italic)}>
          Italic
        </button>
        <button className={'chip' + (t.uppercase ? ' on' : '')} onClick={() => set('uppercase', !t.uppercase)}>
          ALL CAPS
        </button>
        <button className={'chip' + (t.boxEnabled ? ' on' : '')} onClick={() => set('boxEnabled', !t.boxEnabled)}>
          Background box
        </button>
      </div>
      <div className="row plain">
        <label>Fill</label>
        <input type="color" value={toHex(t.color)} onChange={(e) => set('color', e.target.value, false)} onBlur={() => st().updateClip(clip.id, () => {})} />
      </div>
      <div className="row plain">
        <label>Line height</label>
        <NumField value={t.lineHeight} min={0.5} max={4} step={0.05} digits={2} onChange={(v, f) => set('lineHeight', v, f)} />
      </div>
      <div className="row plain">
        <label>Tracking</label>
        <NumField value={t.letterSpacing} min={-50} max={200} step={1} digits={0} onChange={(v, f) => set('letterSpacing', v, f)} />
      </div>
      <div className="row plain">
        <label>Stroke</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px', gap: 4 }}>
          <input type="color" value={toHex(t.strokeColor)} onChange={(e) => set('strokeColor', e.target.value, false)} />
          <NumField value={t.strokeWidth} min={0} max={100} step={0.5} onChange={(v, f) => set('strokeWidth', v, f)} />
        </div>
      </div>
      <div className="row plain">
        <label>Shadow</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px', gap: 4 }}>
          <input type="color" value={toHex(t.shadowColor)} onChange={(e) => set('shadowColor', e.target.value, false)} />
          <NumField value={t.shadowBlur} min={0} max={200} step={1} digits={0} onChange={(v, f) => set('shadowBlur', v, f)} />
        </div>
      </div>
      {t.boxEnabled && (
        <>
          <div className="row plain">
            <label>Box color</label>
            <input type="color" value={toHex(t.boxColor)} onChange={(e) => set('boxColor', e.target.value, false)} />
          </div>
          <div className="row plain">
            <label>Box padding</label>
            <NumField value={t.boxPadding} min={0} max={400} step={1} digits={0} onChange={(v, f) => set('boxPadding', v, f)} />
          </div>
          <div className="row plain">
            <label>Box radius</label>
            <NumField value={t.boxRadius} min={0} max={400} step={1} digits={0} onChange={(v, f) => set('boxRadius', v, f)} />
          </div>
        </>
      )}
    </Section>
  );
}

/** Best-effort conversion of any CSS color to #rrggbb for <input type=color>. */
function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillStyle = c;
  const v = ctx.fillStyle as string;
  if (v.startsWith('#')) return v;
  const m = v.match(/\d+(\.\d+)?/g);
  if (!m) return '#000000';
  return '#' + m.slice(0, 3).map((x) => Math.round(+x).toString(16).padStart(2, '0')).join('');
}
