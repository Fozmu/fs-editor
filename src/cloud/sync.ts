import type { MediaItem, Project } from '../types';
import { desktop } from '../desktop';
import { useMediaVersion } from '../engine/media';
import { loadMediaBlob, saveMediaBlob, saveProject } from '../engine/storage';
import { uid } from '../engine/project';
import { accessToken } from './auth';
import { CLOUD } from './config';

/** Cloud projects: the edit (JSON) plus every media file it uses, stored per account. */

export interface CloudProjectInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  clips: number;
  media: number;
  mediaBytes: number;
  updatedAt: number;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const r = await fetch(`${CLOUD.api}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error || `Cloud error (${r.status})`);
  return data as T;
}

export const listCloudProjects = () => api<CloudProjectInfo[]>('/v1/projects');
export const cloudUsage = () => api<{ usedBytes: number; quotaBytes: number }>('/v1/me');
export const deleteCloudProject = (id: string) => api<{ ok: boolean }>(`/v1/projects/${id}`, { method: 'DELETE' });

export const formatBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(0)} MB` : `${Math.ceil(n / 1024)} KB`;

/* ---------------- progress ---------------- */

function progress(label: string, total: number) {
  let done = 0;
  const set = (cur: number) => useMediaVersion.setState({ busy: { label, frac: total ? Math.min(1, (done + cur) / total) : 0 } });
  set(0);
  return {
    set,
    add: (n: number) => {
      done += n;
      set(0);
    },
    end: () => useMediaVersion.setState({ busy: null }),
  };
}

/** Desktop transfers report progress over IPC by job id. */
async function desktopJob<T>(fn: (job: string) => Promise<T>, onBytes: (n: number) => void): Promise<T> {
  const job = uid();
  const off = desktop!.on('cloud:progress', (p) => p.jobId === job && onBytes(p.bytes));
  try {
    return await fn(job);
  } finally {
    off();
  }
}

function xhrPut(url: string, blob: Blob, onBytes: (n: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => (x.status < 300 ? resolve() : reject(new Error(`Upload failed (${x.status})`)));
    x.onerror = () => reject(new Error('Upload failed (network)'));
    x.send(blob);
  });
}

/* ---------------- upload ---------------- */

type Source = { m: MediaItem; size: number; path?: string; blob?: Blob };

async function mediaSource(m: MediaItem): Promise<Source | null> {
  if (desktop && m.path) {
    const st = await desktop.stat(m.path);
    return st.exists ? { m, size: st.size, path: m.path } : null;
  }
  const blob = await loadMediaBlob(m.id).catch(() => undefined);
  return blob ? { m, size: blob.size, blob } : null;
}

/** Uploads the project and any media the cloud doesn't have yet. Returns names of media that was offline here. */
export async function uploadProject(p: Project): Promise<{ uploaded: number; missing: string[] }> {
  const sources: Source[] = [];
  const missing: string[] = [];
  for (const m of p.media) {
    const s = await mediaSource(m);
    if (s) sources.push(s);
    else missing.push(m.name);
  }
  const plan = await api<{ items: { id: string; exists: boolean; url?: string }[] }>('/v1/media/upload', {
    method: 'POST',
    body: JSON.stringify({ items: sources.map((s) => ({ id: s.m.id, size: s.size })) }),
  });
  const todo = plan.items.filter((i) => !i.exists && i.url).map((i) => ({ ...sources.find((s) => s.m.id === i.id)!, url: i.url! }));
  const bar = progress('Uploading to cloud', todo.reduce((n, t) => n + t.size, 0));
  try {
    for (const t of todo) {
      if (t.path) await desktopJob((job) => desktop!.cloudUpload(t.path!, t.url, job), bar.set);
      else await xhrPut(t.url, t.blob!, bar.set);
      bar.add(t.size);
    }
    await api(`/v1/projects/${p.id}`, { method: 'PUT', body: JSON.stringify(forCloud(p)) });
  } finally {
    bar.end();
  }
  return { uploaded: todo.length, missing };
}

/** Machine-specific bits stay local: proxies are regenerated, the .fsproj path belongs to one PC. */
function forCloud(p: Project): Project {
  const { filePath: _f, ...rest } = p;
  void _f;
  return { ...rest, media: p.media.map(({ proxyPath: _p, ...m }) => (void _p, m)) };
}

/* ---------------- download ---------------- */

/** Fetches a cloud project, downloads media this device doesn't have, saves it to the local library. */
export async function downloadProject(id: string): Promise<Project> {
  const p = await api<Project>(`/v1/projects/${id}`);
  const need: MediaItem[] = [];
  for (const m of p.media) {
    if (desktop) {
      if (m.path && (await desktop.stat(m.path)).exists) continue; // same PC: original file is here
      const cached = await desktop.cloudCachePath(m.id, m.name);
      const st = await desktop.stat(cached);
      m.path = cached;
      if (st.exists && (!m.size || st.size === m.size)) continue;
      need.push(m);
    } else {
      delete m.path;
      if (!(await loadMediaBlob(m.id).catch(() => undefined))) need.push(m);
    }
  }
  if (need.length) {
    const { items } = await api<{ items: { id: string; url: string | null; size: number }[] }>('/v1/media/download', {
      method: 'POST',
      body: JSON.stringify({ ids: need.map((m) => m.id) }),
    });
    const bar = progress('Downloading from cloud', items.reduce((n, i) => n + i.size, 0));
    try {
      for (const it of items) {
        const m = need.find((x) => x.id === it.id)!;
        if (!it.url) continue; // never uploaded (was offline on the uploading PC): shows as offline, relink as usual
        if (desktop) await desktopJob((job) => desktop!.cloudDownload(it.url!, m.path!, job), bar.set);
        else {
          const r = await fetch(it.url);
          if (!r.ok) throw new Error(`Download failed (${r.status})`);
          await saveMediaBlob(m.id, new File([await r.blob()], m.name, { type: m.mime }));
        }
        bar.add(it.size);
      }
    } finally {
      bar.end();
    }
  }
  await saveProject(p);
  return p;
}
