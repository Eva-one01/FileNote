// FileNote — proceso principal de Electron.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, net, protocol, screen, shell } = require('electron');

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
const prefs = require('./prefs.cjs');
const importer = require('./importer.cjs');
const links = require('./links.cjs');
const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let win = null;
let capWin = null;
let tray = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Enlaces filenote:// (desde Clipsy): en Windows llegan como argumento de otra instancia; en Mac, con open-url.
  app.on('second-instance', (_e, argv) => {
    const link = argv.find(links.isLink);
    if (link) handleLink(link);
    else showMain();
  });
  app.on('open-url', (e, url) => {
    e.preventDefault();
    handleLink(url);
  });
  app.whenReady().then(start);
}

/* ───────── Archivos de la app, adjuntos e impresión ───────── */

// La app no se conecta a ningún servidor desde la ventana (connect-src 'self').
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
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
  // Con la bandeja activada, cerrar la ventana la esconde (el atajo de captura sigue funcionando).
  win.on('close', (e) => {
    if (!quitting && prefs.get().tray && tray && !IS_MAC) {
      e.preventDefault();
      win.hide();
      return;
    }
    quitting = true;
  });
  win.on('closed', () => {
    win = null;
    rendererReady = false;
  });
  win.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });
  guardNavigation(win);
}

function showMain() {
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  updater.checkIfStale();
}

const pendingLinks = [];
let rendererReady = false;
function handleLink(raw) {
  const ev = links.parse(raw);
  if (!ev) return;
  pendingLinks.push(ev);
  flushLinks();
}
function flushLinks() {
  if (!pendingLinks.length) return;
  if (!win || win.isDestroyed()) {
    if (app.isReady()) createWindow();
    return;
  }
  showMain();
  if (!rendererReady) return;
  for (const ev of pendingLinks.splice(0)) sendMain(ev);
}

function sendMain(ev) {
  if (win && !win.isDestroyed()) win.webContents.send('fn:event', ev);
}

/* ───────── Captura rápida y bandeja ───────── */

