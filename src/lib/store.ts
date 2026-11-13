import type { JSONContent } from '@tiptap/core';
import { create } from 'zustand';
import type { Folder, Note, NoteMeta, Settings, View } from '@/types';
import { api } from './api';

const SETTINGS_KEY = 'filenote-settings';
const TRASH_DAYS = 30;

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const defaultLang = (): Settings['language'] => {
  const l = (navigator.language || 'es').slice(0, 2);
  return (['es', 'en', 'pt', 'fr', 'ru', 'de'] as const).includes(l as Settings['language']) ? (l as Settings['language']) : 'en';
};

function loadSettings(): Settings {
  const base: Settings = { theme: 'system', accent: 'blue', size: 'normal', language: defaultLang(), sort: 'updated', spellcheck: true };
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<Settings>) };
  } catch {
    return base;
  }
}

export const emptyDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] });

/** Notas enlazadas con [[…]] dentro del documento. */
export function linksIn(doc: JSONContent | undefined): string[] {
  const out = new Set<string>();
  const walk = (n?: JSONContent) => {
    if (!n) return;
    if (n.type === 'noteLink' && typeof n.attrs?.id === 'string') out.add(n.attrs.id);
    n.content?.forEach(walk);
  };
  walk(doc);
  return [...out];
}

const toMeta = (n: Note): NoteMeta => {
  const { content: _c, ...m } = n;
  return m;
};

interface Toast {
  id: number;
  msg: string;
  action?: { label: string; run: () => void };
}

interface State {
  ready: boolean;
  notes: NoteMeta[];
  folders: Folder[];
  settings: Settings;
  view: View;
  selectedId: string | null;
  current: Note | null;
  paletteOpen: boolean;
  focus: boolean;
  toast: Toast | null;

  load(): Promise<void>;
  setView(v: View): void;
  select(id: string | null): Promise<void>;
  createNote(opts?: { title?: string; folderId?: string | null; tags?: string[]; select?: boolean }): Promise<Note>;
  updateCurrent(patch: Partial<Pick<Note, 'title' | 'content' | 'text' | 'tags' | 'folderId' | 'pinned'>>): void;
  patchNote(id: string, patch: Partial<Pick<Note, 'title' | 'tags' | 'folderId' | 'pinned' | 'trashedAt'>>): Promise<void>;
  flush(): Promise<void>;
  trash(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  deleteForever(id: string): Promise<void>;
  emptyTrash(): Promise<void>;
  duplicate(id: string): Promise<void>;
  addFolder(name: string, parentId?: string | null): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<void>;
  deleteFolder(id: string): Promise<void>;
  renameTag(from: string, to: string): Promise<void>;
  setSettings(p: Partial<Settings>): void;
  setPalette(open: boolean): void;
  setFocus(on: boolean): void;
  showToast(msg: string, action?: Toast['action']): void;
  hideToast(): void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty: Note | null = null;

async function writeNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const n = dirty;
  dirty = null;
  if (n) await api.notes.save(n);
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  notes: [],
  folders: [],
  settings: loadSettings(),
  view: { kind: 'all' },
  selectedId: null,
  current: null,
  paletteOpen: false,
  focus: false,
  toast: null,

  async load() {
    const [notes, folders] = await Promise.all([api.notes.list(), api.folders.list()]);
    // La papelera se vacía sola a los 30 días.
    const limit = Date.now() - TRASH_DAYS * 86_400_000;
    const old = notes.filter((n) => n.trashedAt && n.trashedAt < limit);
    for (const n of old) await api.notes.remove(n.id);
    const live = notes.filter((n) => !old.includes(n));
    set({ notes: live, folders: folders.sort((a, b) => a.order - b.order), ready: true });
    const first = sortNotes(visibleNotes(live, { kind: 'all' }, ''), get().settings.sort)[0];
    if (first) await get().select(first.id);
  },

  setView(v) {
    set({ view: v });
  },

  async select(id) {
    await get().flush();
    if (!id) return set({ selectedId: null, current: null });
    const n = await api.notes.get(id);
    set({ selectedId: id, current: n });
  },

  async createNote(opts = {}) {
    await get().flush();
    const v = get().view;
    const now = Date.now();
    const note: Note = {
      id: uid(),
      title: opts.title ?? '',
      content: emptyDoc(),
      text: '',
      folderId: opts.folderId !== undefined ? opts.folderId : v.kind === 'folder' ? v.id : null,
      tags: opts.tags ?? (v.kind === 'tag' ? [v.tag] : []),
      pinned: v.kind === 'pinned',
      links: [],
      createdAt: now,
      updatedAt: now,
      trashedAt: null,
    };
    await api.notes.save(note);
    set((s) => ({ notes: [toMeta(note), ...s.notes], ...(opts.select === false ? {} : { selectedId: note.id, current: note }) }));
    // Desde la papelera no se ve la nota nueva: se vuelve a «Todas».
    if (v.kind === 'trash' && opts.select !== false) set({ view: { kind: 'all' } });
    return note;
  },

  updateCurrent(patch) {
    const cur = get().current;
    if (!cur) return;
    const next: Note = { ...cur, ...patch, updatedAt: Date.now() };
    if (patch.content) next.links = linksIn(patch.content);
    set((s) => ({ current: next, notes: s.notes.map((m) => (m.id === next.id ? toMeta(next) : m)) }));
    dirty = next;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void writeNow(), 450);
  },

