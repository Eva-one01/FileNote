// Puente seguro entre la interfaz y el proceso principal (contextIsolation + sandbox).
const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('filenote', {
  platform: process.platform,
  notes: {
    list: () => inv('fn:notes:list'),
    get: (id) => inv('fn:notes:get', String(id)),
    save: (note) => inv('fn:notes:save', note),
    remove: (id) => inv('fn:notes:remove', String(id)),
  },
  folders: {
    list: () => inv('fn:folders:list'),
    save: (f) => inv('fn:folders:save', f),
  },
  attachments: {
    save: (name, mime, data) => inv('fn:att:save', String(name), String(mime), data),
    pick: () => inv('fn:att:pick'),
    open: (url) => inv('fn:att:open', String(url)),
  },
  files: {
    saveAs: (name, data, filters) => inv('fn:files:saveAs', String(name), data, filters),
    pdf: (name, html) => inv('fn:files:pdf', String(name), String(html)),
  },
  app: {
    version: () => inv('fn:app:version'),
  },
  updates: {
    get: () => inv('fn:upd:get'),
    check: () => inv('fn:upd:check'),
    install: (opts) => ipcRenderer.send('fn:upd:install', opts && opts.visible ? { visible: true } : {}),
    dismiss: () => ipcRenderer.send('fn:upd:dismiss'),
    download: () => ipcRenderer.send('fn:upd:download'),
    onChange: (cb) => {
      const h = (_e, st) => cb(st);
      ipcRenderer.on('fn:upd:state', h);
      return () => ipcRenderer.removeListener('fn:upd:state', h);
    },
  },
  errorReports: {
    report: (p) => {
      try {
        ipcRenderer.send('fn:err:report', { kind: String((p && p.kind) || 'error'), name: p && p.name ? String(p.name) : undefined, message: String((p && p.message) || ''), stack: p && p.stack ? String(p.stack) : undefined, source: p && p.source ? String(p.source) : undefined });
      } catch {}
    },
    get: () => inv('fn:err:get'),
    set: (v) => inv('fn:err:set', !!v),
    test: () => inv('fn:err:test'),
  },
  backups: {
    list: () => inv('fn:bak:list'),
    restore: (name) => inv('fn:bak:restore', String(name)),
    openFolder: () => inv('fn:bak:open'),
  },
  window: {
    setTheme: (dark) => ipcRenderer.send('fn:theme', !!dark),
  },
  events: {
    on: (cb) => {
      const h = (_e, ev) => cb(ev);
      ipcRenderer.on('fn:event', h);
      return () => ipcRenderer.removeListener('fn:event', h);
    },
  },
  capture: {
    done: (id) => ipcRenderer.send('fn:cap:done', id ? String(id) : null),
    close: () => ipcRenderer.send('fn:cap:close'),
  },
  prefs: {
    get: () => inv('fn:prefs:get'),
    set: (p) => inv('fn:prefs:set', p),
    lang: (l) => ipcRenderer.send('fn:lang', String(l)),
  },
});
