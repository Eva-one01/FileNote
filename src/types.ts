import type { JSONContent } from '@tiptap/core';

export interface Note {
  id: string;
  title: string;
  /** Documento del editor (TipTap/ProseMirror). */
  content: JSONContent;
  /** Texto plano (búsqueda y vista previa). */
  text: string;
  folderId: string | null;
  tags: string[];
  pinned: boolean;
  /** Notas a las que enlaza con [[…]] (para los retroenlaces). */
  links: string[];
  createdAt: number;
  updatedAt: number;
  /** En la papelera desde esta fecha (se borra del todo a los 30 días). */
  trashedAt: number | null;
  /** Plantilla del usuario: no sale en las listas normales, solo en «Plantillas». */
  template?: boolean;
  /** Nota del día (AAAA-MM-DD). */
  daily?: string;
}

/** Lo que se lista sin abrir la nota (todo menos el documento). */
export type NoteMeta = Omit<Note, 'content'>;

export interface Folder {
  id: string;
  /** Carpeta creada por la app (la de las notas del día). */
  system?: 'daily';
  name: string;
  parentId: string | null;
  order: number;
  createdAt: number;
}

export type ThemePref = 'system' | 'light' | 'dark';
export type AccentId = 'blue' | 'violet' | 'teal' | 'magenta' | 'graphite';
export type SizePref = 'normal' | 'large' | 'xlarge';
export type Lang = 'es' | 'en' | 'pt' | 'fr' | 'ru' | 'de';
export type SortBy = 'updated' | 'created' | 'title';

export interface Settings {
  theme: ThemePref;
  accent: AccentId;
  size: SizePref;
  language: Lang;
  sort: SortBy;
  spellcheck: boolean;
  /** Ya vio el tutorial de inicio. */
  onboarded: boolean;
}

/** Qué se muestra en la lista: todas, fijadas, una carpeta, una etiqueta o la papelera. */
export type View =
  | { kind: 'all' }
  | { kind: 'pinned' }
  | { kind: 'folder'; id: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'trash' }
  | { kind: 'templates' }
  | { kind: 'tasks' }
  | { kind: 'graph' }
  | { kind: 'study' };
