// Actualizaciones automáticas (proceso principal).
// Windows: electron-updater descarga la versión nueva en segundo plano y se instala al reiniciar.
// macOS sin firmar: Apple no permite instalar solo, así que se avisa y se abre la página de descargas.
// Las actualizaciones nunca tocan tus datos: viven en otra carpeta (userData).
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const CFG = require('./config.cjs');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {}

const IS_MAC = process.platform === 'darwin';
const native = () => !!autoUpdater && (!IS_MAC || CFG.macAutoUpdate);
const enabled = () => app.isPackaged && !!CFG.updatesUrl;

/** Registro de actualizaciones (carpeta de datos → logs/updater.log) para saber por qué falla una instalación. */
function logFile() {
  return path.join(app.getPath('userData'), 'logs', 'updater.log');
}
function log(level, ...args) {
  try {
    const f = logFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f) && fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + '.old');
    const msg = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    fs.appendFileSync(f, `${new Date().toISOString()} [${level}] ${msg}\n`);
  } catch {}
}
const logger = { info: (...a) => log('info', ...a), warn: (...a) => log('warn', ...a), error: (...a) => log('error', ...a), debug: () => {} };

/** ¿Se puede escribir en la carpeta donde está instalada la app? (si no, el instalador necesita permisos de administrador) */
function installDirWritable() {
  try {
    fs.accessSync(path.dirname(process.execPath), fs.constants.W_OK);
    const probe = path.join(path.dirname(process.execPath), `.filenote-write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

let state = { status: 'idle', current: app.getVersion() };
let lastCheck = 0;
let listener = () => {};
let beforeInstall = () => {};
function set(patch) {
  state = Object.assign({}, state, patch);
  listener(state);
}

function newer(a, b) {
  const pa = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function manualCheck() {
  const name = IS_MAC ? 'latest-mac.yml' : 'latest.yml';
  const res = await fetch(`${CFG.updatesUrl.replace(/\/$/, '')}/${name}?t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('feed');
  const m = (await res.text()).match(/^version:\s*['"]?([\w.-]+)/m);
  if (m && newer(m[1], app.getVersion())) set({ status: 'available', version: m[1], manual: true });
  else set({ status: 'none' });
}

async function check() {
  if (!enabled()) return set({ status: 'disabled' }), state;
  if (['checking', 'downloading', 'ready', 'installing'].includes(state.status)) return state;
  lastCheck = Date.now();
  set({ status: 'checking', error: undefined });
  try {
    if (native()) await autoUpdater.checkForUpdates();
    else await manualCheck();
  } catch (e) {
    logger.error('check', e);
    set({ status: 'error' });
  }
  return state;
}

/** Intento de instalación pendiente: al volver a abrir se sabe si funcionó (versión nueva) o no (misma versión). */
function attemptFile() {
  return path.join(app.getPath('userData'), 'update-attempt.json');
}
function noteAttempt() {
  try {
    fs.writeFileSync(attemptFile(), JSON.stringify({ from: app.getVersion(), to: state.version, at: Date.now() }));
  } catch {}
}
function readAttempt() {
  try {
    const a = JSON.parse(fs.readFileSync(attemptFile(), 'utf8'));
    fs.unlinkSync(attemptFile());
    // Solo cuenta si fue hace poco (la app se reabre sola al terminar de instalar).
    return a && Date.now() - a.at < 24 * 60 * 60 * 1000 ? a : null;
  } catch {
    return null;
  }
}

/**
 * Instala la versión descargada. `visible`: con el instalador a la vista (reintento tras un fallo),
 * para que Windows pueda pedir permisos o mostrar el motivo del error.
 */
function install(opts = {}) {
  const canNative = native() && (state.status === 'ready' || (state.failedTo && state.version === state.failedTo && state.downloaded));
  if (canNative) {
    // Si la app está en una carpeta protegida (p. ej. Archivos de programa), el instalador en silencio no
    // puede escribir ahí: se abre visible para que Windows pida permiso de administrador.
    const silent = !opts.visible && (process.platform !== 'win32' || installDirWritable());
    logger.info(`Instalar ${state.version} desde ${app.getVersion()} · carpeta ${path.dirname(process.execPath)} · silencioso ${silent}`);
    noteAttempt();
    // La interfaz avisa «Instalando…» antes de que la ventana se cierre.
    set({ status: 'installing' });
    setTimeout(() => {
      beforeInstall();
      try {
        autoUpdater.quitAndInstall(silent, true);
      } catch (e) {
        logger.error('quitAndInstall', e);
        set({ status: 'error' });
      }
    }, 1600);
  } else if ((state.status === 'available' && state.manual) || state.failedTo) {
    openDownloads();
  }
}

function openDownloads() {
  shell.openExternal(CFG.downloadsUrl);
}

/** La persona cerró el aviso de «actualizado» o de «no se pudo instalar». */
function dismiss() {
  set({ updatedTo: undefined, failedTo: undefined });
}

/** Al salir con una versión ya descargada, se instala sola: se anota para comprobarlo al volver. */
function noteQuit() {
  if (state.status === 'ready' && native()) noteAttempt();
}

function init(onChange, onBeforeInstall) {
  listener = onChange || listener;
  beforeInstall = onBeforeInstall || beforeInstall;
  if (!enabled()) return set({ status: 'disabled' });
  // ¿Venimos de instalar una versión? Si ya la tenemos, se avisa «Actualizado»; si no, se ofrece el plan B.
  const attempt = readAttempt();
  if (attempt && attempt.to) {
    if (!newer(attempt.to, app.getVersion())) {
      logger.info(`Actualizado de ${attempt.from} a ${app.getVersion()}`);
      set({ updatedTo: app.getVersion() });
    } else {
      logger.error(`La instalación de ${attempt.to} no se completó: sigue la ${app.getVersion()}`);
      set({ failedTo: attempt.to });
    }
  }
  if (native()) {
    autoUpdater.logger = logger;
    autoUpdater.setFeedURL({ provider: 'generic', url: CFG.updatesUrl });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // si no reinicia, se instala al salir
    autoUpdater.on('update-available', (i) => set({ status: 'downloading', version: i.version, progress: 0 }));
    autoUpdater.on('update-not-available', () => set({ status: 'none' }));
    autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => set({ status: 'ready', version: i.version, downloaded: true }));
    autoUpdater.on('error', (e) => {
      logger.error('updater', e);
      set({ status: 'error' });
    });
  }
  // Al abrir la app se revisa enseguida; si hay versión nueva, se descarga y se pide actualizar.
  setTimeout(check, 2 * 1000);
  // Revisar cuesta casi nada (latest.yml pesa menos de 1 KB); la descarga solo ocurre si hay versión nueva.
  setInterval(check, 10 * 60 * 1000).unref?.();
}

/** Al volver a mostrar la ventana: revisa si pasaron más de 10 minutos desde la última vez. */
function checkIfStale() {
  if (enabled() && Date.now() - lastCheck > 10 * 60 * 1000) check();
}

module.exports = { init, check, checkIfStale, install, dismiss, openDownloads, noteQuit, get: () => state };
