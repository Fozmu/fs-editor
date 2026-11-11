import { useStore } from '../store';
import { clipEnd, projectDuration } from '../engine/project';
import { TEXT_PRESETS } from '../engine/presets';
import { addTextPreset, importViaPicker } from './actions';
import { createProject, openProjectDialog, saveProjectFile } from './projectActions';

function editPoints() {
  const p = useStore.getState().project;
  const s = new Set<number>([0]);
  for (const c of p.clips) {
    s.add(c.start);
    s.add(clipEnd(c));
  }
  return [...s].sort((a, b) => a - b);
}

export function installShortcuts() {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const st = useStore.getState();
    if (st.dialog) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const fps = st.project.fps;
    const handled = () => e.preventDefault();

    if (mod) {
      switch (k.toLowerCase()) {
        case 'z':
          e.shiftKey ? st.redo() : st.undo();
          return handled();
        case 'y':
          st.redo();
          return handled();
        case 'c':
          st.copy();
          return handled();
        case 'x':
          st.copy();
          st.deleteSelected();
          return handled();
        case 'v':
          st.paste();
          return handled();
        case 'd':
          st.duplicate();
          return handled();
        case 'a':
          st.selectAll();
          return handled();
        case 'k':
          st.splitAtPlayhead();
          return handled();
        case 'e':
          st.set({ dialog: 'export', playing: false });
          return handled();
        case 'i':
          importViaPicker();
          return handled();
        case 's':
          saveProjectFile(e.shiftKey);
          return handled();
        case 'o':
          openProjectDialog();
          return handled();
        case 'n':
          createProject();
          return handled();
      }
      return;
    }

    switch (k) {
      case ' ':
        st.setPlaying(!st.playing);
        return handled();
      case 'k':
      case 'K':
        st.setPlaying(false);
        return handled();
      case 'j':
      case 'J':
        st.setPlayhead(st.playhead - 1);
        return handled();
      case 'l':
      case 'L':
        st.setPlayhead(st.playhead + 1);
        return handled();
      case 'ArrowLeft':
        st.setPlaying(false);
        st.setPlayhead(st.playhead - (e.shiftKey ? 1 : 1 / fps));
        return handled();
      case 'ArrowRight':
        st.setPlaying(false);
        st.setPlayhead(st.playhead + (e.shiftKey ? 1 : 1 / fps));
        return handled();
      case 'ArrowUp':
        st.setPlayhead([...editPoints()].reverse().find((x) => x < st.playhead - 1e-4) ?? 0);
        return handled();
      case 'ArrowDown':
        st.setPlayhead(editPoints().find((x) => x > st.playhead + 1e-4) ?? projectDuration(st.project));
        return handled();
      case 'Home':
        st.setPlayhead(0);
        return handled();
      case 'End':
        st.setPlayhead(projectDuration(st.project));
        return handled();
      case 'Delete':
      case 'Backspace':
        st.deleteSelected(e.shiftKey);
        return handled();
      case 'Escape':
        st.select([]);
        return handled();
      case 'v':
      case 'V':
        st.set({ tool: 'select' });
        return handled();
      case 'c':
      case 'C':
        st.set({ tool: 'razor' });
        return handled();
      case 'b':
      case 'B':
        st.set({ tool: 'ripple' });
        return handled();
      case 'y':
      case 'Y':
        st.set({ tool: 'slip' });
        return handled();
      case 's':
      case 'S':
        st.splitAtPlayhead();
        return handled();
      case 'm':
      case 'M':
        st.addMarker();
        return handled();
      case 'i':
      case 'I':
        st.setIn();
        return handled();
      case 'o':
      case 'O':
        st.setOut();
        return handled();
      case 'x':
      case 'X':
      case '≈':
        if (e.altKey) {
          st.clearInOut();
          return handled();
        }
        return;
      case 'n':
      case 'N':
        st.set({ snapping: !st.snapping });
        st.toast(`Snapping ${!st.snapping ? 'on' : 'off'}`);
        return handled();
      case '=':
      case '+':
        st.set({ zoom: Math.min(800, st.zoom * 1.4) });
        return handled();
      case '-':
      case '_':
        st.set({ zoom: Math.max(1, st.zoom / 1.4) });
        return handled();
      case '\\': {
        const el = document.querySelector('.tl-scroll') as HTMLElement | null;
        const d = Math.max(1, projectDuration(st.project));
        st.set({ zoom: Math.min(800, Math.max(1, ((el?.clientWidth ?? 1000) - 40) / d)) });
        return handled();
      }
      case 'p':
      case 'P':
        if (st.selection.length === 1) st.toggleMotionKey(st.selection[0]);
        return handled();
      case 't':
      case 'T':
        addTextPreset(TEXT_PRESETS[0]);
        return handled();
      case '?':
        st.set({ dialog: 'shortcuts' });
        return handled();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/** Commands sent from the desktop app menu. */
export function runCommand(cmd: string) {
  const st = useStore.getState();
  switch (cmd) {
    case 'new':
      return createProject();
    case 'open':
      return openProjectDialog();
    case 'projects':
      return st.set({ dialog: 'projects' });
    case 'save':
      return saveProjectFile(false);
    case 'saveAs':
      return saveProjectFile(true);
    case 'import':
      return importViaPicker();
    case 'export':
      return st.set({ dialog: 'export', playing: false });
    case 'settings':
      return st.set({ dialog: 'settings' });
    case 'undo':
      return st.undo();
    case 'redo':
      return st.redo();
    case 'split':
      return st.splitAtPlayhead();
    case 'marker':
      return st.addMarker();
    case 'shortcuts':
      return st.set({ dialog: 'shortcuts' });
    case 'tour':
      return st.set({ dialog: 'tour' });
  }
}
