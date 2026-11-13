import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import {
  CalendarDays,
  FileSymlink,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  LayoutTemplate,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Paperclip,
  PenTool,
  Pilcrow,
  Quote,
  SquareDashedBottomCode,
  Table2,
} from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { api } from '@/lib/api';
import { translate, type Key } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { allTemplates, fillTokens } from '@/lib/templates';
import { attachFiles, insertBlock } from './extensions';

export interface SlashItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** Palabras extra para encontrarlo (en varios idiomas). */
  keys: string;
  group?: string;
  run: (editor: Editor) => void;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function items(query: string): SlashItem[] {
  const st = useStore.getState();
  const lang = st.settings.language;
  const t = (k: Key) => translate(lang, k);
  const I = 16;
  const base: SlashItem[] = [
    { id: 'text', label: t('tb.text'), icon: <Pilcrow size={I} />, keys: 'text paragraph texto parrafo', run: (e) => e.chain().focus().setParagraph().run() },
    { id: 'h1', label: t('tb.h1'), icon: <Heading1 size={I} />, keys: 'h1 heading title titulo encabezado', run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
    { id: 'h2', label: t('tb.h2'), icon: <Heading2 size={I} />, keys: 'h2 heading subtitulo', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
    { id: 'h3', label: t('tb.h3'), icon: <Heading3 size={I} />, keys: 'h3 heading', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
    { id: 'bullet', label: t('tb.bullet'), icon: <List size={I} />, keys: 'list bullet lista viñetas', run: (e) => e.chain().focus().toggleBulletList().run() },
    { id: 'ordered', label: t('tb.ordered'), icon: <ListOrdered size={I} />, keys: 'numbered ordered numerada 1.', run: (e) => e.chain().focus().toggleOrderedList().run() },
    { id: 'task', label: t('tb.task'), icon: <ListChecks size={I} />, keys: 'todo task check tareas checklist', run: (e) => e.chain().focus().toggleTaskList().run() },
    { id: 'table', label: t('tb.table'), icon: <Table2 size={I} />, keys: 'table tabla grid', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: 'quote', label: t('tb.quote'), icon: <Quote size={I} />, keys: 'quote cita blockquote', run: (e) => e.chain().focus().toggleBlockquote().run() },
    { id: 'code', label: t('tb.codeBlock'), icon: <SquareDashedBottomCode size={I} />, keys: 'code codigo block', run: (e) => e.chain().focus().toggleCodeBlock().run() },
    { id: 'rule', label: t('tb.rule'), icon: <Minus size={I} />, keys: 'divider line separador linea hr', run: (e) => e.chain().focus().setHorizontalRule().run() },
    { id: 'draw', label: t('tb.draw'), icon: <PenTool size={I} />, keys: 'draw dibujo sketch pen lapiz', run: (e) => insertBlock(e, { type: 'drawing', attrs: { autoOpen: true } }) },
    { id: 'file', label: t('tb.attach'), icon: <Paperclip size={I} />, keys: 'image imagen file archivo attach adjuntar foto pdf', run: (e) => void attachFiles(e) },
    { id: 'link', label: t('tb.noteLink'), icon: <FileSymlink size={I} />, keys: 'link enlace note nota [[', run: (e) => e.chain().focus().insertContent('[[').run() },
    {
      id: 'date',
      label: t('slash.date'),
      icon: <CalendarDays size={I} />,
      keys: 'date today fecha hoy',
      run: (e) => e.chain().focus().insertContent(fillTokens('{{date}}', lang)).run(),
    },
  ];
  const tpls: SlashItem[] = allTemplates(st.notes, lang, async (id) => (await api.notes.get(id))?.content).map((tp) => ({
    id: `tpl:${tp.id}`,
    label: tp.name,
    group: t('slash.templates'),
    icon: tp.builtin ? <LayoutTemplate size={I} /> : <FileText size={I} />,
    keys: `template plantilla ${tp.name}`,
    run: (e) => {
      void Promise.resolve(tp.content()).then((c) => insertBlock(e, (fillTokens(c, lang).content ?? []) as never));
    },
  }));
  const q = fold(query.trim());
  const all = [...base, ...tpls];
  if (!q) return all;
  return all.filter((it) => fold(`${it.label} ${it.keys}`).includes(q)).sort((a, b) => Number(!fold(a.label).startsWith(q)) - Number(!fold(b.label).startsWith(q)));
}

interface Handle {
  onKeyDown(e: KeyboardEvent): boolean;
}

const Menu = forwardRef<Handle, { items: SlashItem[]; command: (i: SlashItem) => void }>(function Menu({ items: list, command }, ref) {
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const lang = useStore((s) => s.settings.language);
  useEffect(() => setSel(0), [list]);
  useEffect(() => {
    box.current?.querySelector('.menu-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (!list.length) return false;
      if (e.key === 'ArrowDown') return setSel((i) => (i + 1) % list.length), true;
      if (e.key === 'ArrowUp') return setSel((i) => (i - 1 + list.length) % list.length), true;
      if (e.key === 'Enter' || e.key === 'Tab') {
        command(list[sel]);
        return true;
      }
      return false;
    },
  }));
  let lastGroup: string | undefined;
  return (
    <div ref={box} className="menu slash-menu" style={{ position: 'static' }} role="listbox" aria-label="/">
      {list.length === 0 ? <div className="menu-empty">{translate(lang, 'slash.none')}</div> : null}
      {list.map((it, i) => {
        const head = it.group && it.group !== lastGroup ? it.group : null;
        lastGroup = it.group;
        return (
          <div key={it.id}>
            {head ? <div className="menu-group">{head}</div> : null}
            <button
              className={`menu-item${i === sel ? ' on' : ''}`}
              role="option"
              aria-selected={i === sel}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                command(it);
              }}
            >
              <span className="slash-ico">{it.icon}</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
});

function renderer() {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;
  let handle: Handle | null = null;
  const place = (rect: DOMRect | null | undefined) => {
    if (!host || !rect) return;
    const below = window.innerHeight - rect.bottom > 360;
    host.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
    host.style.top = below ? `${rect.bottom + 6}px` : '';
    host.style.bottom = below ? '' : `${window.innerHeight - rect.top + 6}px`;
  };
  const draw = (p: SuggestionProps<SlashItem>) => {
    root?.render(<Menu ref={(h) => void (handle = h)} items={p.items} command={(i) => p.command(i)} />);
    place(p.clientRect?.());
  };
  return {
    onStart(p: SuggestionProps<SlashItem>) {
      host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.zIndex = '60';
      document.body.appendChild(host);
      root = createRoot(host);
      draw(p);
    },
    onUpdate(p: SuggestionProps<SlashItem>) {
      draw(p);
    },
    onKeyDown(p: SuggestionKeyDownProps) {
      if (p.event.key === 'Escape') {
        this.onExit();
        return true;
      }
      return handle?.onKeyDown(p.event) ?? false;
    },
    onExit() {
      const r = root;
      const h = host;
      root = null;
      host = null;
      handle = null;
      setTimeout(() => {
        r?.unmount();
        h?.remove();
      }, 0);
    },
  };
}

/** Menú «/»: al escribir / al principio de una línea (o tras un espacio) se elige qué insertar. */
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        pluginKey: new PluginKey('slashCommand'),
        allowSpaces: false,
        // No dentro de bloques de código.
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => items(query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: renderer,
      }),
    ];
  },
});
