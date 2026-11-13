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
  window: {
    setTheme: (dark) => ipcRenderer.send('fn:theme', !!dark),
  },
});
