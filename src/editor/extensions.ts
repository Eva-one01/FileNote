import type { Content, Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Attachment } from './attachment';
import { Drawing } from './drawing';
import { NoteLink, noteLinkSuggestionBase } from './noteLink';
import { SlashCommand } from './slash';
import { suggestRenderer, type LinkItem } from './SuggestMenu';

/** Notas que coinciden con lo escrito después de [[ (y, si no hay una igual, «Crear nota …»). */
function linkItems(query: string, currentId: string | null): LinkItem[] {
  const q = query.trim().toLowerCase();
  const notes = useStore
    .getState()
    .notes.filter((n) => !n.trashedAt && !n.template && n.id !== currentId)
    .filter((n) => !q || n.title.toLowerCase().includes(q))
    .sort((a, b) => {
      const as = a.title.toLowerCase().startsWith(q) ? 0 : 1;
      const bs = b.title.toLowerCase().startsWith(q) ? 0 : 1;
      return as - bs || b.updatedAt - a.updatedAt;
    })
    .slice(0, 8)
    .map((n) => ({ id: n.id, title: n.title }));
  const exact = notes.some((n) => n.title.trim().toLowerCase() === q);
  return q && !exact ? [...notes, { id: '', title: query.trim(), create: true }] : notes;
}

export function buildExtensions(placeholder: string, currentId: string | null) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer', target: null } },
    }),
    Placeholder.configure({ placeholder, includeChildren: false }),
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ inline: false, allowBase64: true }),
    Attachment,
    Drawing,
    SlashCommand,
    NoteLink.configure({
      suggestion: {
        ...noteLinkSuggestionBase,
        items: ({ query }) => linkItems(query, currentId),
        render: suggestRenderer,
        command: ({ editor, range, props }) => {
          const p = props as LinkItem;
          if (!p.create) return noteLinkSuggestionBase.command!({ editor, range, props: p });
          // «Crear nota …»: se crea vacía (sin abrirla) y se enlaza.
          void useStore
            .getState()
            .createNote({ title: p.title, select: false, folderId: null, tags: [] })
            .then((n) => noteLinkSuggestionBase.command!({ editor, range, props: { id: n.id, title: n.title } }));
        },
      },
    }),
  ];
}

/** Guarda archivos (pegados, arrastrados o elegidos) y los inserta: imágenes a la vista, el resto como tarjeta. */
export async function insertFiles(editor: Editor, files: File[], at?: number) {
  for (const file of files) {
    const data = await file.arrayBuffer();
    const saved = await api.attachments.save(file.name || 'archivo', file.type || 'application/octet-stream', data);
    if (!saved) continue;
    insertSaved(editor, [saved], at);
    at = undefined;
  }
}

export function insertSaved(editor: Editor, saved: { url: string; name: string; size: number; mime: string }[], at?: number) {
  const nodes = saved.map((s) =>
    s.mime.startsWith('image/') && !s.mime.includes('svg') ? { type: 'image', attrs: { src: s.url, alt: s.name } } : { type: 'attachment', attrs: { url: s.url, name: s.name, size: s.size, mime: s.mime } },
  );
  insertBlock(editor, nodes, at);
}

/**
 * Inserta contenido sin reemplazar lo seleccionado cuando es un bloque entero (un dibujo, una imagen…):
 * en ese caso va justo después.
 */
export function insertBlock(editor: Editor, content: Content, at?: number) {
  const sel = editor.state.selection;
  const pos = at ?? (sel instanceof NodeSelection ? sel.to : undefined);
  const chain = editor.chain().focus();
  (pos !== undefined ? chain.insertContentAt(pos, content) : chain.insertContent(content)).run();
}

/** Elegir imágenes o archivos y adjuntarlos (en el navegador de pruebas usa su propio selector). */
export async function attachFiles(editor: Editor) {
  const saved = await api.attachments.pick();
  if (saved.length) insertSaved(editor, saved);
  else if (!window.filenote) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.onchange = () => void insertFiles(editor, [...(inp.files ?? [])]);
    inp.click();
  }
}
