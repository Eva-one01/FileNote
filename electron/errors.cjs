// Informes de errores (Sentry): avisan de cierres inesperados y fallos de la app para poder arreglarlos.
// Sin datos personales: no se envía el contenido de tus notas, tu correo ni tu nombre de usuario (la carpeta de tu
// usuario se cambia por «~» en las rutas). Se pueden desactivar en Ajustes → Privacidad.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const CFG = require('./config.cjs');

let Sentry = null;
let enabled = true;
let sent = 0;
const MAX_PER_SESSION = 30; // si algo falla en bucle, no se envían miles de informes

const prefFile = () => path.join(app.getPath('userData'), 'error-reports.json');
const dsn = () => String(CFG.sentryDsn || '').trim();

function readPref() {
  try {
    return JSON.parse(fs.readFileSync(prefFile(), 'utf8')).enabled !== false;
  } catch {
    return true;
  }
}

/** Quita la carpeta del usuario de las rutas (en Windows suele llevar su nombre). */
function scrub(event) {
  delete event.user;
  if (event.request) delete event.request.cookies;
  try {
    let json = JSON.stringify(event);
    const home = app.getPath('home');
    for (const form of [home, home.replace(/\\/g, '\\\\'), home.replace(/\\/g, '/')]) {
      if (form.length > 3) json = json.split(form).join('~');
    }
    return JSON.parse(json);
  } catch {
    return event;
  }
}

/** Hay que llamarlo al arrancar, después de fijar la carpeta de datos y antes de que la app esté lista. */
function init() {
  enabled = readPref();
  if (!dsn() || !app.isPackaged) return;
  try {
    Sentry = require('@sentry/electron/main');
  } catch {
    return;
  }
  Sentry.init({
    dsn: dsn(),
    release: `filenote@${app.getVersion()}`,
    environment: 'production',
    sendDefaultPii: false,
    beforeSend(event) {
      if (!enabled || sent >= MAX_PER_SESSION) return null;
      sent++;
      return scrub(event);
    },
    // Las migas de pan de la consola o de los clics podrían llevar texto tuyo: no se guardan.
    beforeBreadcrumb(b) {
      return b.category === 'console' || (b.category || '').startsWith('ui.') ? null : b;
    },
  });
}

/** Error de la interfaz (lo envía preload.js). */
function report(p) {
  if (!Sentry || !enabled || !p) return;
  const e = new Error(String(p.message || 'Error').slice(0, 500));
  e.name = String(p.name || 'RendererError').slice(0, 80);
  if (p.stack) e.stack = String(p.stack).slice(0, 8000);
  Sentry.captureException(e, { tags: { process: 'renderer', kind: p.kind || 'error' }, extra: { source: p.source || null } });
}

/** Botón «Enviar un error de prueba» de Ajustes: comprueba que los informes llegan al panel de Sentry. */
async function test() {
  if (!Sentry || !enabled) return { ok: false };
  Sentry.captureException(new Error(`FileNote ${app.getVersion()}: error de prueba enviado desde Ajustes`), { tags: { prueba: 'si' } });
  try {
    return { ok: await Sentry.flush(8000) };
  } catch {
    return { ok: false };
  }
}

function get() {
  return { enabled, available: !!dsn() };
}

function setEnabled(v) {
  enabled = !!v;
  try {
    fs.writeFileSync(prefFile(), JSON.stringify({ enabled }));
  } catch {}
  return get();
}

module.exports = { init, report, test, get, setEnabled };
