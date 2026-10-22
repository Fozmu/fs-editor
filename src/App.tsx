import { useEffect, useState } from 'react';
import { useStore } from './store';
import { getMeta, loadProject, requestPersistence, saveProject, setMeta } from './engine/storage';
import { restoreMedia } from './engine/media';
import { LeftPanel } from './ui/LeftPanel';
import { Viewer } from './ui/Viewer';
import { Inspector } from './ui/Inspector';
import { Timeline } from './ui/Timeline';
import { Dialogs } from './ui/Dialogs';
import { ContextMenu, MOD, Toasts } from './ui/common';
import { Icon } from './ui/Icon';
import { installShortcuts } from './ui/shortcuts';
import { importViaPicker } from './ui/actions';
import { DesktopUI } from './ui/DesktopUI';
import { saveProjectFile } from './ui/projectActions';
import { desktop } from './desktop';

function usePersistence() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      requestPersistence();
      try {
        const last = await getMeta<string>('lastProject');
        const p = last ? await loadProject(last) : undefined;
        if (p && alive) {
          useStore.getState().loadProject(p);
          await restoreMedia(p.media);
        }
      } catch (e) {
        console.warn('Could not restore project', e);
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let timer = 0;
    let lastSaved = useStore.getState().project;
    const save = () => {
      const p = useStore.getState().project;
      if (p === lastSaved) return;
      lastSaved = p;
      saveProject(p).catch((e) => useStore.getState().toast('Autosave failed: ' + e.message, 'error'));
      setMeta('lastProject', p.id).catch(() => {});
    };
    setMeta('lastProject', useStore.getState().project.id).catch(() => {});
    saveProject(useStore.getState().project).catch(() => {});
    const unsub = useStore.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      clearTimeout(timer);
      timer = window.setTimeout(save, 600);
    });
    const flush = () => save();
    window.addEventListener('beforeunload', flush);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', flush);
    };
  }, [ready]);
  return ready;
}

function useSplitters() {
  const [sizes, setSizes] = useState(() => {
    try {
      return { left: 300, right: 330, tl: 340, ...JSON.parse(localStorage.getItem('fs-layout') || '{}') };
    } catch {
      return { left: 300, right: 330, tl: 340 };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('fs-layout', JSON.stringify(sizes));
    } catch {
      /* ignore */
    }
  }, [sizes]);
  const drag = (which: 'left' | 'right' | 'tl') => (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const s0 = sizes[which];
    const move = (ev: PointerEvent) => {
      const v =
        which === 'left' ? s0 + ev.clientX - x0 : which === 'right' ? s0 - (ev.clientX - x0) : s0 - (ev.clientY - y0);
      const lim = which === 'tl' ? [150, window.innerHeight - 220] : [200, window.innerWidth * 0.4];
      setSizes((s: typeof sizes) => ({ ...s, [which]: Math.max(lim[0], Math.min(lim[1], v)) }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { sizes, drag };
}

export default function App() {
  const ready = usePersistence();
  const { sizes, drag } = useSplitters();
  const name = useStore((s) => s.project.name);
  const w = useStore((s) => s.project.width);
  const h = useStore((s) => s.project.height);
  const fps = useStore((s) => s.project.fps);
  const filePath = useStore((s) => s.project.filePath);
  const [dragging, setDragging] = useState(false);

  useEffect(() => installShortcuts(), []);

  useEffect(() => {
    // Block the browser from opening files dropped outside drop targets.
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        setDragging(true);
      }
    };
    const end = () => setDragging(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', end);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', end);
      window.removeEventListener('drop', drop);
    };
  }, []);

  useEffect(() => {
    document.title = `${name}${filePath ? ` (${filePath.split(/[\\/]/).pop()})` : ''} — F.S. Editor`;
  }, [name, filePath]);

  if (!ready) return <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--tx2)' }}>Loading F.S. Editor…</div>;

  return (
    <div
      className={'app' + (dragging ? ' dragging' : '')}
      style={{ ['--left-w' as string]: sizes.left + 'px', ['--right-w' as string]: sizes.right + 'px', ['--tl-h' as string]: sizes.tl + 'px' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <header className="topbar">
        <div className="brand">
          <div className="brand-badge">FS</div>
          F.S. Editor <small>by Fozmu Studios</small>
        </div>
        <input
          className="proj-name"
          value={name}
          onChange={(e) => useStore.getState().edit((p) => void (p.name = e.target.value), false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          title="Project name"
        />
        <span className="status">
          {w}×{h} · {fps} fps
        </span>
        <span className="spacer" />
        <div className="tb-group">
          <button className="btn ghost" onClick={() => useStore.setState({ dialog: 'projects' })} title="Projects">
            <Icon name="folder" size={14} /> Projects
          </button>
          {desktop && (
            <button className="btn ghost" onClick={() => saveProjectFile(false)} title={`Save project (${MOD}+S)`}>
              <Icon name="download" size={14} /> Save
            </button>
          )}
          <button className="btn ghost" onClick={importViaPicker} title={`Import media (${MOD}+I)`}>
            <Icon name="upload" size={14} /> Import
          </button>
          <button className="ibtn" onClick={() => useStore.setState({ dialog: 'settings' })} title="Sequence settings">
            <Icon name="settings" />
          </button>
          <button className="ibtn" onClick={() => useStore.setState({ dialog: 'shortcuts' })} title="Keyboard shortcuts (?)">
            <Icon name="keyboard" />
          </button>
        </div>
        <button className="btn primary" onClick={() => useStore.setState({ dialog: 'export', playing: false })} title={`Export (${MOD}+E)`}>
          <Icon name="download" size={14} /> Export
        </button>
      </header>
      <LeftPanel />
      <div className="split-v" style={{ gridArea: 'lsplit' }} onPointerDown={drag('left')} />
      <Viewer />
      <div className="split-v" style={{ gridArea: 'rsplit' }} onPointerDown={drag('right')} />
      <Inspector />
      <div className="split-h" onPointerDown={drag('tl')} />
      <Timeline />
      <Dialogs />
      <ContextMenu />
      <Toasts />
      <DesktopUI />
    </div>
  );
}
