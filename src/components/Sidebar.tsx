import { CalendarDays, ChevronRight, FileText, LayoutTemplate, ListChecks, Waypoints, GraduationCap, Folder, FolderOpen, FolderPlus, Hash, Pencil, Pin, Search, Settings2, Trash2 } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { useT } from '@/lib/i18n';
import { allTags, tagColor, useStore } from '@/lib/store';
import type { Folder as F, View } from '@/types';
import { confirmDialog, openMenu, promptDialog } from './ui';

/** Logo de FileNote: hoja con la esquina doblada y el margen en color de acento. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 2.75h8.5L19.25 7.5V19A2.25 2.25 0 0 1 17 21.25H6A2.25 2.25 0 0 1 3.75 19V5A2.25 2.25 0 0 1 6 2.75Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M14.25 3v4.5h4.75" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M8 11.5h7M8 15.5h5" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

const same = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b);

/** Suelta una nota (arrastrada desde la lista) en una carpeta. */
function useDrop(onDrop: (noteId: string) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes('application/x-filenote-note')) return;
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false);
        const id = e.dataTransfer.getData('application/x-filenote-note');
        if (id) onDrop(id);
      },
    },
  };
}

function NavItem({ icon, label, count, view, onContext, drop, depth = 0, toggle, tour }: { tour?: string; icon: React.ReactNode; label: string; count?: number; view: View; onContext?: (e: React.MouseEvent) => void; drop?: (id: string) => void; depth?: number; toggle?: React.ReactNode }) {
  const current = useStore((s) => s.view);
  const d = useDrop(drop ?? (() => undefined));
  return (
    <button
      data-tour={tour}
      className={`nav-item${same(current, view) ? ' on' : ''}${d.over ? ' drop' : ''}`}
      style={{ paddingLeft: 10 + depth * 16 }}
      onClick={() => useStore.getState().setView(view)}
      onContextMenu={onContext}
      {...(drop ? d.props : {})}
    >
      {toggle}
      {icon}
      <span className="name">{label}</span>
      {count ? <span className="count">{count}</span> : null}
    </button>
  );
}

