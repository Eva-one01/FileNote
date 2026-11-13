// Guardado de FileNote en la carpeta de datos del usuario:
//   data/notes/<id>.json   una nota por archivo (si algo se estropea, solo afecta a esa nota)
//   data/folders.json      carpetas
//   data/attachments/      imágenes y archivos adjuntos
// Se escribe en un archivo temporal y se renombra: un corte de luz nunca deja una nota a medias.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

const ID = /^[A-Za-z0-9-]{8,64}$/;
const root = () => path.join(app.getPath('userData'), 'data');
const notesDir = () => path.join(root(), 'notes');
const attDir = () => path.join(root(), 'attachments');
const foldersFile = () => path.join(root(), 'folders.json');

let cache = null; // Map<id, nota completa>

function ensure() {
  fs.mkdirSync(notesDir(), { recursive: true });
  fs.mkdirSync(attDir(), { recursive: true });
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function loadAll() {
  if (cache) return cache;
  ensure();
  cache = new Map();
  for (const f of fs.readdirSync(notesDir())) {
    if (!f.endsWith('.json')) continue;
    try {
      const n = JSON.parse(fs.readFileSync(path.join(notesDir(), f), 'utf8'));
      if (n && ID.test(n.id)) cache.set(n.id, n);
    } catch {
      // Archivo dañado: se deja donde está (no se borra) y se ignora.
    }
  }
  return cache;
}

const meta = (n) => {
  const { content: _c, ...m } = n;
  return m;
};

function list() {
  return [...loadAll().values()].map(meta);
}

function get(id) {
  if (!ID.test(String(id))) return null;
  return loadAll().get(id) || null;
}

function save(note) {
  if (!note || !ID.test(String(note.id))) return false;
  ensure();
  writeAtomic(path.join(notesDir(), `${note.id}.json`), JSON.stringify(note));
  loadAll().set(note.id, note);
  return true;
}

function remove(id) {
  if (!ID.test(String(id))) return false;
  try {
    fs.rmSync(path.join(notesDir(), `${id}.json`), { force: true });
  } catch {}
  loadAll().delete(id);
  return true;
}

function listFolders() {
  try {
    const f = JSON.parse(fs.readFileSync(foldersFile(), 'utf8'));
    return Array.isArray(f) ? f : [];
  } catch {
    return [];
  }
}

function saveFolders(folders) {
  if (!Array.isArray(folders)) return false;
  ensure();
  writeAtomic(foldersFile(), JSON.stringify(folders));
  return true;
}

/* ───────── Adjuntos ───────── */

const SCHEME_URL = 'app://filenote/att/';

/** Nombre seguro: sin rutas ni caracteres prohibidos en Windows. */
function safeName(name) {
  const base = path
    .basename(String(name || 'archivo'))
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .slice(-120);
  return base.replace(/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i, '_$1$2') || 'archivo';
}

function saveAttachment(name, mime, data) {
  ensure();
  const buf = Buffer.from(data);
  const file = `${crypto.randomUUID().slice(0, 8)}-${safeName(name)}`;
  fs.writeFileSync(path.join(attDir(), file), buf);
  return { url: SCHEME_URL + encodeURIComponent(file), name: safeName(name), size: buf.length, mime: String(mime || 'application/octet-stream') };
}

function copyAttachment(srcPath, mime) {
  ensure();
  const name = safeName(path.basename(srcPath));
  const file = `${crypto.randomUUID().slice(0, 8)}-${name}`;
  fs.copyFileSync(srcPath, path.join(attDir(), file));
  return { url: SCHEME_URL + encodeURIComponent(file), name, size: fs.statSync(path.join(attDir(), file)).size, mime };
}

/** Ruta en disco de un adjunto a partir de su dirección app://filenote/att/… (o null). */
function attachmentPath(urlOrFile) {
  const file = decodeURIComponent(String(urlOrFile).replace(SCHEME_URL, '').replace(/^\/?att\//, ''));
  if (!file || file.includes('/') || file.includes('\\') || file.startsWith('.')) return null;
  const full = path.join(attDir(), file);
  return fs.existsSync(full) ? full : null;
}

/* ───────── Repaso (tarjetas de estudio) ───────── */

const studyFile = () => path.join(root(), 'study.json');
function getStudy() {
  try {
    const d = JSON.parse(fs.readFileSync(studyFile(), 'utf8'));
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}
function saveStudy(d) {
  if (!d || typeof d !== 'object') return false;
  ensure();
  writeAtomic(studyFile(), JSON.stringify(d));
  return true;
}

/* ───────── Anotaciones de PDF (una por adjunto) ───────── */

const annDir = () => path.join(root(), 'annotations');
function annFile(url) {
  const file = attachmentPath(url);
  return file ? path.join(annDir(), `${path.basename(file)}.json`) : null;
}
function getAnnotations(url) {
  const f = annFile(url);
  if (!f) return [];
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}
function saveAnnotations(url, list) {
  const f = annFile(url);
  if (!f || !Array.isArray(list)) return false;
  fs.mkdirSync(annDir(), { recursive: true });
  writeAtomic(f, JSON.stringify(list));
  return true;
}

module.exports = { getAnnotations, saveAnnotations, getStudy, saveStudy, list, get, save, remove, listFolders, saveFolders, saveAttachment, copyAttachment, attachmentPath, root };
