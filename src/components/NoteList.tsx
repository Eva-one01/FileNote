import { ArrowDownUp, Pin, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { relTime, useT } from '@/lib/i18n';
import { sortNotes, tagColor, useStore, visibleNotes } from '@/lib/store';
import type { SortBy } from '@/types';
import { noteMenu } from './NoteEditor';
import { confirmDialog, openMenu, openMenuAt } from './ui';

export function NoteList() {
  const { t, lang } = useT();
  const notes = useStore((s) => s.notes);
  const folders = useStore((s) => s.folders);
  const view = useStore((s) => s.view);
  const sort = useStore((s) => s.settings.sort);
  const selectedId = useStore((s) => s.selectedId);
  const [q, setQ] = useState('');
  const list = useMemo(() => sortNotes(visibleNotes(notes, view, q, folders), sort), [notes, view, q, folders, sort]);

  const title =
    view.kind === 'all'
      ? t('nav.all')
      : view.kind === 'pinned'
        ? t('nav.pinned')
        : view.kind === 'trash'
          ? t('nav.trash')
          : view.kind === 'tag'
            ? `#${view.tag}`
            : (folders.find((f) => f.id === view.id)?.name ?? '');

  const sortMenu = (el: HTMLElement) =>
    openMenuAt(
      el,
      (['updated', 'created', 'title'] as SortBy[]).map((s) => ({ label: t(`sort.${s}`), checked: sort === s, onClick: () => useStore.getState().setSettings({ sort: s }) })),
      'right',
    );

  return (
    <section className="list">
      <div className="list-head drag">
        <div className="list-title">{title}</div>
        <div className="no-drag" style={{ display: 'flex', gap: 2 }}>
          {view.kind === 'trash' ? (
            list.length ? (
              <button
                className="btn btn-danger no-drag"
                style={{ height: 30, padding: '0 12px' }}
                onClick={async () => {
                  if (await confirmDialog({ title: t('dlg.emptyTrashT'), body: t('dlg.emptyTrashB', { n: list.length }), ok: t('dlg.delete'), danger: true })) await useStore.getState().emptyTrash();
                }}
              >
                {t('list.emptyTrash')}
              </button>
            ) : null
          ) : (
            <>
              <button className="icon-btn" title={t('list.sort')} aria-label={t('list.sort')} onClick={(e) => sortMenu(e.currentTarget)}>
                <ArrowDownUp size={17} />
              </button>
              <button className="icon-btn on" title={`${t('list.new')} (Ctrl+N)`} aria-label={t('list.new')} onClick={() => void useStore.getState().createNote()}>
                <Plus size={19} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="list-search" style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 11, top: 12, color: 'var(--text-faint)' }} />
        <input className="input" style={{ height: 38, paddingLeft: 32 }} placeholder={t('list.search')} aria-label={t('list.search')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
      </div>
      <div className="list-scroll" role="listbox" aria-label={title}>
        {list.length === 0 ? (
          <div className="empty">
            <div>
              {view.kind === 'trash' ? <Trash2 size={30} color="var(--text-faint)" /> : null}
              <h3>{q ? t('pal.none') : view.kind === 'trash' ? t('list.trashEmptyT') : t('list.emptyT')}</h3>
              <div>{q ? t('list.noMatch', { q }) : view.kind === 'trash' ? t('list.trashNote') : t('list.emptyB')}</div>
            </div>
          </div>
        ) : (
          <>
            {view.kind === 'trash' ? (
              <div className="faint" style={{ padding: '0 8px 8px', fontSize: 12.5 }}>
                {t('list.trashNote')}
              </div>
            ) : null}
            {list.map((n) => (
              <button
                key={n.id}
                role="option"
                aria-selected={n.id === selectedId}
                className={`note-card${n.id === selectedId ? ' on' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-filenote-note', n.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => void useStore.getState().select(n.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (n.trashedAt) return;
                  openMenu(e.clientX, e.clientY, noteMenu(n, t));
                }}
              >
                <div className="t">
                  {n.pinned ? <Pin size={13} color="var(--accent)" style={{ flex: 'none' }} /> : null}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title || t('app.untitled')}</span>
                </div>
                {n.text.trim() ? <div className="s">{n.text.slice(0, 220)}</div> : null}
                <div className="m tabular">
                  <span>{relTime(n.updatedAt, lang)}</span>
                  {n.tags.slice(0, 3).map((tag) => (
                    <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span className="tag-dot" style={{ background: tagColor(tag), width: 6, height: 6 }} />
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