  async patchNote(id, patch) {
    if (get().current?.id === id) {
      get().updateCurrent(patch);
      return get().flush();
    }
    const n = await api.notes.get(id);
    if (!n) return;
    const next = { ...n, ...patch, updatedAt: patch.trashedAt !== undefined ? n.updatedAt : Date.now() };
    await api.notes.save(next);
    set((s) => ({ notes: s.notes.map((m) => (m.id === id ? toMeta(next) : m)) }));
  },

  flush: writeNow,

  async trash(id) {
    const title = get().notes.find((n) => n.id === id)?.title;
    await get().patchNote(id, { trashedAt: Date.now() });
    if (get().selectedId === id) {
      const next = sortNotes(visibleNotes(get().notes, get().view, ''), get().settings.sort)[0];
      await get().select(next?.id ?? null);
    }
    get().showToast(title ? `«${title}»` : '', { label: 'undo', run: () => void get().restore(id) });
  },

  async restore(id) {
    await get().patchNote(id, { trashedAt: null });
  },

  async deleteForever(id) {
    await api.notes.remove(id);
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id), ...(s.selectedId === id ? { selectedId: null, current: null } : {}) }));
  },

  async emptyTrash() {
    for (const n of get().notes.filter((x) => x.trashedAt)) await get().deleteForever(n.id);
  },

  async duplicate(id) {
    await get().flush();
    const n = await api.notes.get(id);
    if (!n) return;
    const now = Date.now();
    const copy: Note = { ...n, id: uid(), title: n.title ? `${n.title} (2)` : '', pinned: false, createdAt: now, updatedAt: now, trashedAt: null };
    await api.notes.save(copy);
    set((s) => ({ notes: [toMeta(copy), ...s.notes], selectedId: copy.id, current: copy }));
  },

  async addFolder(name, parentId = null) {
    const f: Folder = { id: uid(), name: name.trim(), parentId, order: get().folders.length, createdAt: Date.now() };
    const folders = [...get().folders, f];
    set({ folders });
    await api.folders.save(folders);
    return f;
  },

  async renameFolder(id, name) {
    const folders = get().folders.map((f) => (f.id === id ? { ...f, name: name.trim() } : f));
    set({ folders });
    await api.folders.save(folders);
  },

  /** Las notas de la carpeta no se borran: pasan a «Todas» (sin carpeta). */
  async deleteFolder(id) {
    const ids = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of get().folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) (ids.add(f.id), (grew = true));
    }
    for (const n of get().notes.filter((x) => x.folderId && ids.has(x.folderId))) await get().patchNote(n.id, { folderId: null });
    const folders = get().folders.filter((f) => !ids.has(f.id));
    set((s) => ({ folders, view: s.view.kind === 'folder' && ids.has(s.view.id) ? { kind: 'all' } : s.view }));
    await api.folders.save(folders);
  },

  async renameTag(from, to) {
    const clean = normalizeTag(to);
    if (!clean || clean === from) return;
    for (const n of get().notes.filter((x) => x.tags.includes(from))) {
      await get().patchNote(n.id, { tags: [...new Set(n.tags.map((t) => (t === from ? clean : t)))] });
    }
    set((s) => ({ view: s.view.kind === 'tag' && s.view.tag === from ? { kind: 'tag', tag: clean } : s.view }));
  },

  setSettings(p) {
    const settings = { ...get().settings, ...p };
    set({ settings });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  },

  setPalette(open) {
    set({ paletteOpen: open });
  },
  setFocus(on) {
    set({ focus: on });
  },
  showToast(msg, action) {
    set({ toast: { id: Date.now(), msg, action } });
  },
  hideToast() {
    set({ toast: null });
  },
}));

export const normalizeTag = (t: string) =>
  t
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 40);

export function visibleNotes(notes: NoteMeta[], view: View, query: string, folders: Folder[] = []): NoteMeta[] {
  let list = view.kind === 'trash' ? notes.filter((n) => n.trashedAt) : notes.filter((n) => !n.trashedAt);
  if (view.kind === 'pinned') list = list.filter((n) => n.pinned);
  if (view.kind === 'tag') list = list.filter((n) => n.tags.includes(view.tag));
  if (view.kind === 'folder') {
    // Una carpeta muestra también las notas de sus subcarpetas.
    const ids = new Set([view.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of folders) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) (ids.add(f.id), (grew = true));
    }
    list = list.filter((n) => n.folderId && ids.has(n.folderId));
  }
  const q = query.trim().toLowerCase();
  if (q) list = list.filter((n) => n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q)));
  return list;
}

export function sortNotes(list: NoteMeta[], by: Settings['sort']): NoteMeta[] {
  const s = [...list];
  if (by === 'title') s.sort((a, b) => (a.title || '￿').localeCompare(b.title || '￿'));
  else if (by === 'created') s.sort((a, b) => b.createdAt - a.createdAt);
  else s.sort((a, b) => b.updatedAt - a.updatedAt);
  // Las fijadas van siempre arriba.
  return s.sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

export function allTags(notes: NoteMeta[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const n of notes) if (!n.trashedAt) for (const t of n.tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Color estable por etiqueta (misma paleta de Clipsy). */
const TAG_COLORS = ['#7B93FF', '#3CCB8A', '#F2B544', '#FF6B6B', '#B58CFF', '#4FC3D9', '#A0A0A7'];
export function tagColor(tag: string) {
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}
