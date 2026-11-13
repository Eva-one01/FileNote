// Copias de seguridad automáticas: cada hora se actualiza la copia del día (backups/), se guardan las de los
// últimos 7 días. Antes de restaurar se guarda también el estado actual (las 3 últimas).
// Las copias llevan las notas y las carpetas; los adjuntos no cambian nunca y siguen en su carpeta.
const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');
const store = require('./store.cjs');

const KEEP_DAILY = 7;
const KEEP_SAFETY = 3;
const DAILY = /^filenote-auto-(\d{4}-\d{2}-\d{2})\.json$/;
const SAFETY = /^filenote-antes-de-restaurar-(\d{8}-\d{6})\.json$/;
const dir = () => path.join(app.getPath('userData'), 'backups');
const pad = (n) => String(n).padStart(2, '0');

function writeAtomic(file, text) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

function snapshot() {
  const notes = store.list().map((m) => store.get(m.id)).filter(Boolean);
  return { app: 'FileNote', version: 1, savedAt: new Date().toISOString(), count: notes.length, notes, folders: store.listFolders() };
}

function prune() {
  const names = fs.readdirSync(dir());
  for (const [re, keep] of [
    [DAILY, KEEP_DAILY],
    [SAFETY, KEEP_SAFETY],
  ]) {
    names
      .filter((n) => re.test(n))
      .sort()
      .reverse()
      .slice(keep)
      .forEach((n) => fs.rmSync(path.join(dir(), n), { force: true }));
  }
}

/** Copia del día. Sin notas no se escribe: una app vacía (o borrada sin querer) no tapa copias buenas. */
function saveDaily() {
  try {
    const snap = snapshot();
    if (!snap.count) return false;
    const d = new Date();
    writeAtomic(path.join(dir(), `filenote-auto-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`), JSON.stringify(snap));
    prune();
    return true;
  } catch {
    return false;
  }
}

function list() {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    return fs
      .readdirSync(dir())
      .filter((n) => DAILY.test(n) || SAFETY.test(n))
      .map((n) => {
        const full = path.join(dir(), n);
        let count = null;
        try {
          const m = fs.readFileSync(full, 'utf8').slice(0, 200).match(/"count":(\d+)/);
          if (m) count = Number(m[1]);
        } catch {}
        return { name: n, kind: DAILY.test(n) ? 'daily' : 'safety', savedAt: fs.statSync(full).mtimeMs, count };
      })
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** Restaura una copia de la lista (nunca rutas). Antes guarda el estado actual. */
function restore(name) {
  if (!DAILY.test(String(name)) && !SAFETY.test(String(name))) return false;
  const snap = JSON.parse(fs.readFileSync(path.join(dir(), name), 'utf8'));
  if (!snap || !Array.isArray(snap.notes)) return false;
  const now = snapshot();
  if (now.count) {
    const d = new Date();
    writeAtomic(path.join(dir(), `filenote-antes-de-restaurar-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`), JSON.stringify(now));
  }
  for (const m of store.list()) store.remove(m.id);
  for (const n of snap.notes) store.save(n);
  store.saveFolders(Array.isArray(snap.folders) ? snap.folders : []);
  prune();
  return true;
}

function openFolder() {
  fs.mkdirSync(dir(), { recursive: true });
  return shell.openPath(dir());
}

/** Primera copia unos segundos después de abrir; luego cada hora. */
function start() {
  setTimeout(saveDaily, 20 * 1000).unref?.();
  setInterval(saveDaily, 60 * 60 * 1000).unref?.();
}

module.exports = { start, saveDaily, list, restore, openFolder };