function openCapture() {
  if (capWin && !capWin.isDestroyed()) {
    capWin.show();
    capWin.focus();
    return;
  }
  const dark = nativeTheme.shouldUseDarkColors;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  capWin = new BrowserWindow({
    width: 560,
    height: 340,
    x: Math.round((width - 560) / 2),
    y: Math.round(height * 0.22),
    show: false,
    frame: false,
    transparent: !IS_WIN,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'FileNote',
    backgroundColor: IS_WIN ? (dark ? '#1A1A1D' : '#FFFFFF') : '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  capWin.loadURL(`${ORIGIN}/?capture=1`);
  capWin.once('ready-to-show', () => capWin.show());
  capWin.on('blur', () => {
    // Si se va a otra ventana sin guardar, se queda abierta (no se pierde lo escrito) pero deja de estar encima.
    if (capWin && !capWin.isDestroyed()) capWin.setAlwaysOnTop(false);
  });
  capWin.on('focus', () => capWin && !capWin.isDestroyed() && capWin.setAlwaysOnTop(true));
  capWin.on('closed', () => {
    capWin = null;
  });
  guardNavigation(capWin);
}

let keyOk = true;
function registerCapture() {
  globalShortcut.unregisterAll();
  const p = prefs.get();
  keyOk = true;
  if (!p.capture) return;
  try {
    keyOk = globalShortcut.register(p.captureKey, openCapture);
  } catch {
    keyOk = false;
  }
}

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', IS_MAC ? 'trayTemplate.png' : 'icon.png'));
  if (IS_MAC) {
    img.setTemplateImage(true);
    return img;
  }
  return img.resize({ width: 16, height: 16 });
}

function buildTray() {
  const want = prefs.get().tray;
  if (!want) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    tray = new Tray(trayIcon());
    tray.setToolTip('FileNote');
    tray.on('click', () => showMain());
  }
  const key = prefs.get().capture ? prefs.get().captureKey.replace('CommandOrControl', IS_MAC ? 'Cmd' : 'Ctrl') : undefined;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'FileNote', click: () => showMain() },
      { type: 'separator' },
      { label: trayText('capture'), accelerator: key, registerAccelerator: false, click: () => openCapture() },
      {
        label: trayText('new'),
        click: () => {
          showMain();
          sendMain({ type: 'new-note' });
        },
      },
      {
        label: trayText('daily'),
        click: () => {
          showMain();
          sendMain({ type: 'daily' });
        },
      },
      { type: 'separator' },
      {
        label: trayText('quit'),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

/** Textos de la bandeja en el idioma de la app (el que la interfaz le pasa). */
const TRAY = {
  es: { capture: 'Captura rápida', new: 'Nueva nota', daily: 'Nota de hoy', quit: 'Salir de FileNote' },
  en: { capture: 'Quick capture', new: 'New note', daily: 'Today’s note', quit: 'Quit FileNote' },
  pt: { capture: 'Captura rápida', new: 'Nova nota', daily: 'Nota de hoje', quit: 'Sair do FileNote' },
  fr: { capture: 'Capture rapide', new: 'Nouvelle note', daily: 'Note du jour', quit: 'Quitter FileNote' },
  ru: { capture: 'Быстрая заметка', new: 'Новая заметка', daily: 'Заметка на сегодня', quit: 'Выйти из FileNote' },
  de: { capture: 'Schnellnotiz', new: 'Neue Notiz', daily: 'Heutige Notiz', quit: 'FileNote beenden' },
};
let uiLang = 'es';
const trayText = (k) => (TRAY[uiLang] || TRAY.en)[k];

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
  ipcMain.handle('fn:study:get', () => store.getStudy());
  ipcMain.handle('fn:decks:get', () => store.getDecks());
  ipcMain.handle('fn:decks:save', (_e, d) => store.saveDecks(d));
  ipcMain.handle('fn:ann:get', (_e, url) => store.getAnnotations(String(url)));
  ipcMain.handle('fn:ann:save', (_e, url, list) => store.saveAnnotations(String(url), list));
  ipcMain.handle('fn:study:save', (_e, d) => store.saveStudy(d));

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

  ipcMain.on('fn:ready', () => {
    rendererReady = true;
    flushLinks();
  });
  ipcMain.handle('fn:clipsy:send', (_e, p) => links.sendToClipsy(p));
  ipcMain.on('fn:cap:done', (_e, id) => {
    if (capWin && !capWin.isDestroyed()) capWin.hide();
    sendMain({ type: 'notes-changed', ...(id ? { select: String(id) } : {}) });
  });
  ipcMain.on('fn:cap:close', () => {
    if (capWin && !capWin.isDestroyed()) capWin.hide();
  });
  ipcMain.handle('fn:imp:pick', (_e, kind) => importer.pick(win, kind === 'files' ? 'files' : 'folder'));
  ipcMain.handle('fn:imp:asset', (_e, rel) => importer.asset(rel, mimeOf(String(rel))));
  ipcMain.handle('fn:prefs:get', () => ({ ...prefs.get(), keyOk }));
  ipcMain.handle('fn:prefs:set', (_e, p) => {
    prefs.set(p);
    registerCapture();
    buildTray();
    return { ...prefs.get(), keyOk };
  });
  ipcMain.on('fn:lang', (_e, l) => {
    if (TRAY[l] && l !== uiLang) {
      uiLang = l;
      buildTray();
    }
  });

  ipcMain.on('fn:theme', (e, dark) => {
    if (!win || e.sender !== win.webContents) return;
    win.setBackgroundColor(dark ? BG.dark : BG.light);
    if (IS_WIN) win.setTitleBarOverlay(overlayColors(!!dark));
  });
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
function mimeOf(p) {
  return MIME[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream';
}

function start() {
  if (app.isPackaged) app.setAsDefaultProtocolClient('filenote');
  registerProtocol();
  registerIpc();
  createWindow();
  registerCapture();
  buildTray();
  const firstLink = process.argv.find(links.isLink);
  if (firstLink) handleLink(firstLink);
  backups.start();
  updater.init(
    (st) => {
      if (win && !win.isDestroyed()) win.webContents.send('fn:upd:state', st);
    },
    () => {
      quitting = true; // la ventana no se esconde en la bandeja: se cierra para instalar
      try {
        tray?.destroy();
        tray = null;
      } catch {}
    },
  );
  app.on('activate', () => showMain());
  // Al apagar o reiniciar el equipo, la ventana se cierra de verdad (no se esconde en la bandeja).
  const { powerMonitor } = require('electron');
  powerMonitor.on('shutdown', () => {
    quitting = true;
  });
  win?.on('session-end', () => {
    quitting = true;
  });
}

app.on('before-quit', () => {
  quitting = true;
  updater.noteQuit();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  // Con la bandeja la app sigue viva (la ventana se escondió); en Mac siempre sigue en el Dock.
  if (quitting || (!IS_MAC && !(prefs.get().tray && tray))) app.quit();
});
