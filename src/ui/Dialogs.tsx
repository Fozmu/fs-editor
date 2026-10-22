import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { exportRange, exportSize, exportVideo, pickSaveFile, type ExportProgress, type ExportSettings } from '../engine/export';
import { formatTC, newProject } from '../engine/project';
import { FPS_OPTIONS, RESOLUTIONS } from '../engine/presets';
import { deleteProjectRecord, listProjects, saveProject } from '../engine/storage';
import { restoreMedia } from '../engine/media';
import type { Project } from '../types';
import { Icon } from './Icon';
import { downloadBlob, pickFiles } from './actions';
import { MOD, Modal } from './common';

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const close = () => useStore.setState({ dialog: null });
  if (dialog === 'export') return <ExportDialog onClose={close} />;
  if (dialog === 'settings') return <SettingsDialog onClose={close} />;
  if (dialog === 'projects') return <ProjectsDialog onClose={close} />;
  if (dialog === 'shortcuts') return <ShortcutsDialog onClose={close} />;
  return null;
}

/* ---------------- export ---------------- */

const SETTINGS_KEY = 'fs-export-settings';

function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project);
  const [s, setS] = useState<ExportSettings>(() => {
    try {
      return { format: 'mp4', scale: 1, quality: 'high', range: 'all', audio: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'), fps: project.fps };
    } catch {
      return { format: 'mp4', scale: 1, fps: project.fps, quality: 'high', range: 'all', audio: true };
    }
  });
  const [name, setName] = useState(project.name);
  const [prog, setProg] = useState<ExportProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const hasInOut = project.inPoint !== null || project.outPoint !== null;
  const [t0, t1] = exportRange(project, s);
  const [W, H] = exportSize(project, s.scale);
  const running = prog !== null && !done && !err;

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* storage may be unavailable */
    }
  }, [s]);

  const start = async () => {
    setErr(null);
    setDone(null);
    useStore.getState().setPlaying(false);
    let handle: FileSystemFileHandle | null = null;
    try {
      handle = await pickSaveFile(name, s.format);
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
    const ac = new AbortController();
    abort.current = ac;
    setProg({ stage: 'Starting', frac: 0 });
    const t = performance.now();
    try {
      const blob = await exportVideo(project, s, setProg, ac.signal, handle);
      if (blob) downloadBlob(blob, `${name}.${s.format}`);
      setDone(`Exported in ${((performance.now() - t) / 1000).toFixed(1)}s${handle ? ` to ${handle.name}` : ''}.`);
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') {
        setProg(null);
        useStore.getState().toast('Export canceled');
      } else {
        console.error(e);
        setErr((e as Error).message || String(e));
      }
    }
  };

  const upd = (patch: Partial<ExportSettings>) => setS((x) => ({ ...x, ...patch }));

  return (
    <Modal
      title="Export Media"
      onClose={() => {
        if (running) abort.current?.abort();
        onClose();
      }}
      footer={
        running ? (
          <button className="btn danger" onClick={() => abort.current?.abort()}>
            Cancel export
          </button>
        ) : (
          <>
            <button className="btn ghost" onClick={onClose}>
              Close
            </button>
            <button className="btn primary" onClick={start} disabled={t1 - t0 <= 0}>
              <Icon name="download" size={14} /> {done ? 'Export again' : 'Export'}
            </button>
          </>
        )
      }
    >
      <label className="field">
        <span>File name</span>
        <input className="txt" value={name} onChange={(e) => setName(e.target.value)} disabled={running} />
      </label>
      <div className="field">
        <span>Format</span>
        <div className="seg">
          <button className={s.format === 'mp4' ? 'on' : ''} onClick={() => upd({ format: 'mp4' })} disabled={running}>
            MP4 (H.264 / AAC)
          </button>
          <button className={s.format === 'webm' ? 'on' : ''} onClick={() => upd({ format: 'webm' })} disabled={running}>
            WebM (VP9 / Opus)
          </button>
        </div>
      </div>
      <div className="field">
        <span>Resolution</span>
        <select className="select" value={s.scale} onChange={(e) => upd({ scale: +e.target.value })} disabled={running}>
          {[2, 1.5, 1, 0.75, 0.5, 0.25].map((sc) => {
            const [w, h] = exportSize(project, sc);
            return (
              <option key={sc} value={sc}>
                {w} × {h} {sc === 1 ? '(sequence)' : `(${sc * 100}%)`}
              </option>
            );
          })}
        </select>
      </div>
      <div className="field">
        <span>Frame rate</span>
        <select className="select" value={s.fps} onChange={(e) => upd({ fps: +e.target.value })} disabled={running}>
          {[...new Set([...FPS_OPTIONS, project.fps])].sort((a, b) => a - b).map((f) => (
            <option key={f} value={f}>
              {f} fps
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span>Quality</span>
        <div className="seg">
          {(['low', 'medium', 'high', 'very_high'] as const).map((q) => (
            <button key={q} className={s.quality === q ? 'on' : ''} onClick={() => upd({ quality: q })} disabled={running}>
              {q === 'very_high' ? 'Max' : q[0].toUpperCase() + q.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Range</span>
        <div className="seg">
          <button className={s.range === 'all' ? 'on' : ''} onClick={() => upd({ range: 'all' })} disabled={running}>
            Entire sequence
          </button>
          <button className={s.range === 'inout' ? 'on' : ''} onClick={() => upd({ range: 'inout' })} disabled={running || !hasInOut}>
            In → Out
          </button>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={s.audio} onChange={(e) => upd({ audio: e.target.checked })} disabled={running} /> Include audio
      </label>
      <div className="note">
        {W}×{H} · {s.fps} fps · {formatTC(t1 - t0, s.fps)} · {Math.round((t1 - t0) * s.fps)} frames. Rendering runs locally with hardware encoding when available (WebCodecs).
      </div>
      {prog && (
        <div>
          <div className="progress">
            <div style={{ width: `${(prog.frac * 100).toFixed(1)}%` }} />
          </div>
          <div className="note" style={{ marginTop: 6 }}>
            {prog.stage} — {(prog.frac * 100).toFixed(0)}%{prog.eta !== undefined && !done ? ` · ~${Math.ceil(prog.eta)}s left` : ''}
          </div>
        </div>
      )}
      {done && <div style={{ color: 'var(--ok)' }}>✓ {done}</div>}
      {err && <div style={{ color: 'var(--danger)' }}>Export failed: {err}</div>}
    </Modal>
  );
}

/* ---------------- sequence settings ---------------- */

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const p = useStore((s) => s.project);
  const [w, setW] = useState(p.width);
  const [h, setH] = useState(p.height);
  const [fps, setFps] = useState(p.fps);
  const [bg, setBg] = useState(p.bg);
  const [name, setName] = useState(p.name);
  const apply = () => {
    useStore.getState().edit((d) => {
      d.width = Math.max(16, Math.round(w / 2) * 2);
      d.height = Math.max(16, Math.round(h / 2) * 2);
      d.fps = fps;
      d.bg = bg;
      d.name = name || 'Untitled Project';
    });
    onClose();
  };
  return (
    <Modal
      title="Sequence Settings"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={apply}>
            Apply
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input className="txt" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span>Preset</span>
        <select
          className="select"
          value={RESOLUTIONS.find((r) => r.w === w && r.h === h)?.name ?? 'custom'}
          onChange={(e) => {
            const r = RESOLUTIONS.find((x) => x.name === e.target.value);
            if (r) {
              setW(r.w);
              setH(r.h);
            }
          }}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r.name}>{r.name}</option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </div>
      <div className="field">
        <span>Frame size</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input className="txt" type="number" value={w} onChange={(e) => setW(+e.target.value)} style={{ width: 100 }} />×
          <input className="txt" type="number" value={h} onChange={(e) => setH(+e.target.value)} style={{ width: 100 }} />
        </div>
      </div>
      <div className="field">
        <span>Frame rate</span>
        <select className="select" value={fps} onChange={(e) => setFps(+e.target.value)}>
          {FPS_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f} fps
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span>Background</span>
        <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
      </div>
      <div className="note">Clip positions are relative to the frame center, so changing size keeps layouts centered.</div>
    </Modal>
  );
}

/* ---------------- projects ---------------- */

function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const cur = useStore((s) => s.project);
  const [list, setList] = useState<Project[] | null>(null);
  const [preset, setPreset] = useState(RESOLUTIONS[2].name);
  const refresh = () => listProjects().then((l) => setList(l.sort((a, b) => b.updatedAt - a.updatedAt)));
  useEffect(() => {
    saveProject(useStore.getState().project).then(refresh);
  }, []);

  const open = async (p: Project) => {
    await saveProject(useStore.getState().project);
    useStore.getState().loadProject(p);
    await restoreMedia(p.media);
    onClose();
  };
  const create = async () => {
    await saveProject(useStore.getState().project);
    const r = RESOLUTIONS.find((x) => x.name === preset)!;
    const p = newProject('Untitled Project', r.w, r.h);
    useStore.getState().loadProject(p);
    await saveProject(p);
    onClose();
  };
  const exportJson = (p: Project) => downloadBlob(new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' }), `${p.name}.fsproj`);
  const importJson = async () => {
    const [f] = await pickFiles('.fsproj,.json,application/json', false);
    if (!f) return;
    try {
      const p = JSON.parse(await f.text()) as Project;
      if (!p.tracks || !p.clips) throw new Error('Not an F.S. Editor project');
      p.id = Math.random().toString(36).slice(2, 12);
      p.name += ' (imported)';
      await saveProject(p);
      await open(p);
      useStore.getState().toast('Project imported — relink any offline media via right-click in Project Media');
    } catch (e) {
      useStore.getState().toast('Import failed: ' + (e as Error).message, 'error');
    }
  };

  return (
    <Modal title="Projects" onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select className="select" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {RESOLUTIONS.map((r) => (
            <option key={r.name}>{r.name}</option>
          ))}
        </select>
        <button className="btn primary" onClick={create}>
          <Icon name="plus" size={14} /> New project
        </button>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn" onClick={importJson}>
          <Icon name="upload" size={14} /> Open .fsproj
        </button>
      </div>
      <div className="proj-list">
        {list === null && <div className="note">Loading…</div>}
        {list?.map((p) => (
          <div key={p.id} className={'proj-row' + (p.id === cur.id ? ' cur' : '')}>
            <Icon name="film" size={20} />
            <div className="grow">
              <div style={{ fontWeight: 700 }}>{p.name}</div>
              <div className="meta">
                {p.width}×{p.height} · {p.fps} fps · {p.clips.length} clips · {p.media.length} media · edited {new Date(p.updatedAt).toLocaleString()}
              </div>
            </div>
            {p.id !== cur.id && (
              <button className="btn sm" onClick={() => open(p)}>
                Open
              </button>
            )}
            <button className="btn sm ghost" title="Download project file (without media)" onClick={() => exportJson(p.id === cur.id ? cur : p)}>
              <Icon name="download" size={13} />
            </button>
            {p.id !== cur.id && (
              <button
                className="btn sm danger"
                onClick={async () => {
                  if (!confirm(`Delete project "${p.name}"? This can't be undone.`)) return;
                  await deleteProjectRecord(p.id);
                  refresh();
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="note">Projects and imported media are stored in this browser (IndexedDB) and autosave continuously. Project files (.fsproj) contain the edit only; media is relinked on open.</div>
    </Modal>
  );
}

/* ---------------- shortcuts ---------------- */

export const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['K', 'Pause'],
  ['J / L', 'Back / forward 1 s'],
  ['← / →', 'Step 1 frame'],
  ['Shift + ← / →', 'Step 1 second'],
  ['↑ / ↓', 'Previous / next edit point'],
  ['Home / End', 'Go to start / end'],
  ['V', 'Selection tool'],
  ['C', 'Razor tool'],
  ['B', 'Ripple edit tool'],
  ['Y', 'Slip tool'],
  ['S  or  ' + MOD + '+K', 'Split at playhead'],
  ['Del / Backspace', 'Delete'],
  ['Shift + Del', 'Ripple delete'],
  [MOD + '+Z', 'Undo'],
  [MOD + '+Shift+Z / ' + MOD + '+Y', 'Redo'],
  [MOD + '+C / X / V', 'Copy / cut / paste'],
  [MOD + '+D', 'Duplicate'],
  [MOD + '+A', 'Select all'],
  ['Esc', 'Deselect'],
  ['M', 'Add marker'],
  ['I / O', 'Mark in / out'],
  ['Alt+X', 'Clear in / out'],
  ['N', 'Toggle snapping'],
  ['= / -', 'Zoom timeline'],
  ['\\', 'Zoom to fit'],
  ['T', 'Add text'],
  [MOD + '+I', 'Import media'],
  [MOD + '+E', 'Export'],
  [MOD + '+S', 'Save'],
  ['Alt + drag', 'Duplicate clips while moving'],
  [MOD + ' + scroll', 'Zoom timeline at cursor'],
  ['?', 'This list'],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose} wide>
      <div className="kbd-grid">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="kbd-row">
            <span>{d}</span>
            <kbd>{k}</kbd>
          </div>
        ))}
      </div>
    </Modal>
  );
}
