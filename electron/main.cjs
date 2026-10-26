// F.S. Editor — Electron main process.
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DIST = path.join(__dirname, '..', 'dist');
const APP_ORIGIN = 'app://fs';

const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } },
]);

// Single instance: a second launch (e.g. double-clicking a .fsproj) is forwarded to the running window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** @type {BrowserWindow | null} */
let win = null;
let pendingOpen = findProjectArg(process.argv);

function findProjectArg(argv) {
  return argv.slice(1).find((a) => /\.fsproj$/i.test(a) && fs.existsSync(a)) || null;
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

/* ---------------- protocols ---------------- */

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.flac': 'audio/flac', '.opus': 'audio/ogg', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif',
};
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: media:",
  "media-src 'self' blob: media:",
  "connect-src 'self' blob: media:",
  "worker-src 'self' blob:",
].join('; ');

function registerProtocols() {
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Type', mimeOf(file));
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: 200, headers });
  });

  // media://local/<encoded absolute path> — streams local files with HTTP range support.
  protocol.handle('media', async (req) => {
    const url = new URL(req.url);
    const file = decodeURIComponent(url.pathname.slice(1));
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const size = st.size;
    const headers = {
      'Content-Type': mimeOf(file),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    };
    const range = req.headers.get('Range');
    const m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (!m[1] && m[2]) {
        start = Math.max(0, size - parseInt(m[2], 10));
        end = size - 1;
      }
      end = Math.min(end, size - 1);
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
      const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
      return new Response(body, {
        status: 206,
        headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
      });
    }
    const body = Readable.toWeb(fs.createReadStream(file));
    return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  });
}

/* ---------------- window & menu ---------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0c0d0f',
    title: 'F.S. Editor',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  win.webContents.on('did-finish-load', () => {
    if (pendingOpen) {
      send('project:openPath', pendingOpen);
      pendingOpen = null;
    }
  });
  win.on('closed', () => (win = null));
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL(`${APP_ORIGIN}/index.html`);
}

function buildMenu() {
  const cmd = (id) => () => send('menu', id);
  const noAccel = { registerAccelerator: false };
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', ...noAccel, click: cmd('new') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', ...noAccel, click: cmd('open') },
        { label: 'Projects…', click: cmd('projects') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', ...noAccel, click: cmd('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', ...noAccel, click: cmd('saveAs') },
        { type: 'separator' },
        { label: 'Import Media…', accelerator: 'CmdOrCtrl+I', ...noAccel, click: cmd('import') },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', ...noAccel, click: cmd('export') },
        { type: 'separator' },
        { label: 'Sequence Settings…', click: cmd('settings') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', ...noAccel, click: cmd('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', ...noAccel, click: cmd('redo') },
        { type: 'separator' },
        // Text editing roles for inputs; timeline copy/paste is handled by the app's own shortcuts.
        ...(isMac ? [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] : []),
        { label: 'Split at Playhead', accelerator: 'S', ...noAccel, click: cmd('split') },
        { label: 'Add Marker', accelerator: 'M', ...noAccel, click: cmd('marker') },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Show Tutorial', click: cmd('tour') },
        { label: 'Keyboard Shortcuts', accelerator: '?', ...noAccel, click: cmd('shortcuts') },
        { label: 'Check for Updates…', click: () => checkForUpdates(true) },
        { type: 'separator' },
        { label: `About F.S. Editor ${app.getVersion()}`, click: () => dialog.showMessageBox({ title: 'F.S. Editor', message: `F.S. Editor ${app.getVersion()}`, detail: 'Video editor by Fozmu Studios.' }) },
      ],
    },
    // Version shown right of Help; a disabled top-level item with no submenu.
    { label: `v${app.getVersion()}`, enabled: false },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- auto update ---------------- */

let updater = null;
function setupUpdater() {
  if (!app.isPackaged) return;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch {
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => send('update:status', { state: 'checking' }));
  updater.on('update-available', (i) => send('update:status', { state: 'available', version: i.version }));
  updater.on('update-not-available', () => send('update:status', { state: 'none' }));
  updater.on('download-progress', (p) => send('update:status', { state: 'downloading', percent: p.percent }));
  updater.on('update-downloaded', (i) => send('update:status', { state: 'ready', version: i.version }));
  updater.on('error', (e) => send('update:status', { state: 'error', message: String(e && e.message ? e.message : e) }));
  setTimeout(() => checkForUpdates(false), 4000);
  setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000);
}

