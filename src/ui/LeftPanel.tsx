import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { getEntry, relinkMedia, useMediaVersion, forgetMedia } from '../engine/media';
import { formatShort } from '../engine/project';
import { COLOR_KEYS, COLOR_PRESETS, TEXT_PRESETS, TRANSITIONS } from '../engine/presets';
import { deleteMediaBlob } from '../engine/storage';
import type { MediaItem, TransitionType } from '../types';
import { Icon } from './Icon';
import { addTextPreset, applyToSelection, importFiles, importViaPicker, pickFiles } from './actions';
import { fmtBytes, useMenu } from './common';

type Tab = 'media' | 'titles' | 'effects';

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>('media');
  return (
    <div className="panel left">
      <div className="tabs">
        <button className={'tab' + (tab === 'media' ? ' on' : '')} onClick={() => setTab('media')}>
          Project Media
        </button>
        <button className={'tab' + (tab === 'titles' ? ' on' : '')} onClick={() => setTab('titles')}>
          Titles
        </button>
        <button className={'tab' + (tab === 'effects' ? ' on' : '')} onClick={() => setTab('effects')}>
          Effects
        </button>
      </div>
      <div className="panel-body">
        {tab === 'media' && <MediaBin />}
        {tab === 'titles' && <Titles />}
        {tab === 'effects' && <Effects />}
      </div>
    </div>
  );
}

function MediaThumb({ m }: { m: MediaItem }) {
  useMediaVersion((s) => s.v);
  const ref = useRef<HTMLCanvasElement>(null);
  const thumbs = getEntry(m.id)?.thumbs;
  useEffect(() => {
    const c = ref.current;
    if (!c || !thumbs?.length) return;
    const bmp = thumbs[Math.floor(thumbs.length / 3)];
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
  }, [thumbs]);
  if (m.kind === 'audio') return <Waveicon m={m} />;
  if (!thumbs?.length) return <Icon name={m.kind === 'image' ? 'image' : 'film'} size={26} />;
  return <canvas ref={ref} />;
}

function Waveicon({ m }: { m: MediaItem }) {
  useMediaVersion((s) => s.v);
  const ref = useRef<HTMLCanvasElement>(null);
  const e = getEntry(m.id);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = 240;
    c.height = 135;
    const g = c.getContext('2d')!;
    g.fillStyle = '#123227';
    g.fillRect(0, 0, 240, 135);
    if (!e?.peaks) return;
    g.fillStyle = '#4fd1a1';
    const n = e.peaks.length;
    for (let x = 0; x < 240; x++) {
      const a = Math.floor((x / 240) * n);
      const b = Math.max(a + 1, Math.floor(((x + 1) / 240) * n));
      let mx = 0;
      for (let i = a; i < b; i++) mx = Math.max(mx, e.peaks[i]);
      const h = Math.max(1, mx * 120);
      g.fillRect(x, 67 - h / 2, 1, h);
    }
  }, [e?.peaks]);
  return <canvas ref={ref} />;
}

