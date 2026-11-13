import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import {
  Bold,
  Code,
  CopyPlus,
  Download,
  FileCode2,
  Folder,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  Paperclip,
  PenTool,
  Pin,
  Plus,
  ChevronDown,
  PinOff,
  Quote,
  Redo2,
  SquareDashedBottomCode,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  X,
  FileSymlink,
  LayoutTemplate,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { attachFiles, buildExtensions, insertBlock, insertFiles } from '@/editor/extensions';
import { TableBar, TableButton } from './TableTools';
import { allTemplates } from '@/lib/templates';
import { NodeSelection } from '@tiptap/pm/state';
import { exportNote } from '@/lib/export';
import { api } from '@/lib/api';
import { relTime, useT } from '@/lib/i18n';
import { normalizeTag, tagColor, useStore } from '@/lib/store';
import type { Note } from '@/types';
import { confirmDialog, openMenuAt, promptDialog, type MenuEntry } from './ui';

function Btn({ on, title, onClick, children, disabled }: { on?: boolean; title: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button className={`icon-btn${on ? ' on' : ''}`} title={title} aria-label={title} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function Toolbar({ editor, note }: { editor: Editor; note: Note }) {
  const { t } = useT();
  const focus = useStore((s) => s.focus);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      highlight: e.isActive('highlight'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      table: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  // Con un bloque entero seleccionado (dibujo, imagen…), lo nuevo va después y no lo reemplaza.
  const afterBlock = () => {
    const sel = editor.state.selection;
    return sel instanceof NodeSelection ? c().setTextSelection(sel.to) : c();
  };
  const I = 18;

  const setLink = async () => {
    const prev = (editor.getAttributes('link').href as string) || '';
    const url = await promptDialog({ title: t('tb.link'), label: t('tb.linkPrompt'), value: prev || 'https://', ok: t('dlg.save') });
    if (url === null) return;
    if (!url || url === 'https://') return void c().extendMarkRange('link').unsetLink().run();
    if (editor.state.selection.empty && !s.link) c().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
    else c().extendMarkRange('link').setLink({ href: url }).run();
  };
  return (
    <div className="toolbar">
      <Btn title={`${t('tb.undo')} (Ctrl+Z)`} onClick={() => c().undo().run()} disabled={!s.canUndo}>
        <Undo2 size={I} />
      </Btn>
      <Btn title={`${t('tb.redo')} (Ctrl+Y)`} onClick={() => c().redo().run()} disabled={!s.canRedo}>
        <Redo2 size={I} />
      </Btn>
      <span className="sep" />
      <button
        className="btn btn-ghost"
        style={{ height: 32, padding: '0 8px', gap: 4 }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) =>
          openMenuAt(e.currentTarget, [
            { label: t('tb.text'), checked: !s.h1 && !s.h2 && !s.h3, onClick: () => c().setParagraph().run() },
            { label: t('tb.h1'), icon: <Heading1 size={16} />, checked: s.h1, hint: 'Ctrl+Alt+1', onClick: () => c().toggleHeading({ level: 1 }).run() },
            { label: t('tb.h2'), icon: <Heading2 size={16} />, checked: s.h2, hint: 'Ctrl+Alt+2', onClick: () => c().toggleHeading({ level: 2 }).run() },
            { label: t('tb.h3'), icon: <Heading3 size={16} />, checked: s.h3, hint: 'Ctrl+Alt+3', onClick: () => c().toggleHeading({ level: 3 }).run() },
            { sep: true },
            { label: t('tb.strike'), icon: <Strikethrough size={16} />, checked: s.strike, hint: 'Ctrl+Shift+S', onClick: () => c().toggleStrike().run() },
            { label: t('tb.code'), icon: <Code size={16} />, checked: s.code, hint: 'Ctrl+E', onClick: () => c().toggleCode().run() },
            { label: t('tb.noteLink'), icon: <FileSymlink size={16} />, hint: '[[', onClick: () => c().insertContent('[[').run() },
          ])
        }
      >
        <span>{s.h1 ? t('tb.h1') : s.h2 ? t('tb.h2') : s.h3 ? t('tb.h3') : t('tb.text')}</span>
        <ChevronDown size={14} />
      </button>
      <span className="sep" />
      <Btn on={s.bold} title={`${t('tb.bold')} (Ctrl+B)`} onClick={() => c().toggleBold().run()}>
        <Bold size={I} />
      </Btn>
      <Btn on={s.italic} title={`${t('tb.italic')} (Ctrl+I)`} onClick={() => c().toggleItalic().run()}>
        <Italic size={I} />
      </Btn>
      <Btn on={s.underline} title={`${t('tb.underline')} (Ctrl+U)`} onClick={() => c().toggleUnderline().run()}>
        <Underline size={I} />
      </Btn>
      <Btn on={s.highlight} title={`${t('tb.highlight')} (Ctrl+Shift+H)`} onClick={() => c().toggleHighlight().run()}>
        <Highlighter size={I} />
      </Btn>
      <Btn on={s.link} title={t('tb.link')} onClick={() => void setLink()}>
        <Link2 size={I} />
      </Btn>
      <span className="sep" />
      <Btn on={s.bullet} title={t('tb.bullet')} onClick={() => c().toggleBulletList().run()}>
        <List size={I} />
      </Btn>
      <Btn on={s.ordered} title={t('tb.ordered')} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered size={I} />
      </Btn>
      <Btn on={s.task} title={t('tb.task')} onClick={() => c().toggleTaskList().run()}>
        <ListChecks size={I} />
      </Btn>
      <span className="sep" />
      <Btn title={t('tb.attach')} onClick={() => void attachFiles(editor)}>
        <Paperclip size={I} />
      </Btn>
      <Btn title={t('tb.draw')} onClick={() => insertBlock(editor, { type: 'drawing', attrs: { autoOpen: true } })}>
        <PenTool size={I} />
      </Btn>
      <TableButton editor={editor} title={t('tb.table')} />
      <Btn
        title={t('tb.insert')}
        onClick={(e) =>
          openMenuAt(e.currentTarget, [
            { label: t('tb.quote'), icon: <Quote size={16} />, checked: s.quote, onClick: () => c().toggleBlockquote().run() },
            { label: t('tb.codeBlock'), icon: <SquareDashedBottomCode size={16} />, checked: s.codeBlock, onClick: () => c().toggleCodeBlock().run() },
            { label: t('tb.rule'), icon: <Minus size={16} />, onClick: () => afterBlock().setHorizontalRule().run() },
          ])
        }
      >
        <Plus size={I} />
      </Btn>
      <span className="spacer" />
      <Btn title={`${t('tb.focus')} (Ctrl+Shift+F)`} on={focus} onClick={() => useStore.getState().setFocus(!focus)}>
        {focus ? <Minimize2 size={I} /> : <Maximize2 size={I} />}
      </Btn>
      <MoreButton note={note} editor={editor} />
    </div>
  );
}

export function noteMenu(note: Pick<Note, 'id' | 'pinned' | 'folderId' | 'title' | 'template'>, t: ReturnType<typeof useT>['t'], editor?: Editor | null): MenuEntry[] {
  const st = useStore.getState();
  const folderItems: MenuEntry[] = [
    { label: t('menu.noFolder'), checked: !note.folderId, onClick: () => void st.patchNote(note.id, { folderId: null }) },
    ...st.folders.map((f) => ({ label: f.name, checked: note.folderId === f.id, onClick: () => void st.patchNote(note.id, { folderId: f.id }) })),
  ];
  const exp = (fmt: 'pdf' | 'docx' | 'md') => async () => {
    await st.flush();
    const ok = await exportNote(note.id, fmt, editor ?? null);
    if (ok === false) st.showToast(t('export.failed'));
    else if (ok) st.showToast(`${t('export.done')}: ${ok}`);
  };
  return [
    { label: note.pinned ? t('menu.unpin') : t('menu.pin'), icon: note.pinned ? <PinOff size={16} /> : <Pin size={16} />, onClick: () => void st.patchNote(note.id, { pinned: !note.pinned }) },
    { label: t('menu.move'), icon: <Folder size={16} />, children: folderItems },
    { label: t('menu.duplicate'), icon: <CopyPlus size={16} />, onClick: () => void st.duplicate(note.id) },
    note.template
      ? { label: t('tpl.use'), icon: <LayoutTemplate size={16} />, onClick: () => void fromTemplate(note.id) }
      : { label: t('tpl.saveAs'), icon: <LayoutTemplate size={16} />, onClick: () => void st.saveAsTemplate(note.id) },
    {
      label: t('menu.export'),
      icon: <Download size={16} />,
      children: [
        { label: t('export.pdf'), onClick: exp('pdf') },
        { label: t('export.docx'), onClick: exp('docx') },
        { label: t('export.md'), icon: <FileCode2 size={16} />, onClick: exp('md') },
      ],
    },
    { sep: true },
    { label: t('menu.trash'), icon: <Trash2 size={16} />, danger: true, hint: 'Supr', onClick: () => void st.trash(note.id) },
  ];
}

/** Nueva nota a partir de una plantilla del usuario. */
async function fromTemplate(id: string) {
  const st = useStore.getState();
  await st.flush();
  const tpl = allTemplates(st.notes, st.settings.language, async (x) => (await api.notes.get(x))?.content).find((x) => x.id === id);
  if (tpl) await st.newFromTemplate(tpl);
}

function MoreButton({ note, editor }: { note: Note; editor: Editor }) {
  const { t } = useT();
  return (
    <button className="icon-btn" title={t('menu.more')} aria-label={t('menu.more')} onClick={(e) => openMenuAt(e.currentTarget, noteMenu(note, t, editor), 'right')}>
      <MoreHorizontal size={18} />
    </button>
  );
}

function Tags({ note }: { note: Note }) {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  const all = useStore((s) => s.notes);
  const known = useMemo(() => [...new Set(all.flatMap((n) => n.tags))].filter((x) => !note.tags.includes(x)), [all, note.tags]);
  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    if (tag && !note.tags.includes(tag)) useStore.getState().updateCurrent({ tags: [...note.tags, tag] });
    setDraft('');
  };
  return (
    <div className="tags-row">
      {note.tags.map((tag) => (
        <span key={tag} className="tag-chip">
          <span className="tag-dot" style={{ background: tagColor(tag) }} />#{tag}
          <button aria-label={`× ${tag}`} onClick={() => useStore.getState().updateCurrent({ tags: note.tags.filter((x) => x !== tag) })}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        list="filenote-tags"
        placeholder={`+ ${t('note.addTag')}`}
        aria-label={t('note.addTag')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && draft.trim()) {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && note.tags.length) useStore.getState().updateCurrent({ tags: note.tags.slice(0, -1) });
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
      <datalist id="filenote-tags">
        {known.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </div>
  );
}

function Backlinks({ id }: { id: string }) {
  const { t } = useT();
  const notes = useStore((s) => s.notes);
  const from = notes.filter((n) => !n.trashedAt && n.id !== id && n.links.includes(id));
  if (!from.length) return null;
  return (
    <div className="backlinks fade-in">
      <div className="label">
        {t('note.backlinks')} · {from.length}
      </div>
      {from.map((n) => (
        <button key={n.id} className="backlink" onClick={() => void useStore.getState().select(n.id)}>
          <div className="t">{n.title || t('app.untitled')}</div>
          <div className="s">{n.text.slice(0, 160)}</div>
        </button>
      ))}
    </div>
  );
}

/** Título que crece con el texto (varias líneas si hace falta). */
function TitleField({ note, onEnter }: { note: Note; onEnter: () => void }) {
  const { t } = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(fit, [note.title, note.id]);
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <textarea
      ref={ref}
      className="doc-title"
      rows={1}
      placeholder={t('note.titlePh')}
      aria-label={t('note.titlePh')}
      value={note.title}
      autoFocus={!note.title && !note.text}
      onChange={(e) => useStore.getState().updateCurrent({ title: e.target.value.replace(/\n/g, ' ') })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

export function NoteEditor() {
  const { t, lang } = useT();
  const note = useStore((s) => s.current);
  const spell = useStore((s) => s.settings.spellcheck);

  if (!note)
    return (
      <section className="pane">
        <div className="empty">
          <div>
            <h3>{t('note.noneT')}</h3>
            <div>{t('note.noneB')}</div>
          </div>
        </div>
      </section>
    );
  return <EditorFor key={note.id} note={note} lang={lang} spell={spell} />;
}

function EditorFor({ note, lang, spell }: { note: Note; lang: string; spell: boolean }) {
  const { t } = useT();
  const extensions = useMemo(() => buildExtensions(t('note.bodyPh'), note.id), [note.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const editor = useEditor({
    extensions,
    content: note.content,
    editable: !note.trashedAt,
    editorProps: {
      attributes: { spellcheck: String(spell), lang },
      // Ctrl+clic (Cmd en Mac) abre un enlace web en el navegador.
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
        if (a && (event.ctrlKey || event.metaKey)) {
          window.open(a.href, '_blank');
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.length || !editorRef.current) return false;
        void insertFiles(editorRef.current, files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length || !editorRef.current) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertFiles(editorRef.current, files, pos);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => useStore.getState().updateCurrent({ content: e.getJSON(), text: e.getText({ blockSeparator: '\n' }).slice(0, 20000) }),
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;
  const words = useMemo(() => (note.text.trim() ? note.text.trim().split(/\s+/).length : 0), [note.text]);

  if (note.trashedAt)
    return (
      <section className="pane">
        <div className="toolbar" style={{ justifyContent: 'center', gap: 12, background: 'var(--danger-soft)' }}>
          <span>{t('note.inTrash')}</span>
          <button className="btn btn-primary" style={{ height: 32 }} onClick={() => void useStore.getState().restore(note.id)}>
            {t('note.restore')}
          </button>
          <button
            className="btn btn-danger"
            style={{ height: 32 }}
            onClick={async () => {
              if (await confirmDialog({ title: t('dlg.deleteForeverT'), body: t('dlg.deleteForeverB'), ok: t('dlg.delete'), danger: true })) await useStore.getState().deleteForever(note.id);
            }}
          >
            {t('note.deleteForever')}
          </button>
        </div>
        <div className="doc-scroll" style={{ opacity: 0.6, pointerEvents: 'none' }}>
          <div className="doc">
            <h1 className="doc-title">{note.title || t('app.untitled')}</h1>
            <EditorContent editor={editor} />
          </div>
        </div>
      </section>
    );

  return (
    <section className="pane">
      {editor ? <Toolbar editor={editor} note={note} /> : <div className="toolbar" />}
      <div className="doc-scroll" onMouseDown={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}>
        <div className="doc fade-in">
          <div className="doc-meta tabular">
            <span>{t('note.edited', { when: relTime(note.updatedAt, lang) })}</span>
            <span>·</span>
            <span>{t('note.words', { n: words })}</span>
          </div>
          <TitleField
            note={note}
            onEnter={() => {
              // Enfoque inmediato (sin esperar un fotograma) para no perder lo que se escribe rápido.
              if (!editor) return;
              editor.view.focus();
              editor.commands.setTextSelection(1);
            }}
          />
          {note.template ? (
            <div className="tpl-banner">
              <LayoutTemplate size={16} />
              <span>{t('tpl.banner')}</span>
              <button className="btn btn-primary btn-sm" onClick={() => void fromTemplate(note.id)}>
                {t('tpl.use')}
              </button>
            </div>
          ) : null}
          <Tags note={note} />
          <EditorContent editor={editor} />
          {editor ? <TableBar editor={editor} /> : null}
          <Backlinks id={note.id} />
        </div>
      </div>
    </section>
  );
}
