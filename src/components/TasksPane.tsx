import { CheckCircle2, ChevronRight, ListChecks, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { api } from '@/lib/api';
import { relTime, useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { setTaskChecked, tasksIn, type TaskRef } from '@/lib/tasks';

type Filter = 'open' | 'done' | 'all';
interface Group {
  id: string;
  title: string;
  folder: string | null;
  updatedAt: number;
  content: JSONContent;
  tasks: TaskRef[];
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Todas las casillas de todas las notas en un solo sitio. */
export function TasksPane() {
  const { t, lang } = useT();
  const notes = useStore((s) => s.notes);
  const folders = useStore((s) => s.folders);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [q, setQ] = useState('');
  // Se recarga solo cuando cambia alguna nota (no en cada render).
  const stamp = useMemo(() => notes.map((n) => `${n.id}:${n.updatedAt}:${n.trashedAt ?? ''}`).join('|'), [notes]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await useStore.getState().flush();
      const live = useStore.getState().notes.filter((n) => !n.trashedAt && !n.template);
      const full = await Promise.all(live.map((m) => api.notes.get(m.id)));
      const fname = (id: string | null) => (id ? (useStore.getState().folders.find((f) => f.id === id)?.name ?? null) : null);
      const out: Group[] = [];
      for (const n of full) {
        if (!n) continue;
        const tasks = tasksIn(n.content);
        if (tasks.length) out.push({ id: n.id, title: n.title, folder: fname(n.folderId), updatedAt: n.updatedAt, content: n.content, tasks });
      }
      out.sort((a, b) => b.updatedAt - a.updatedAt);
      if (alive) setGroups(out);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, folders]);

  const toggle = async (g: Group, task: TaskRef) => {
    const content = setTaskChecked(g.content, task.index, !task.checked);
    // Cambio inmediato en pantalla; se guarda detrás.
    setGroups((gs) => gs?.map((x) => (x.id === g.id ? { ...x, content, tasks: x.tasks.map((y) => (y.index === task.index ? { ...y, checked: !y.checked } : y)) } : x)) ?? null);
    await useStore.getState().saveContent(g.id, content);
  };

  const fq = fold(q.trim());
  const shown = (groups ?? [])
    .map((g) => ({ ...g, visible: g.tasks.filter((x) => (filter === 'all' || (filter === 'open' ? !x.checked : x.checked)) && x.text && (!fq || fold(`${x.text} ${g.title}`).includes(fq))) }))
    .filter((g) => g.visible.length);
  const all = (groups ?? []).flatMap((g) => g.tasks.filter((x) => x.text));
  const open = all.filter((x) => !x.checked).length;

  return (
    <section className="wide-pane tasks-pane">
      <div className="wide-head drag">
        <div className="wide-title">
          <ListChecks size={20} />
          <span>{t('tasks.title')}</span>
        </div>
        <div className="seg no-drag" role="radiogroup" aria-label={t('tasks.title')}>
          {(['open', 'done', 'all'] as Filter[]).map((f) => (
            <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {t(`tasks.${f}`)}
              {f === 'open' ? <span className="seg-n tabular">{open}</span> : f === 'done' ? <span className="seg-n tabular">{all.length - open}</span> : null}
            </button>
          ))}
        </div>
        <div className="wide-search no-drag">
          <Search size={15} />
          <input className="input" placeholder={t('tasks.search')} aria-label={t('tasks.search')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
        </div>
      </div>
      <div className="wide-scroll">
        {groups === null ? null : shown.length === 0 ? (
          <div className="empty">
            <div>
              <CheckCircle2 size={34} color="var(--text-faint)" />
              <h3>{q ? t('pal.none') : filter === 'open' && all.length ? t('tasks.allDoneT') : t('tasks.emptyT')}</h3>
              <div>{q ? t('list.noMatch', { q }) : filter === 'open' && all.length ? t('tasks.allDoneB') : t('tasks.emptyB')}</div>
            </div>
          </div>
        ) : (
          <div className="task-groups">
            {shown.map((g) => (
              <div key={g.id} className="task-group fade-in">
                <button className="tg-head" onClick={() => void useStore.getState().select(g.id)} title={t('tasks.openNote')}>
                  <span className="tg-title">{g.title || t('app.untitled')}</span>
                  <span className="tg-meta">
                    {g.folder ? `${g.folder} · ` : ''}
                    {relTime(g.updatedAt, lang)}
                  </span>
                  <ChevronRight size={15} className="tg-go" />
                </button>
                {g.visible.map((x) => (
                  <label key={x.index} className={`task-row${x.checked ? ' done' : ''}`} style={{ paddingLeft: 12 + x.depth * 22 }}>
                    <input type="checkbox" checked={x.checked} onChange={() => void toggle(g, x)} />
                    <span>{x.text}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
