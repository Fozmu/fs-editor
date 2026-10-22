import type { Project } from '../types';
import { useStore } from '../store';
import { desktop } from '../desktop';
import { newProject } from '../engine/project';
import { restoreMedia, useMediaVersion } from '../engine/media';
import { saveProject } from '../engine/storage';
import { RESOLUTIONS } from '../engine/presets';
import { downloadBlob, pickFiles } from './actions';

export async function createProject(preset = RESOLUTIONS[2]) {
  await saveProject(useStore.getState().project);
  const p = newProject('Untitled Project', preset.w, preset.h);
  useStore.getState().loadProject(p);
  await saveProject(p);
}

export async function openProject(p: Project) {
  const cur = useStore.getState().project;
  if (cur.id !== p.id) await saveProject(cur);
  useStore.getState().loadProject(p);
  await restoreMedia(p.media);
  await saveProject(useStore.getState().project);
}

/** Parses a .fsproj file. Keeps its id so reopening the same file updates the same library entry. */
export async function openProjectText(text: string, filePath?: string) {
  const st = useStore.getState();
  try {
    const p = JSON.parse(text) as Project;
    if (!p.tracks || !p.clips || !p.media) throw new Error('Not an F.S. Editor project');
    p.filePath = filePath;
    if (!filePath) {
      p.id = Math.random().toString(36).slice(2, 12);
      p.name += ' (imported)';
    }
    await openProject(p);
    const off = useMediaVersion.getState().offline;
    const offline = p.media.filter((m) => off[m.id]).length;
    if (offline) st.toast('Some media is offline — right-click it in Project Media to relink');
  } catch (e) {
    st.toast('Could not open project: ' + (e as Error).message, 'error');
  }
}

export async function openProjectPath(path: string) {
  if (!desktop) return;
  const r = await desktop.readProject(path);
  await openProjectText(r.text, r.path);
}

export async function openProjectDialog() {
  if (desktop) {
    const r = await desktop.openProjectDialog();
    if (r) await openProjectText(r.text, r.path);
    return;
  }
  const [f] = await pickFiles('.fsproj,.json,application/json', false);
  if (f) await openProjectText(await f.text());
}

const serialize = (p: Project) => {
  const { filePath: _skip, ...rest } = p;
  void _skip;
  return JSON.stringify(rest, null, 1);
};

/** Save: desktop writes the .fsproj file (asking for a location the first time); web saves to the browser library. */
export async function saveProjectFile(saveAs = false) {
  const st = useStore.getState();
  const p = st.project;
  await saveProject(p);
  if (desktop) {
    const path = await desktop.saveProject({ path: p.filePath, text: serialize(p), name: p.name, saveAs });
    if (!path) return;
    if (path !== p.filePath) st.edit((d) => void (d.filePath = path), false);
    st.toast(`Saved ${path.split(/[\\/]/).pop()}`);
    return;
  }
  if (saveAs) downloadBlob(new Blob([serialize(p)], { type: 'application/json' }), `${p.name}.fsproj`);
  else st.toast('Project saved');
}

export function downloadProjectFile(p: Project) {
  downloadBlob(new Blob([serialize(p)], { type: 'application/json' }), `${p.name}.fsproj`);
}
