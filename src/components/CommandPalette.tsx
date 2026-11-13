import MiniSearch from 'minisearch';
import { FilePlus2, FileText, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { relTime, useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import type { NoteMeta } from '@/types';

/** Quita acentos para buscar «cancion» y encontrar «canción». */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Resalta las palabras buscadas dentro de un fragmento. */
function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text;
  const f = fold(text);
  const marks: [number, number][] = [];
  for (const term of terms) {
    let i = f.indexOf(term);
    while (i !== -1 && marks.length < 20) {
      marks.push([i, i + term.length]);
      i = f.indexOf(term, i + term.length);
    }
  }
  if (!marks.length) return text;
  marks.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let last = 0;
  marks.forEach(([a, b], k) => {
    if (a < last) return;
    out.push(text.slice(last, a), <mark key={k}>{text.slice(a, b)}</mark>);
    last = b;
  });
  out.push(text.slice(last));
  return out;
}

/** Fragmento del texto alrededor de la primera coincidencia. */
function snippet(text: string, terms: string[]): string {
  const f = fold(text);
  const at = Math.min(...terms.map((t) => f.indexOf(t)).filter((i) => i >= 0), Infinity);
  if (!Number.isFinite(at)) return text.slice(0, 160);
  const start = Math.max(0, at - 60);
  return (start ? '…' : '') + text.slice(start, start + 180).replace(/\s+/g, ' ');
}

/** Ctrl+K: busca en títulos, texto y etiquetas de todas las notas (con errores de tecleo y sin acentos). */
export function CommandPalette() {
  const { t, lang } = useT();
  const open = useStore((s) => s.paletteOpen);
  const notes = useStore((s) => s.notes);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const index = useMemo(() => {
    if (!open) return null;
    const ms = new MiniSearch<NoteMeta>({
      fields: ['title', 'text', 'tagsText'],
      storeFields: ['id'],
      processTerm: (term) => fold(term),
      extractField: (doc, field) => (field === 'tagsText' ? doc.tags.join(' ') : (doc as unknown as Record<string, string>)[field]),
      searchOptions: { boost: { title: 3, tagsText: 2 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
    });
    ms.addAll(notes.filter((n) => !n.trashedAt));
    return ms;
  }, [open, notes]);

  const terms = useMemo(() => fold(q).split(/\s+/).filter(Boolean), [q]);
  const results = useMemo(() => {
    const live = notes.filter((n) => !n.trashedAt);
    if (!q.trim() || !index) return [...live].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
    const byId = new Map(live.map((n) => [n.id, n]));
    return index
      .search(q)
      .slice(0, 30)
      .map((r) => byId.get(r.id as string))
      .filter((n): n is NoteMeta => !!n);
  }, [q, index, notes]);
  const canCreate = q.trim().length > 0 && !results.some((r) => r.title.trim().toLowerCase() === q.trim().toLowerCase());
  const total = results.length + (canCreate ? 1 : 0);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
    }
  }, [open]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;
  const close = () => useStore.getState().setPalette(false);
  const choose = async (i: number) => {
    close();
    const st = useStore.getState();
    if (i < results.length) {
      if (st.view.kind === 'trash') st.setView({ kind: 'all' });
      await st.select(results[i].id);
    } else await st.createNote({ title: q.trim() });
  };

  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label={t('nav.search')}>
        <div className="palette-input">
          <Search size={20} color="var(--text-faint)" />
          <input
            autoFocus
            placeholder={t('pal.ph')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              else if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(total - 1, s + 1)));
              else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
              else if (e.key === 'Enter' && total) (e.preventDefault(), void choose(sel));
            }}
            aria-label={t('pal.ph')}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {total === 0 ? <div className="menu-empty">{t('pal.none')}</div> : null}
          {results.map((n, i) => (
            <button key={n.id} className={`palette-item${i === sel ? ' on' : ''}`} onMouseMove={() => setSel(i)} onClick={() => void choose(i)}>
              <FileText size={18} color="var(--text-faint)" style={{ flex: 'none', marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t">{highlight(n.title || t('app.untitled'), terms)}</div>
                {n.text.trim() ? <div className="s">{highlight(snippet(n.text, terms), terms)}</div> : null}
              </div>
              <span className="faint tabular" style={{ fontSize: 12, flex: 'none' }}>
                {relTime(n.updatedAt, lang)}
              </span>
            </button>
          ))}
          {canCreate ? (
            <button className={`palette-item${sel === results.length ? ' on' : ''}`} onMouseMove={() => setSel(results.length)} onClick={() => void choose(results.length)}>
              <FilePlus2 size={18} color="var(--accent)" style={{ flex: 'none', marginTop: 2 }} />
              <div className="t">{t('pal.create', { q: q.trim() })}</div>
            </button>
          ) : null}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> {t('pal.move')}
          </span>
          <span>
            <kbd>Enter</kbd> {t('pal.open')}
          </span>
          <span>
            <kbd>Esc</kbd> {t('pal.close')}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