export function Sidebar({ onSettings }: { onSettings: () => void }) {
  const { t } = useT();
  const notes = useStore((s) => s.notes);
  const folders = useStore((s) => s.folders);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const live = useMemo(() => notes.filter((n) => !n.trashedAt && !n.template), [notes]);
  const templates = useMemo(() => notes.filter((n) => !n.trashedAt && n.template).length, [notes]);
  const tags = useMemo(() => allTags(notes), [notes]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of live) if (n.folderId) m.set(n.folderId, (m.get(n.folderId) ?? 0) + 1);
    return m;
  }, [live]);
  const st = useStore.getState;

  const newFolder = async (parentId: string | null = null) => {
    const name = await promptDialog({ title: t('dlg.newFolder'), label: t('dlg.folderName'), ok: t('dlg.save') });
    if (name) {
      const f = await st().addFolder(name, parentId);
      if (parentId) setClosed((c) => new Set([...c].filter((x) => x !== parentId)));
      st().setView({ kind: 'folder', id: f.id });
    }
  };

  const folderMenu = (f: F) => (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: t('menu.newSub'), icon: <FolderPlus size={16} />, onClick: () => void newFolder(f.id) },
      {
        label: t('menu.rename'),
        icon: <Pencil size={16} />,
        onClick: async () => {
          const name = await promptDialog({ title: t('dlg.renameFolder'), label: t('dlg.folderName'), value: f.name, ok: t('dlg.save') });
          if (name) await st().renameFolder(f.id, name);
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

  const tagMenu = (tag: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      {
        label: t('menu.rename'),
        icon: <Pencil size={16} />,
        onClick: async () => {
          const name = await promptDialog({ title: t('dlg.renameTag'), label: t('dlg.tagName'), value: tag, ok: t('dlg.save') });
          if (name) await st().renameTag(tag, name);
        },
      },
    ]);
  };

  const tree = (parentId: string | null, depth: number): React.ReactNode =>
    folders
      .filter((f) => f.parentId === parentId)
      .map((f) => {
        const kids = folders.some((x) => x.parentId === f.id);
        const isClosed = closed.has(f.id);
        return (
          <div key={f.id}>
            <NavItem
              depth={depth}
              view={{ kind: 'folder', id: f.id }}
              label={f.name}
              count={counts.get(f.id)}
              icon={f.system === 'daily' ? <CalendarDays size={17} /> : kids && !isClosed ? <FolderOpen size={17} /> : <Folder size={17} />}
              onContext={folderMenu(f)}
              drop={(id) => void st().patchNote(id, { folderId: f.id })}
              toggle={
                kids ? (
                  <span
                    role="button"
                    aria-label={isClosed ? '+' : '−'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setClosed((c) => {
                        const n = new Set(c);
                        if (n.has(f.id)) n.delete(f.id);
                        else n.add(f.id);
                        return n;
                      });
                    }}
                    style={{ display: 'grid', placeItems: 'center', width: 14, marginLeft: -6, marginRight: -4, transition: 'transform var(--fast)', transform: isClosed ? 'none' : 'rotate(90deg)' }}
                  >
                    <ChevronRight size={13} />
                  </span>
                ) : null
              }
            />
            {kids && !isClosed ? tree(f.id, depth + 1) : null}
          </div>
        );
      });

  return (
    <aside className="sidebar">
      <div className="brand drag">
        <Logo />
        <span className="brand-name">FILENOTE</span>
      </div>
      <div className="side-scroll">
        <button data-tour="search" className="nav-item" onClick={() => st().setPalette(true)} style={{ border: '1px solid var(--border-strong)', marginBottom: 10, background: 'var(--surface)' }}>
          <Search size={17} />
          <span className="name">{t('nav.search')}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <NavItem view={{ kind: 'all' }} label={t('nav.all')} count={live.length} icon={<FileText size={17} />} drop={(id) => void st().patchNote(id, { folderId: null })} />
        <button data-tour="today" className="nav-item" onClick={() => void st().openDaily()} title={`${t('daily.open')} (${t('daily.key')})`}>
          <CalendarDays size={17} />
          <span className="name">{t('daily.today')}</span>
        </button>
        <NavItem tour="tasks" view={{ kind: 'tasks' }} label={t('tasks.title')} icon={<ListChecks size={17} />} />
        <NavItem tour="study" view={{ kind: 'study' }} label={t('study.title')} icon={<GraduationCap size={17} />} />
        <NavItem tour="graph" view={{ kind: 'graph' }} label={t('graph.title')} icon={<Waypoints size={17} />} />
        <NavItem view={{ kind: 'pinned' }} label={t('nav.pinned')} count={live.filter((n) => n.pinned).length} icon={<Pin size={17} />} drop={(id) => void st().patchNote(id, { pinned: true })} />

        <div className="side-section">
          <div className="side-head">
            <span className="label">{t('nav.folders')}</span>
            <button className="icon-btn" style={{ width: 26, height: 26 }} title={t('nav.newFolder')} aria-label={t('nav.newFolder')} onClick={() => void newFolder()}>
              <FolderPlus size={15} />
            </button>
          </div>
          {folders.length ? tree(null, 0) : <div className="faint" style={{ padding: '2px 10px', fontSize: 13 }}>{t('nav.noFolders')}</div>}
        </div>

        <div className="side-section">
          <div className="side-head">
            <span className="label">{t('nav.tags')}</span>
          </div>
          {tags.length ? (
            tags.map(({ tag, count }) => <NavItem key={tag} view={{ kind: 'tag', tag }} label={tag} count={count} icon={<Hash size={16} color={tagColor(tag)} />} onContext={tagMenu(tag)} />)
          ) : (
            <div className="faint" style={{ padding: '2px 10px', fontSize: 13 }}>
              {t('nav.noTags')}
            </div>
          )}
        </div>

        <div className="side-section">
          <NavItem tour="templates" view={{ kind: 'templates' }} label={t('tpl.nav')} count={templates} icon={<LayoutTemplate size={17} />} />
          <NavItem view={{ kind: 'trash' }} label={t('nav.trash')} count={notes.filter((n) => n.trashedAt).length} icon={<Trash2 size={17} />} drop={(id) => void st().trash(id)} />
        </div>
      </div>
      <div className="side-foot">
        <button data-tour="settings" className="nav-item" onClick={onSettings}>
          <Settings2 size={17} />
          <span className="name">{t('nav.settings')}</span>
        </button>
      </div>
    </aside>
  );
}
