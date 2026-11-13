import { mergeAttributes, Node } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { translate } from '@/lib/i18n';
import { useStore } from '@/lib/store';

export const noteLinkKey = new PluginKey('noteLink');

/** Base del menú de [[: dónde se activa y qué inserta. La lista y el dibujo los pone el editor. */
export const noteLinkSuggestionBase: Omit<SuggestionOptions, 'editor'> = {
  char: '[[',
  pluginKey: noteLinkKey,
  allowSpaces: true,
  command: ({ editor, range, props }) => {
    const p = props as { id: string; title: string };
    editor
      .chain()
      .focus()
      .insertContentAt(range, [{ type: 'noteLink', attrs: { id: p.id, title: p.title } }, { type: 'text', text: ' ' }])
      .run();
  },
};

/**
 * Enlace a otra nota, como en Obsidian: se escribe [[ y se elige la nota (o se crea).
 * Guarda el id de la nota: si la otra nota cambia de título, el enlace se actualiza solo.
 */
export const NoteLink = Node.create<{ suggestion: Omit<SuggestionOptions, 'editor'> }>({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { suggestion: noteLinkSuggestionBase };
  },

  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-note-id') },
      /** Título al enlazar (se usa si la nota ya no existe). */
      title: { default: '', parseHTML: (el) => el.getAttribute('data-title') || el.textContent || '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-note-id]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-note-id': node.attrs.id, 'data-title': node.attrs.title, class: 'note-link' }), node.attrs.title || ''];
  },

  renderText({ node }) {
    return `[[${currentTitle(node.attrs.id, node.attrs.title)}]]`;
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'note-link';
      dom.setAttribute('data-note-id', node.attrs.id);
      dom.contentEditable = 'false';
      const paint = () => {
        const s = useStore.getState();
        const target = s.notes.find((n) => n.id === node.attrs.id);
        const missing = !target || !!target.trashedAt;
        dom.textContent = currentTitle(node.attrs.id, node.attrs.title);
        dom.classList.toggle('missing', missing);
        dom.title = missing ? translate(s.settings.language, 'link.missing') : '';
      };
      paint();
      const unsub = useStore.subscribe((s, prev) => {
        if (s.notes !== prev.notes || s.settings.language !== prev.settings.language) paint();
      });
      // Clic: abrir la nota enlazada.
      dom.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const target = useStore.getState().notes.find((n) => n.id === node.attrs.id);
        if (!target || target.trashedAt) return;
        e.preventDefault();
        const st = useStore.getState();
        if (st.view.kind === 'trash' || (st.view.kind !== 'all' && !viewHas(target.id))) st.setView({ kind: 'all' });
        void st.select(target.id);
      });
      return { dom, destroy: unsub };
    };
  },

  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
  },
});

function viewHas(id: string) {
  const s = useStore.getState();
  const n = s.notes.find((x) => x.id === id);
  if (!n) return false;
  const v = s.view;
  if (v.kind === 'pinned') return n.pinned;
  if (v.kind === 'tag') return n.tags.includes(v.tag);
  if (v.kind === 'folder') return n.folderId === v.id;
  return true;
}

export function currentTitle(id: string, fallback: string) {
  const s = useStore.getState();
  const n = s.notes.find((x) => x.id === id);
  return (n ? n.title : fallback) || translate(s.settings.language, 'app.untitled');
}
