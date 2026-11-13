import { ChevronRight, ChevronsDownUp, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Pencil, Pin, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import type { Folder as F, NoteMeta } from '@/types';
import { noteMenu } from './NoteEditor';
import { confirmDialog, openMenu, promptDialog } from './ui';

const NOTE = 'application/x-filenote-note';
const FOLDER = 'application/x-filenote-folder';
const KEY = 'filenote-expanded';
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** Explorador de notas (como en Obsidian): carpetas que se despliegan, subcarpetas y las notas dentro. */
export function Explorer() {
  const { t } = useT();
  const notes = useStore((s) => s.notes);
  const folders = useStore((s) => s.folders);
  const selectedId = useStore((s) => s.selectedId);
  const view = useStore((s) => s.view);
  const [open, setOpen] = useState<Set<string>>(loadExpanded);
  const [over, setOver] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const st = useStore.getState;

  const live = useMemo(() => notes.filter((n) => !n.trashedAt && !n.template), [notes]);
  const byFolder = useMemo(() => {
    const m = new Map<string | null, NoteMeta[]>();
    const known = new Set(folders.map((f) => f.id));
    for (const n of live) {
      const k = n.folderId && known.has(n.folderId) ? n.folderId : null;
      m.set(k, [...(m.get(k) ?? []), n]);
    }
    for (const l of m.values()) l.sort((a, b) => byName(a.title || '￿', b.title || '￿'));
    return m;
  }, [live, folders]);
  const childFolders = useMemo(() => {
    const m = new Map<string | null, F[]>();
    for (const f of folders) m.set(f.parentId, [...(m.get(f.parentId) ?? []), f]);
    for (const l of m.values()) l.sort((a, b) => byName(a.name, b.name));
    return m;
  }, [folders]);

  const save = (next: Set<string>) => {
    setOpen(next);
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {}
  };
  const expandTo = (folderId: string | null) => {
    const next = new Set(open);
    let changed = false;
    for (let p = folderId; p; p = folders.find((f) => f.id === p)?.parentId ?? null) if (!next.has(p)) (next.add(p), (changed = true));
    if (changed) save(next);
  };
  // La nota abierta siempre se ve: se despliegan sus carpetas.
  useEffect(() => {
    const n = notes.find((x) => x.id === selectedId);
    if (n?.folderId) expandTo(n.folderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  // Una carpeta elegida desde fuera (p. ej. tras importar) se despliega.
  useEffect(() => {
    if (view.kind === 'folder') expandTo(view.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    save(next);
  };

  const newNote = async (folderId: string | null) => {
    if (folderId) expandTo(folderId);
    if (st().view.kind !== 'all') st().setView({ kind: 'all' });
    await st().createNote({ folderId });
  };
  const newFolder = async (parentId: string | null) => {
    const name = await promptDialog({ title: t('dlg.newFolder'), label: t('dlg.folderName'), ok: t('dlg.save') });
    if (!name?.trim()) return;
    const f = await st().addFolder(name, parentId);
    const next = new Set(open);
    if (parentId) next.add(parentId);
    next.add(f.id);
    save(next);
  };

  const folderMenu = (f: F) => (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: t('exp.newNote'), icon: <FilePlus2 size={16} />, onClick: () => void newNote(f.id) },
      { label: t('menu.newSub'), icon: <FolderPlus size={16} />, onClick: () => void newFolder(f.id) },
      {
        label: t('menu.rename'),
        icon: <Pencil size={16} />,
        onClick: async () => {
          const name = await promptDialog({ title: t('dlg.renameFolder'), label: t('dlg.folderName'), value: f.name, ok: t('dlg.save') });
          if (name?.trim()) await st().renameFolder(f.id, name);
        },
      },
      { sep: true },
      {
        label: t('menu.delete'),
        icon: <Trash2 size={16} />,
        danger: true,
        onClick: async () => {
          if (await confirmDialog({ title: t('dlg.deleteFolderT', { name: f.name }), body: t('dlg.deleteFolderB'), ok: t('dlg.delete'), danger: true })) await st().deleteFolder(f.id);
        },
      },
    ]);
  };

  /* Arrastrar y soltar: notas y carpetas a otra carpeta (o a la raíz). */
  const dropProps = (target: string | null) => ({
    onDragOver: (e: DragEvent) => {
      const types = e.dataTransfer.types;
      if (!types.includes(NOTE) && !types.includes(FOLDER)) return;
      e.preventDefault();
      e.stopPropagation();
      if (over !== (target ?? '__root')) {
        setOver(target ?? '__root');
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        // Pasar un momento por encima de una carpeta cerrada la abre.
        if (target && !open.has(target)) hoverTimer.current = setTimeout(() => expandTo(target), 650);
      }
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o === (target ?? '__root') ? null : o));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      const noteId = e.dataTransfer.getData(NOTE);
      const folderId = e.dataTransfer.getData(FOLDER);
      if (noteId) void st().patchNote(noteId, { folderId: target });
      else if (folderId) void st().moveFolder(folderId, target);
      if (target) expandTo(target);
    },
  });

  const rows = (parent: string | null, depth: number): React.ReactNode => (
    <>
      {(childFolders.get(parent) ?? []).map((f) => {
        const isOpen = open.has(f.id);
        return (
          <div key={f.id} className="tree-group">
            <button
              className={`tree-row folder${over === f.id ? ' drop' : ''}`}
              style={{ paddingLeft: 6 + depth * 14 }}
              onClick={() => toggle(f.id)}
              onContextMenu={folderMenu(f)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(FOLDER, f.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              aria-expanded={isOpen}
              {...dropProps(f.id)}
            >
              <ChevronRight size={13} className={`tree-chev${isOpen ? ' open' : ''}`} />
              {isOpen ? <FolderOpen size={15} className="tree-ico" /> : <Folder size={15} className="tree-ico" />}
              <span className="tree-name">{f.name}</span>
            </button>
            {isOpen ? (
              <div className="tree-children" style={{ ['--guide' as string]: `${13 + depth * 14}px` }}>
                {rows(f.id, depth + 1)}
              </div>
            ) : null}
          </div>
        );
      })}
      {(byFolder.get(parent) ?? []).map((n) => (
        <button
          key={n.id}
          className={`tree-row note${n.id === selectedId ? ' on' : ''}`}
          style={{ paddingLeft: 6 + depth * 14 + 17 }}
          onClick={() => {
            if (st().view.kind !== 'all' && st().view.kind !== 'folder') st().setView({ kind: 'all' });
            void st().select(n.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu(e.clientX, e.clientY, noteMenu(n, t));
          }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(NOTE, n.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          title={n.title || t('app.untitled')}
        >
          <FileText size={14} className="tree-ico" />
          <span className="tree-name">{n.title || t('app.untitled')}</span>
          {n.pinned ? <Pin size={11} className="tree-pin" /> : null}
        </button>
      ))}
    </>
  );

  const empty = !folders.length && !live.length;
  return (
    <div className="side-section explorer">
      <div className="side-head">
        <span className="label">{t('exp.title')}</span>
        <span style={{ flex: 1 }} />
        <button data-tour="new" className="icon-btn" style={{ width: 26, height: 26 }} title={`${t('list.new')} (Ctrl+N)`} aria-label={t('list.new')} onClick={() => void newNote(null)}>
          <FilePlus2 size={15} />
        </button>
        <button className="icon-btn" style={{ width: 26, height: 26 }} title={t('nav.newFolder')} aria-label={t('nav.newFolder')} onClick={() => void newFolder(null)}>
          <FolderPlus size={15} />
        </button>
        <button className="icon-btn" style={{ width: 26, height: 26 }} title={t('exp.collapse')} aria-label={t('exp.collapse')} onClick={() => save(new Set())}>
          <ChevronsDownUp size={15} />
        </button>
      </div>
      <div className={`tree${over === '__root' ? ' drop' : ''}`} role="tree" aria-label={t('exp.title')} {...dropProps(null)}>
        {empty ? <div className="faint" style={{ padding: '2px 10px', fontSize: 13 }}>{t('exp.empty')}</div> : rows(null, 0)}
        {/* Espacio para soltar en la raíz */}
        <div className="tree-tail" />
      </div>
    </div>
  );
}
