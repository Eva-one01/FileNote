// Enlaces filenote:// (desde Clipsy u otras apps): abrir una nota o la nota de reunión de un evento.
// Y el envío de tareas o recordatorios a Clipsy (clipsy://).
const { app, shell } = require('electron');

const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function parse(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== 'filenote:') return null;
  const action = (u.hostname || u.pathname.replace(/^\/+/, '').split('/')[0] || '').toLowerCase();
  const q = u.searchParams;
  if (action === 'open') {
    const id = q.get('id') || '';
    return /^[A-Za-z0-9-]{8,64}$/.test(id) ? { type: 'open-note', id } : null;
  }
  if (action === 'meeting') {
    const title = clean(q.get('title'), 200);
    const event = clean(q.get('event'), 80);
    if (!title || !event) return null;
    const date = DATE.test(q.get('date') || '') ? q.get('date') : '';
    const start = TIME.test(q.get('start') || '') ? q.get('start') : '';
    const end = TIME.test(q.get('end') || '') ? q.get('end') : '';
    return { type: 'meeting', title, event, date, start, end };
  }
  if (action === 'new') return { type: 'new-note' };
  return null;
}

const isLink = (s) => typeof s === 'string' && s.toLowerCase().startsWith('filenote://');

/** Envía una tarea o un recordatorio a Clipsy. Sin Clipsy instalado devuelve «missing». */
function sendToClipsy(p) {
  const kind = p && p.kind === 'reminder' ? 'reminder' : 'task';
  const title = clean(p && p.title, 300);
  if (!title) return 'invalid';
  if (!app.getApplicationNameForProtocol('clipsy://')) return 'missing';
  const q = new URLSearchParams({ title });
  if (kind === 'task') {
    if (DATE.test(p.date || '')) q.set('date', p.date);
    if (DATE.test(p.date || '') && TIME.test(p.time || '')) q.set('time', p.time);
    if (p.noteId && /^[A-Za-z0-9-]{8,64}$/.test(p.noteId)) q.set('notes', `${clean(p.noteTitle, 120)}\nfilenote://open?id=${p.noteId}`);
  } else {
    const at = Number(p.at);
    if (!Number.isFinite(at)) return 'invalid';
    q.set('at', String(Math.round(at)));
  }
  shell.openExternal(`clipsy://${kind}?${q}`);
  return 'sent';
}

module.exports = { parse, isLink, sendToClipsy };
