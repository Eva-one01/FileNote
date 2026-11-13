import { CalendarDays, LayoutTemplate, ListChecks, Waypoints, GraduationCap, Hash, Pencil, Pin, Search, Settings2, Trash2 } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { useT } from '@/lib/i18n';
import { allTags, tagColor, useStore } from '@/lib/store';
import type { View } from '@/types';
import { openMenu, promptDialog } from './ui';
import { Explorer } from './Explorer';

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
  const live = useMemo(() => notes.filter((n) => !n.trashedAt && !n.template), [notes]);
  const templates = useMemo(() => notes.filter((n) => !n.trashedAt && n.template).length, [notes]);
  const tags = useMemo(() => allTags(notes), [notes]);
  const st = useStore.getState;

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
        <button data-tour="today" className="nav-item" onClick={() => void st().openDaily()} title={`${t('daily.open')} (${t('daily.key')})`}>
          <CalendarDays size={17} />
          <span className="name">{t('daily.today')}</span>
        </button>
        <NavItem tour="tasks" view={{ kind: 'tasks' }} label={t('tasks.title')} icon={<ListChecks size={17} />} />
        <NavItem tour="study" view={{ kind: 'study' }} label={t('study.title')} icon={<GraduationCap size={17} />} />
        <NavItem tour="graph" view={{ kind: 'graph' }} label={t('graph.title')} icon={<Waypoints size={17} />} />
        <NavItem view={{ kind: 'pinned' }} label={t('nav.pinned')} count={live.filter((n) => n.pinned).length} icon={<Pin size={17} />} drop={(id) => void st().patchNote(id, { pinned: true })} />

        <Explorer />

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

/** Arrastrar el borde derecho de la barra lateral para cambiar su ancho (se recuerda). */
export function SideResize() {
  const [active, setActive] = useState(false);
  return (
    <div
      className={`side-resize${active ? ' active' : ''}`}
      onPointerDown={(e) => {
        const app = (e.currentTarget.closest('.app') as HTMLElement) ?? null;
        if (!app) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setActive(true);
        const left = app.getBoundingClientRect().left;
        const move = (ev: PointerEvent) => {
          const w = Math.round(Math.min(460, Math.max(200, ev.clientX - left)));
          app.style.setProperty('--side-w', `${w}px`);
        };
        const up = () => {
          setActive(false);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          try {
            localStorage.setItem('filenote-side-w', getComputedStyle(app).getPropertyValue('--side-w').trim());
          } catch {}
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      onDoubleClick={(e) => {
        (e.currentTarget.closest('.app') as HTMLElement | null)?.style.removeProperty('--side-w');
        try {
          localStorage.removeItem('filenote-side-w');
        } catch {}
      }}
    />
  );
}
