// Importar notas Markdown (bóveda de Obsidian, exportación de Notion, carpeta de .md…).
// Solo lee dentro de la carpeta que el usuario eligió; los adjuntos se copian a la carpeta de FileNote.
const fs = require('node:fs');
const path = require('node:path');
const { dialog } = require('electron');
const store = require('./store.cjs');

const MAX_FILES = 5000;
const MAX_MD = 5 * 1024 * 1024;
const SKIP = new Set(['.obsidian', '.trash', '.git', 'node_modules', '.DS_Store']);
let root = null; // carpeta elegida (todo lo que se lea debe estar dentro)

function walk(dir, out, assets) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(ent.name) || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out, assets);
    else if (ent.isFile()) {
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (/\.(md|markdown|txt)$/i.test(ent.name)) {
        if (out.length >= MAX_FILES) continue;
        const st = fs.statSync(full);
        if (st.size > MAX_MD) continue;
        out.push({ rel, text: fs.readFileSync(full, 'utf8'), mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs });
      } else if (assets.length < MAX_FILES * 4) assets.push(rel);
    }
  }
}

async function pick(win, kind) {
  const r = await dialog.showOpenDialog(win, kind === 'files' ? { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }] } : { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  root = kind === 'files' ? path.dirname(r.filePaths[0]) : r.filePaths[0];
  const files = [];
  const assets = [];
  if (kind === 'files') {
    for (const f of r.filePaths) {
      const st = fs.statSync(f);
      if (st.size <= MAX_MD) files.push({ rel: path.basename(f), text: fs.readFileSync(f, 'utf8'), mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs });
    }
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) if (ent.isFile() && !/\.(md|markdown|txt)$/i.test(ent.name)) assets.push(ent.name);
  } else walk(root, files, assets);
  return { name: path.basename(root), files, assets };
}

/** Copia un adjunto (ruta relativa a la carpeta elegida) y devuelve su dirección dentro de FileNote. */
function asset(rel, mime) {
  if (!root) return null;
  const full = path.resolve(root, String(rel));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  try {
    if (!fs.statSync(full).isFile()) return null;
    return store.copyAttachment(full, String(mime || 'application/octet-stream'));
  } catch {
    return null;
  }
}

module.exports = { pick, asset };
