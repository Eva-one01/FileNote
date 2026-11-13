// FileNote — proceso principal de Electron.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, screen, shell } = require('electron');

const SCHEME = 'app';
const HOST = 'filenote';
const ORIGIN = `${SCHEME}://${HOST}`;
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const TITLE_H = 34;
const BG = { light: '#F6F6F4', dark: '#0A0A0B' };

// Carpeta de datos fija (no depende del nombre del producto).
app.setPath('userData', path.join(app.getPath('appData'), 'FileNote'));
app.setAppUserModelId('com.felipefranco.razor.filenote');

// Informes de errores (Sentry): justo después de fijar la carpeta de datos, antes de que la app esté lista.
const errors = require('./errors.cjs');
errors.init();

const store = require('./store.cjs');
const updater = require('./updater.cjs');
const backups = require('./backups.cjs');
const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let win = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(start);
}

/* ───────── Archivos de la app, adjuntos e impresión ───────── */

// La app no se conecta a ningún servidor desde la ventana (connect-src 'self').
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** HTML a convertir en PDF (se sirve una sola vez desde app://filenote/__print/<id>). */
const printJobs = new Map();

function resolveDist(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full = path.normalize(path.join(DIST, rel));
  if (full !== DIST && !full.startsWith(DIST + path.sep)) return null;
  try {
    return fs.statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

async function serveFile(file, extraHeaders = {}) {
  const res = await net.fetch(pathToFileURL(file).toString());
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/att/')) {
      const file = store.attachmentPath(pathname.slice(5));
      return file ? serveFile(file, { 'Cache-Control': 'no-cache' }) : new Response('Not found', { status: 404 });
    }
    if (pathname.startsWith('/__print/')) {
      const html = printJobs.get(pathname.slice(9));
      return html ? new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'" } }) : new Response('Not found', { status: 404 });
    }
    const file = resolveDist(pathname) || (path.extname(pathname) ? null : path.join(DIST, 'index.html'));
    if (!file) return new Response('Not found', { status: 404 });
    return serveFile(file, { 'Content-Security-Policy': CSP });
  });
}

/* ───────── Ventana ───────── */

function overlayColors(dark) {
  return { color: dark ? BG.dark : BG.light, symbolColor: dark ? '#F2F2F0' : '#0E0E10', height: TITLE_H };
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const fit = (want, avail) => Math.min(want, Math.round(avail * 0.92));
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: fit(1280, area.width),
    height: fit(820, area.height),
    minWidth: Math.min(860, area.width),
    minHeight: Math.min(560, area.height),
    center: true,
    show: false,
    title: 'FileNote',
    backgroundColor: dark ? BG.dark : BG.light,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    ...(IS_WIN ? { titleBarStyle: 'hidden', titleBarOverlay: overlayColors(dark) } : {}),
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 11 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  win.loadURL(`${ORIGIN}/`);
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => updater.checkIfStale());
  win.on('close', () => {
    quitting = true;
  });
  guardNavigation(win);
}

/** Los enlaces web se abren en el navegador del sistema; la ventana nunca sale de la app. */
function guardNavigation(w) {
  const openExternal = (url) => {
    if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
  };
  w.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      openExternal(url);
    }
  });
}

/* ───────── Exportar ───────── */

async function saveAs(defaultName, data, filters) {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), String(defaultName)), filters });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
  return r.filePath;
}

/** HTML → PDF con el mismo motor de la app, en una ventana invisible sin scripts. */
async function toPdf(defaultName, html) {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), String(defaultName)), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return null;
  const id = crypto.randomUUID();
  printJobs.set(id, String(html));
  const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } });
  try {
    await pw.loadURL(`${ORIGIN}/__print/${id}`);
    const pdf = await pw.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true });
    fs.writeFileSync(r.filePath, pdf);
    return r.filePath;
  } finally {
    printJobs.delete(id);
    pw.destroy();
  }
}

/* ───────── Puente con la interfaz ───────── */

function registerIpc() {
  ipcMain.handle('fn:notes:list', () => store.list());
  ipcMain.handle('fn:notes:get', (_e, id) => store.get(id));
  ipcMain.handle('fn:notes:save', (_e, note) => store.save(note));
  ipcMain.handle('fn:notes:remove', (_e, id) => store.remove(id));
  ipcMain.handle('fn:folders:list', () => store.listFolders());
  ipcMain.handle('fn:folders:save', (_e, f) => store.saveFolders(f));

  ipcMain.handle('fn:att:save', (_e, name, mime, data) => store.saveAttachment(name, mime, data));
  ipcMain.handle('fn:att:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    return r.filePaths.map((p) => store.copyAttachment(p, mimeOf(p)));
  });
  ipcMain.handle('fn:att:open', async (_e, url) => {
    const file = store.attachmentPath(url);
    if (file) await shell.openPath(file);
  });

  ipcMain.handle('fn:files:saveAs', (_e, name, data, filters) => saveAs(name, data, filters));
  ipcMain.handle('fn:files:pdf', (_e, name, html) => toPdf(name, html));

  ipcMain.handle('fn:app:version', () => app.getVersion());

  ipcMain.handle('fn:upd:get', () => updater.get());
  ipcMain.handle('fn:upd:check', () => updater.check());
  ipcMain.on('fn:upd:install', (_e, opts) => updater.install({ visible: !!(opts && opts.visible) }));
  ipcMain.on('fn:upd:dismiss', () => updater.dismiss());
  ipcMain.on('fn:upd:download', () => updater.openDownloads());

  ipcMain.on('fn:err:report', (_e, p) => errors.report(p));
  ipcMain.handle('fn:err:get', () => errors.get());
  ipcMain.handle('fn:err:set', (_e, v) => errors.setEnabled(!!v));
  ipcMain.handle('fn:err:test', () => errors.test());

  ipcMain.handle('fn:bak:list', () => backups.list());
  ipcMain.handle('fn:bak:restore', (_e, name) => backups.restore(name));
  ipcMain.handle('fn:bak:open', () => backups.openFolder());

  ipcMain.on('fn:theme', (_e, dark) => {
    if (!win) return;
    win.setBackgroundColor(dark ? BG.dark : BG.light);
    if (IS_WIN) win.setTitleBarOverlay(overlayColors(!!dark));
  });
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
function mimeOf(p) {
  return MIME[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream';
}

function start() {
  registerProtocol();
  registerIpc();
  createWindow();
  backups.start();
  updater.init(
    (st) => {
      if (win && !win.isDestroyed()) win.webContents.send('fn:upd:state', st);
    },
    () => {
      quitting = true;
    },
  );
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else win?.show();
  });
}

app.on('before-quit', () => {
  quitting = true;
  updater.noteQuit();
});
app.on('window-all-closed', () => {
  if (!IS_MAC || quitting) app.quit();
});