function checkForUpdates(manual) {
  if (!updater) {
    if (manual) dialog.showMessageBox({ message: 'Updates are only available in the installed app.' });
    return;
  }
  updater.checkForUpdates().catch((e) => manual && dialog.showMessageBox({ type: 'error', message: 'Update check failed', detail: String(e) }));
}

/* ---------------- ffmpeg ---------------- */

function runFfmpeg(args, onStderr) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', ...args], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      if (err.length > 200000) err = err.slice(-100000);
      onStderr?.(s);
    });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, stderr: err }));
  });
}

function parseDuration(s) {
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

async function probe(file) {
  const { stderr } = await runFfmpeg(['-i', file]);
  const v = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(stderr);
  return {
    duration: parseDuration(stderr),
    width: v ? +v[1] : 0,
    height: v ? +v[2] : 0,
    hasVideo: /Stream #[^\n]*Video:/.test(stderr) && !/Video: (png|mjpeg)[^\n]*\(attached pic\)/.test(stderr),
    hasAudio: /Stream #[^\n]*Audio:/.test(stderr),
  };
}

/** Transcodes an unplayable file to an edit-friendly H.264/AAC proxy (cached by path+mtime). */
async function makeProxy(file, jobId) {
  const st = await fsp.stat(file);
  const key = crypto.createHash('sha1').update(file + '|' + st.size + '|' + st.mtimeMs).digest('hex').slice(0, 16);
  const dir = path.join(app.getPath('userData'), 'proxies');
  await fsp.mkdir(dir, { recursive: true });
  const info = await probe(file);
  const out = path.join(dir, key + (info.hasVideo ? '.mp4' : '.m4a'));
  if (fs.existsSync(out)) return out;
  const tmp = out + '.part' + path.extname(out);
  const args = info.hasVideo
    ? ['-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', tmp]
    : ['-y', '-i', file, '-map', '0:a:0', '-c:a', 'aac', '-b:a', '256k', tmp];
  const { code, stderr } = await runFfmpeg(args, (s) => {
    const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
    if (m && info.duration) send('ffmpeg:progress', { jobId, frac: Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / info.duration) });
  });
  if (code !== 0) {
    await fsp.rm(tmp, { force: true });
    throw new Error('ffmpeg could not convert this file: ' + stderr.split('\n').filter(Boolean).slice(-2).join(' '));
  }
  await fsp.rename(tmp, out);
  return out;
}

const exportJobs = new Map();
let jobSeq = 0;

