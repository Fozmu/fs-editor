// Exposes a narrow, typed bridge (see src/desktop.ts) to the renderer.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('fsDesktop', {
  info: invoke('app:info'),
  openMediaDialog: invoke('dialog:openMedia'),
  openProjectDialog: invoke('dialog:openProject'),
  readProject: invoke('project:read'),
  saveProject: invoke('project:save'),
  saveExportDialog: invoke('dialog:saveExport'),
  stat: invoke('file:stat'),
  fileOpen: invoke('file:open'),
  fileWrite: invoke('file:write'),
  fileClose: invoke('file:close'),
  fileRemove: invoke('file:remove'),
  showItem: invoke('shell:showItem'),
  probe: invoke('ffmpeg:probe'),
  proxy: invoke('ffmpeg:proxy'),
  exportStart: invoke('ffmpeg:exportStart'),
  exportFrame: invoke('ffmpeg:exportFrame'),
  exportEnd: invoke('ffmpeg:exportEnd'),
  installUpdate: invoke('update:install'),
  checkUpdate: invoke('update:check'),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  on: (channel, cb) => {
    const allowed = ['menu', 'project:openPath', 'update:status', 'ffmpeg:progress'];
    if (!allowed.includes(channel)) throw new Error('Channel not allowed: ' + channel);
    const fn = (_e, ...args) => cb(...args);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
