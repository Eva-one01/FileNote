// Preferencias del proceso principal (las necesita antes de abrir la ventana): atajo global y bandeja.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const DEFAULTS = { capture: true, captureKey: 'CommandOrControl+Alt+N', tray: true };
const KEYS = ['CommandOrControl+Alt+N', 'CommandOrControl+Alt+Space', 'Alt+Shift+N', 'CommandOrControl+Shift+Alt+N'];
const file = () => path.join(app.getPath('userData'), 'prefs.json');

let cur = null;
function get() {
  if (cur) return cur;
  try {
    cur = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cur = { ...DEFAULTS };
  }
  if (!KEYS.includes(cur.captureKey)) cur.captureKey = DEFAULTS.captureKey;
  return cur;
}
function set(patch) {
  const next = { ...get() };
  if (typeof patch?.capture === 'boolean') next.capture = patch.capture;
  if (typeof patch?.tray === 'boolean') next.tray = patch.tray;
  if (KEYS.includes(patch?.captureKey)) next.captureKey = patch.captureKey;
  cur = next;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(next));
  } catch {}
  return next;
}
module.exports = { get, set, KEYS };