const FFMPEG_PRESETS = {
  prores: { v: ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0'], a: ['-c:a', 'pcm_s16le'] },
  h265: { v: ['-c:v', 'libx265', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'], a: ['-c:a', 'aac', '-b:a', '256k'] },
  h264: { v: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'], a: ['-c:a', 'aac', '-b:a', '320k'] },
  gif: { v: ['-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a', '-loop', '0'], a: null },
};

async function exportStart(opts) {
  const preset = FFMPEG_PRESETS[opts.codec];
  if (!preset) throw new Error('Unknown codec ' + opts.codec);
  const id = ++jobSeq;
  let wav = null;
  if (opts.audioWav && preset.a) {
    wav = path.join(os.tmpdir(), `fs-editor-${process.pid}-${id}.wav`);
    await fsp.writeFile(wav, Buffer.from(opts.audioWav));
  }
  const args = ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${opts.width}x${opts.height}`, '-r', String(opts.fps), '-i', 'pipe:0'];
  if (wav) args.push('-i', wav);
  args.push('-map', '0:v:0');
  if (wav) args.push('-map', '1:a:0', ...preset.a, '-shortest');
  args.push(...preset.v, opts.path);
  const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
  let stderr = '';
  p.stderr.on('data', (d) => (stderr += d.toString()));
  const done = new Promise((resolve) => p.on('close', (code) => resolve(code)));
  p.stdin.on('error', () => {});
  exportJobs.set(id, { p, done, wav, stderrRef: () => stderr });
  return id;
}

/* ---------------- IPC ---------------- */

const openFiles = new Map();
let fileSeq = 0;

function registerIpc() {
  const mediaFilters = [
    { name: 'Media', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mts', 'm2ts', 'mxf', 'wmv', 'flv', '3gp', 'ogv', 'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'aiff', 'aif', 'wma', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'] },
    { name: 'All files', extensions: ['*'] },
  ];

  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }));

  ipcMain.handle('dialog:openMedia', async (_e, multi = true) => {
    const r = await dialog.showOpenDialog(win, { title: 'Import Media', properties: ['openFile', ...(multi ? ['multiSelections'] : [])], filters: mediaFilters });
    if (r.canceled) return [];
    return Promise.all(r.filePaths.map(async (p) => ({ path: p, name: path.basename(p), size: (await fsp.stat(p)).size })));
  });

  ipcMain.handle('dialog:openProject', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Open Project', properties: ['openFile'], filters: [{ name: 'F.S. Editor Project', extensions: ['fsproj'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { path: r.filePaths[0], text: await fsp.readFile(r.filePaths[0], 'utf8') };
  });

  ipcMain.handle('project:read', async (_e, p) => ({ path: p, text: await fsp.readFile(p, 'utf8') }));

  ipcMain.handle('project:save', async (_e, { path: p, text, name, saveAs }) => {
    let target = saveAs ? null : p;
    if (!target) {
      const r = await dialog.showSaveDialog(win, {
        title: 'Save Project',
        defaultPath: p || path.join(app.getPath('documents'), `${name || 'Untitled Project'}.fsproj`),
        filters: [{ name: 'F.S. Editor Project', extensions: ['fsproj'] }],
      });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    const tmp = target + '.tmp';
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, target);
    app.addRecentDocument(target);
    return target;
  });

  ipcMain.handle('dialog:saveExport', async (_e, { name, ext, label }) => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Export Media',
      defaultPath: path.join(app.getPath('videos'), `${name}.${ext}`),
      filters: [{ name: label || ext.toUpperCase(), extensions: [ext] }],
    });
    return r.canceled ? null : r.filePath;
  });

  ipcMain.handle('file:stat', async (_e, p) => {
    try {
      const s = await fsp.stat(p);
      return { exists: true, size: s.size };
    } catch {
      return { exists: false, size: 0 };
    }
  });

  ipcMain.handle('file:open', async (_e, p) => {
    const fh = await fsp.open(p, 'w');
    const id = ++fileSeq;
    openFiles.set(id, fh);
    return id;
  });
  ipcMain.handle('file:write', async (_e, id, position, data) => {
    const fh = openFiles.get(id);
    if (!fh) throw new Error('File not open');
    await fh.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength), 0, data.byteLength, position);
  });
  ipcMain.handle('file:close', async (_e, id) => {
    const fh = openFiles.get(id);
    openFiles.delete(id);
    if (!fh) return;
    await fh.close();
  });
  ipcMain.handle('file:remove', async (_e, p) => fsp.rm(p, { force: true }));
  ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));

  ipcMain.handle('ffmpeg:probe', (_e, p) => probe(p));
  ipcMain.handle('ffmpeg:proxy', (_e, p, jobId) => makeProxy(p, jobId));

  ipcMain.handle('ffmpeg:exportStart', (_e, opts) => exportStart(opts));
  ipcMain.handle('ffmpeg:exportFrame', (_e, id, data) => {
    const job = exportJobs.get(id);
    if (!job) throw new Error('Export job not found');
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return new Promise((resolve, reject) => {
      if (job.p.exitCode !== null) return reject(new Error('ffmpeg exited: ' + job.stderrRef()));
      if (job.p.stdin.write(buf)) resolve();
      else job.p.stdin.once('drain', resolve);
    });
  });
  ipcMain.handle('ffmpeg:exportEnd', async (_e, id, cancel) => {
    const job = exportJobs.get(id);
    if (!job) return;
    exportJobs.delete(id);
    if (cancel) job.p.kill('SIGKILL');
    else job.p.stdin.end();
    const code = await job.done;
    if (job.wav) await fsp.rm(job.wav, { force: true });
    if (!cancel && code !== 0) throw new Error('ffmpeg failed: ' + job.stderrRef().split('\n').filter(Boolean).slice(-3).join(' '));
  });

  ipcMain.handle('update:install', () => updater?.quitAndInstall());
  ipcMain.handle('update:check', () => checkForUpdates(true));
}

/* ---------------- lifecycle ---------------- */

app.on('second-instance', (_e, argv) => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = findProjectArg(argv);
    if (f) send('project:openPath', f);
  }
});

app.on('open-file', (e, p) => {
  e.preventDefault();
  if (win) send('project:openPath', p);
  else pendingOpen = p;
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.fozmu.fseditor');
  registerProtocols();
  registerIpc();
  buildMenu();
  createWindow();
  setupUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
