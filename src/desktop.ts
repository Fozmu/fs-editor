/** Bridge to the Electron shell (undefined in the web build). See electron/preload.cjs. */
export interface DesktopBridge {
  info(): Promise<{ version: string; platform: string; packaged: boolean }>;
  openMediaDialog(multi?: boolean): Promise<{ path: string; name: string; size: number }[]>;
  openProjectDialog(): Promise<{ path: string; text: string } | null>;
  readProject(path: string): Promise<{ path: string; text: string }>;
  saveProject(o: { path?: string; text: string; name: string; saveAs?: boolean }): Promise<string | null>;
  saveExportDialog(o: { name: string; ext: string; label?: string }): Promise<string | null>;
  stat(path: string): Promise<{ exists: boolean; size: number }>;
  fileOpen(path: string): Promise<number>;
  fileWrite(id: number, position: number, data: Uint8Array): Promise<void>;
  fileClose(id: number): Promise<void>;
  fileRemove(path: string): Promise<void>;
  showItem(path: string): Promise<void>;
  probe(path: string): Promise<{ duration: number; width: number; height: number; hasVideo: boolean; hasAudio: boolean }>;
  proxy(path: string, jobId: string): Promise<string>;
  exportStart(o: { path: string; width: number; height: number; fps: number; codec: FfmpegCodec; audioWav?: Uint8Array }): Promise<number>;
  exportFrame(id: number, rgba: Uint8Array): Promise<void>;
  exportEnd(id: number, cancel?: boolean): Promise<void>;
  installUpdate(): Promise<void>;
  checkUpdate(): Promise<void>;
  pathForFile(f: File): string | null;
  on(channel: 'menu', cb: (cmd: string) => void): () => void;
  on(channel: 'project:openPath', cb: (path: string) => void): () => void;
  on(channel: 'update:status', cb: (s: UpdateStatus) => void): () => void;
  on(channel: 'ffmpeg:progress', cb: (p: { jobId: string; frac: number }) => void): () => void;
}

export type FfmpegCodec = 'prores' | 'h265' | 'h264' | 'gif';

export type UpdateStatus =
  | { state: 'checking' | 'none' }
  | { state: 'available' | 'ready'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'error'; message: string };

export const desktop: DesktopBridge | undefined = (globalThis as unknown as { fsDesktop?: DesktopBridge }).fsDesktop;

export const mediaUrl = (path: string) => 'media://local/' + encodeURIComponent(path);
