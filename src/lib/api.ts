import type { Folder, Note, NoteMeta } from '@/types';

/** Archivo adjunto ya guardado en la carpeta de datos de FileNote. */
export interface SavedAttachment {
  /** Dirección para mostrarlo dentro de la app (app://filenote/att/…). */
  url: string;
  name: string;
  size: number;
  mime: string;
}

/** Puente con el proceso principal (electron/preload.cjs). En el navegador se usa un respaldo local. */
export interface FileNoteBridge {
  platform: 'win32' | 'darwin' | 'linux';
  notes: {
    list(): Promise<NoteMeta[]>;
    get(id: string): Promise<Note | null>;
    save(note: Note): Promise<boolean>;
    remove(id: string): Promise<boolean>;
  };
  folders: {
    list(): Promise<Folder[]>;
    save(folders: Folder[]): Promise<boolean>;
  };
  attachments: {
    /** Guarda los bytes de un archivo (pegado o arrastrado). */
    save(name: string, mime: string, data: ArrayBuffer): Promise<SavedAttachment | null>;
    /** Abre el selector de archivos del sistema y guarda los elegidos. */
    pick(): Promise<SavedAttachment[]>;
    /** Abre un adjunto con el programa del sistema. */
    open(url: string): Promise<void>;
  };
  files: {
    /** Guarda un archivo exportado donde elija la persona. Devuelve la ruta o null si canceló. */
    saveAs(defaultName: string, data: ArrayBuffer | string, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
    /** Convierte HTML en PDF (motor del navegador) y lo guarda donde elija la persona. */
    pdf(defaultName: string, html: string): Promise<string | null>;
  };
  window: {
    setTheme(dark: boolean): void;
  };
  app?: { version(): Promise<string> };
  /** Avisos del proceso principal a la ventana. */
  events?: { on(cb: (ev: AppEvent) => void): () => void };
  /** Ventana de captura rápida. */
  capture?: { done(id: string | null): void; close(): void };
  /** Preferencias que lee el proceso principal (atajo global, bandeja). */
  prefs?: { get(): Promise<DesktopPrefs & { keyOk: boolean }>; set(p: Partial<DesktopPrefs>): Promise<DesktopPrefs & { keyOk: boolean }>; lang(l: string): void };
  updates?: {
    get(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    install(opts?: { visible?: boolean }): void;
    dismiss(): void;
    download(): void;
    onChange(cb: (s: UpdateState) => void): () => void;
  };
  errorReports?: {
    report(p: { kind?: string; name?: string; message: string; stack?: string; source?: string }): void;
    get(): Promise<{ enabled: boolean; available: boolean }>;
    set(v: boolean): Promise<{ enabled: boolean; available: boolean }>;
    test(): Promise<{ ok: boolean }>;
  };
  backups?: {
    list(): Promise<AutoBackup[]>;
    restore(name: string): Promise<boolean>;
    openFolder(): Promise<string>;
  };
}

export type AppEvent = { type: 'notes-changed'; select?: string } | { type: 'daily' } | { type: 'new-note' };
export interface DesktopPrefs {
  capture: boolean;
  captureKey: string;
  tray: boolean;
}

export type UpdateStatus = 'idle' | 'disabled' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
export interface UpdateState {
  status: UpdateStatus;
  current: string;
  version?: string;
  progress?: number;
  manual?: boolean;
  downloaded?: boolean;
  updatedTo?: string;
  failedTo?: string;
}

export interface AutoBackup {
  name: string;
  kind: 'daily' | 'safety';
  savedAt: number;
  count: number | null;
}

declare global {
  interface Window {
    filenote?: FileNoteBridge;
  }
}

/* ───────── Respaldo para el navegador (desarrollo y pruebas) ───────── */

const LS = 'filenote-dev';
type DevDB = { notes: Record<string, Note>; folders: Folder[] };
function db(): DevDB {
  try {
    return JSON.parse(localStorage.getItem(LS) || '') as DevDB;
  } catch {
    return { notes: {}, folders: [] };
  }
}
function put(d: DevDB) {
  localStorage.setItem(LS, JSON.stringify(d));
}
const meta = (n: Note): NoteMeta => {
  const { content: _c, ...m } = n;
  return m;
};

const devBridge: FileNoteBridge = {
  platform: 'linux',
  notes: {
    async list() {
      return Object.values(db().notes).map(meta);
    },
    async get(id) {
      return db().notes[id] ?? null;
    },
    async save(note) {
      const d = db();
      d.notes[note.id] = note;
      put(d);
      return true;
    },
    async remove(id) {
      const d = db();
      delete d.notes[id];
      put(d);
      return true;
    },
  },
  folders: {
    async list() {
      return db().folders;
    },
    async save(folders) {
      const d = db();
      d.folders = folders;
      put(d);
      return true;
    },
  },
  attachments: {
    async save(name, mime, data) {
      const blob = new Blob([data], { type: mime });
      const url = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsDataURL(blob);
      });
      return { url, name, size: data.byteLength, mime };
    },
    async pick() {
      return [];
    },
    async open(url) {
      window.open(url, '_blank');
    },
  },
  files: {
    async saveAs(name, data) {
      const blob = new Blob([data]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      return name;
    },
    async pdf() {
      window.print();
      return null;
    },
  },
  window: { setTheme() {} },
};

export const api: FileNoteBridge = typeof window !== 'undefined' && window.filenote ? window.filenote : devBridge;
export const isDesktop = typeof window !== 'undefined' && !!window.filenote;

// Errores de la interfaz → informes de errores (el proceso principal decide si se envían).
if (typeof window !== 'undefined' && window.filenote?.errorReports) {
  const rep = window.filenote.errorReports;
  window.addEventListener('error', (e) => rep.report({ kind: 'error', name: e.error?.name, message: e.message, stack: e.error?.stack, source: `${e.filename}:${e.lineno}:${e.colno}` }));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { name?: string; message?: string; stack?: string } | undefined;
    rep.report({ kind: 'unhandledrejection', name: r?.name, message: String(r?.message ?? r), stack: r?.stack });
  });
}