function MediaBin() {
  const media = useStore((s) => s.project.media);
  const selected = useStore((s) => s.selectedMedia);
  const offline = useMediaVersion((s) => s.offline);
  const [q, setQ] = useState('');
  const [over, setOver] = useState(false);
  const [filter, setFilter] = useState<'all' | 'video' | 'audio' | 'image'>('all');
  const list = media.filter((m) => (filter === 'all' || m.kind === filter) && m.name.toLowerCase().includes(q.toLowerCase()));

  const menu = (e: React.MouseEvent, m: MediaItem) => {
    e.preventDefault();
    useStore.setState({ selectedMedia: m.id });
    useMenu.getState().open(e.clientX, e.clientY, [
      { label: 'Insert at playhead', icon: 'plus', action: () => useStore.getState().insertMedia(m.id) },
      {
        label: 'Relink / replace file…',
        icon: 'folder',
        action: async () => {
          const [f] = await pickFiles(m.kind + '/*', false);
          if (f) await relinkMedia(m, f);
        },
      },
      { sep: true },
      {
        label: 'Remove from project',
        icon: 'trash',
        danger: true,
        action: () => {
          const used = useStore.getState().project.clips.filter((c) => c.mediaId === m.id).length;
          if (used && !confirm(`"${m.name}" is used by ${used} clip(s) on the timeline. Remove them too?`)) return;
          useStore.getState().removeMedia(m.id);
          forgetMedia(m.id);
          deleteMediaBlob(m.id).catch(() => {});
        },
      },
    ]);
  };

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        importFiles(Array.from(e.dataTransfer.files));
      }}
      style={{ minHeight: '100%' }}
    >
      <div className="bin-tools">
        <button className="btn primary sm" onClick={importViaPicker}>
          <Icon name="upload" size={14} /> Import
        </button>
        <input className="search" placeholder="Search media…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div style={{ padding: '0 8px 8px' }}>
        <div className="seg">
          {(['all', 'video', 'audio', 'image'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {media.length === 0 ? (
        <div className={'dropzone' + (over ? ' over' : '')}>
          <Icon name="upload" size={28} />
          <div>
            <b>Drop video, audio or images here</b>
          </div>
          <div>or click Import. Files stay on this device.</div>
        </div>
      ) : (
        <div className="bin-grid">
          {list.map((m) => (
            <div
              key={m.id}
              className={'bin-item' + (selected === m.id ? ' sel' : '') + (offline[m.id] ? ' offline' : '')}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-fs-media', m.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => useStore.setState({ selectedMedia: m.id })}
              onDoubleClick={() => useStore.getState().insertMedia(m.id)}
              onContextMenu={(e) => menu(e, m)}
              title={`${m.name}\n${m.kind}${m.width ? ` · ${m.width}×${m.height}` : ''}${m.duration ? ` · ${formatShort(m.duration)}` : ''} · ${fmtBytes(m.size)}${offline[m.id] ? '\nOFFLINE — right-click to relink' : ''}\nDouble-click or drag to timeline`}
            >
              <div className="bin-thumb">
                <MediaThumb m={m} />
                <span className="bin-kind">
                  <Icon name={m.kind === 'video' ? 'film' : m.kind === 'audio' ? 'music' : 'image'} size={11} />
                </span>
                {m.duration > 0 && <span className="bin-dur">{formatShort(m.duration)}</span>}
              </div>
              <div className="bin-name">{m.name}</div>
            </div>
          ))}
        </div>
      )}
      {media.length > 0 && over && <div className="dropzone over">Drop to import</div>}
    </div>
  );
}

function Titles() {
  return (
    <div className="lib-section">
      <h4>Text presets — click or drag to timeline</h4>
      <div className="lib-grid">
        {TEXT_PRESETS.map((pr, i) => (
          <button
            key={pr.name}
            className="lib-item"
            draggable
            onDragStart={(e) => e.dataTransfer.setData('application/x-fs-text', String(i))}
            onClick={() => addTextPreset(pr)}
          >
            <div
              className="lib-swatch"
              style={{
                background: pr.style.boxEnabled ? pr.style.boxColor : '#0b0c0e',
                fontFamily: `"${pr.style.font ?? 'Inter'}"`,
                fontWeight: pr.style.weight ?? 800,
                fontStyle: pr.style.italic ? 'italic' : undefined,
                color: pr.style.color && pr.style.color !== 'rgba(0,0,0,0)' ? pr.style.color : '#fff',
                WebkitTextStroke: pr.style.strokeWidth ? `1px ${pr.style.strokeColor}` : undefined,
                textShadow: pr.style.shadowBlur ? `0 0 8px ${pr.style.shadowColor}` : undefined,
                fontSize: 13,
              }}
            >
              Aa
            </div>
            {pr.name}
          </button>
        ))}
      </div>
      <h4 style={{ marginTop: 16 }}>Generators</h4>
      <div className="lib-grid">
        <button className="lib-item" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-fs-gen', 'solid')} onClick={() => useStore.getState().addGenerated('solid')}>
          <div className="lib-swatch" style={{ background: '#13d47c' }} />
          Color Matte
        </button>
        <button className="lib-item" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-fs-gen', 'adjust')} onClick={() => useStore.getState().addGenerated('adjust')}>
          <div className="lib-swatch" style={{ background: 'linear-gradient(90deg,#333,#888)' }}>
            <Icon name="adjust" />
          </div>
          Adjustment Layer
        </button>
        <button
          className="lib-item"
          onClick={() => useStore.getState().addGenerated('solid', { name: 'Black Video', color: '#000000' })}
        >
          <div className="lib-swatch" style={{ background: '#000', border: '1px solid #333' }} />
          Black Video
        </button>
      </div>
    </div>
  );
}

function Effects() {
  const applyTrans = (type: TransitionType, where: 'in' | 'out' | 'both') =>
    applyToSelection((c) => {
      if (where !== 'out') c.transIn = { type, dur: c.transIn.dur || 0.5 };
      if (where !== 'in') c.transOut = { type: type === 'crossDissolve' ? 'fade' : type, dur: c.transOut.dur || 0.5 };
    }, `${type} transition`);
  return (
    <div className="lib-section">
      <h4>Color looks — applies to selected clips</h4>
      <div className="lib-grid">
        {COLOR_PRESETS.map((pr) => (
          <button
            key={pr.name}
            className="lib-item"
            onClick={() =>
              applyToSelection((c) => {
                for (const k of COLOR_KEYS) {
                  delete c.props[k];
                  delete c.keys[k];
                }
                delete c.props.blur;
                Object.assign(c.props, pr.props);
              }, `look "${pr.name}"`)
            }
          >
            <div className="lib-swatch" style={{ background: pr.swatch }} />
            {pr.name}
          </button>
        ))}
      </div>
      <h4 style={{ marginTop: 16 }}>Transitions — click: in & out · shift: in only · alt: out only</h4>
      <div className="lib-grid">
        {TRANSITIONS.filter((t) => t.type !== 'none').map((t) => (
          <button key={t.type} className="lib-item" onClick={(e) => applyTrans(t.type, e.shiftKey ? 'in' : e.altKey ? 'out' : 'both')}>
            <div className="lib-swatch" style={{ background: 'linear-gradient(90deg,#3d6fd1,#8a5cd6)' }}>
              <Icon name="sparkle" size={14} />
            </div>
            {t.name}
          </button>
        ))}
      </div>
      <h4 style={{ marginTop: 16 }}>Quick effects</h4>
      <div className="lib-grid">
        {[
          { n: 'Gaussian Blur', p: { blur: 12 } },
          { n: 'Vignette', p: { vignette: 55 } },
          { n: 'Drop Shadow', p: { shadow: 30 } },
          { n: 'Rounded', p: { radius: 48 } },
          { n: 'Picture in Picture', p: { scale: 35, x: 560, y: -280, radius: 24, shadow: 30 } },
          { n: 'Ken Burns', kb: true },
        ].map((fx) => (
          <button
            key={fx.n}
            className="lib-item"
            onClick={() =>
              applyToSelection((c) => {
                if (fx.kb) {
                  c.keys.scale = [
                    { t: 0, v: 100, ease: 'linear' },
                    { t: c.dur, v: 118, ease: 'linear' },
                  ];
                  c.keys.x = [
                    { t: 0, v: -30, ease: 'linear' },
                    { t: c.dur, v: 30, ease: 'linear' },
                  ];
                } else Object.assign(c.props, fx.p);
              }, fx.n)
            }
          >
            <div className="lib-swatch" style={{ background: '#2a2c31' }}>
              <Icon name="wand" size={14} />
            </div>
            {fx.n}
          </button>
        ))}
      </div>
    </div>
  );
}
