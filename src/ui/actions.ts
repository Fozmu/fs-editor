import type { MediaItem, TransitionType } from '../types';
import { useStore } from '../store';
import { detectKind, importFile, importPath } from '../engine/media';
import { desktop } from '../desktop';
import { makeClip } from '../engine/project';
import { textStyle, type TextPreset } from '../engine/presets';

export async function importFiles(files: File[]): Promise<MediaItem[]> {
  const st = useStore.getState();
  const ok = files.filter((f) => detectKind(f));
  const bad = files.length - ok.length;
  if (bad) st.toast(`${bad} file${bad > 1 ? 's' : ''} skipped (unsupported type)`, 'error');
  const out: MediaItem[] = [];
  for (const f of ok) {
    try {
      const m = await importFile(f);
      out.push(m);
      useStore.getState().addMedia([m]);
    } catch (e) {
      st.toast(`${f.name}: ${(e as Error).message}`, 'error');
    }
  }
  if (out.length) st.toast(`Imported ${out.length} file${out.length > 1 ? 's' : ''}`);
  return out;
}

export function pickFiles(accept = 'video/*,audio/*,image/*', multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = () => resolve(Array.from(inp.files ?? []));
    inp.click();
  });
}

export async function importViaPicker() {
  if (desktop) {
    const picked = await desktop.openMediaDialog(true);
    if (picked.length) await importPaths(picked);
    return;
  }
  const files = await pickFiles();
  if (files.length) await importFiles(files);
}

/** Desktop: import files by path (no copy; media is referenced from disk). */
export async function importPaths(list: { path: string; name: string; size: number }[]): Promise<MediaItem[]> {
  const st = useStore.getState();
  const out: MediaItem[] = [];
  for (const f of list) {
    try {
      const m = await importPath(f.path, f.name, f.size);
      out.push(m);
      useStore.getState().addMedia([m]);
    } catch (e) {
      st.toast(`${f.name}: ${(e as Error).message}`, 'error');
    }
  }
  if (out.length) st.toast(`Imported ${out.length} file${out.length > 1 ? 's' : ''}`);
  return out;
}

export function addTextPreset(pr: TextPreset, at?: { trackId: string; time: number }) {
  const st = useStore.getState();
  const patch = {
    name: pr.name,
    text: textStyle(pr.style),
    props: { ...(pr.props ?? {}) },
    transIn: { type: (pr.transIn ?? 'none') as TransitionType, dur: pr.transIn === 'typewriter' ? 1.5 : 0.5 },
    transOut: { type: (pr.transOut ?? 'none') as TransitionType, dur: 0.5 },
  };
  if (at) {
    let id = '';
    st.edit((p) => {
      const c = makeClip('text', at.trackId, at.time, 5, patch);
      id = c.id;
      p.clips.push(c);
    });
    st.select([id]);
  } else st.addGenerated('text', patch);
}

export function applyToSelection(fn: (c: import('../types').Clip) => void, what: string) {
  const st = useStore.getState();
  if (!st.selection.length) {
    st.toast(`Select a clip first to apply ${what}`, 'error');
    return;
  }
  st.edit((p) => {
    for (const c of p.clips) if (st.selection.includes(c.id)) fn(c);
  });
  st.toast(`Applied ${what}`);
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
