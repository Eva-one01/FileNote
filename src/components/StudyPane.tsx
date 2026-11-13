import { ArrowLeft, Check, ChevronRight, GraduationCap, Layers, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { renderLatex } from '@/editor/math';
import { api, type StudyData } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { tagColor, useStore } from '@/lib/store';
import { cardsIn, intervalLabel, isDue, schedule, type Card, type Grade } from '@/lib/study';

/** Texto de la tarjeta con fórmulas ($…$, $$…$$) y saltos de línea. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\$\$[^$]+\$\$|\$[^$\n]+\$)/);
  return (
    <>
      {parts.map((p, i) => {
        const block = /^\$\$[^$]+\$\$$/.test(p);
        const inl = !block && /^\$[^$\n]+\$$/.test(p);
        if (block || inl) {
          const html = renderLatex(p.slice(block ? 2 : 1, block ? -2 : -1), block);
          if (html) return <span key={i} className={block ? 'card-math-block' : ''} dangerouslySetInnerHTML={{ __html: html }} />;
        }
        return (
          <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {p}
          </span>
        );
      })}
    </>
  );
}

interface Deck {
  key: string;
  label: string;
  kind: 'all' | 'tag' | 'note';
  color?: string;
  cards: Card[];
}

/** Estudiar: mazos (todas, por etiqueta y por nota) y sesiones de repaso. */
export function StudyPane() {
  const { t, lang } = useT();
  const notes = useStore((s) => s.notes);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [data, setData] = useState<StudyData>({});
  const [session, setSession] = useState<{ deck: Deck; queue: Card[]; done: number; total: number; again: number } | null>(null);
  const [shown, setShown] = useState(false);
  const stamp = useMemo(() => notes.map((n) => `${n.id}:${n.updatedAt}:${n.trashedAt ?? ''}`).join('|'), [notes]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await useStore.getState().flush();
      const live = useStore.getState().notes.filter((n) => !n.trashedAt && !n.template);
      const full = await Promise.all(live.map((m) => api.notes.get(m.id)));
      const all = full.flatMap((n) => (n ? cardsIn(n) : []));
      const d = (await api.study?.get()) ?? {};
      if (alive) {
        setCards(all);
        setData(d);
      }
    })();
    return () => {
      alive = false;
    };
  }, [stamp]);

  const now = Date.now();
  const decks = useMemo<Deck[]>(() => {
    if (!cards) return [];
    const out: Deck[] = [{ key: 'all', label: t('study.all'), kind: 'all', cards }];
    const tags = new Map<string, Card[]>();
    const byNote = new Map<string, Card[]>();
    for (const c of cards) {
      for (const tg of c.tags) tags.set(tg, [...(tags.get(tg) ?? []), c]);
      byNote.set(c.noteId, [...(byNote.get(c.noteId) ?? []), c]);
    }
    for (const [tg, cs] of [...tags].sort((a, b) => a[0].localeCompare(b[0]))) out.push({ key: `tag:${tg}`, label: `#${tg}`, kind: 'tag', color: tagColor(tg), cards: cs });
    for (const [, cs] of byNote) out.push({ key: `note:${cs[0].noteId}`, label: cs[0].noteTitle || t('app.untitled'), kind: 'note', cards: cs });
    return out;
  }, [cards, t]);

  const start = (deck: Deck, everything = false) => {
    const due = deck.cards.filter((c) => everything || isDue(data[c.id], now)).sort((a, b) => (data[a.id]?.due ?? 0) - (data[b.id]?.due ?? 0));
    if (!due.length) return;
    setShown(false);
    setSession({ deck, queue: due, done: 0, total: due.length, again: 0 });
  };

  const grade = useCallback(
    (g: Grade) => {
      if (!session || !shown) return;
      const card = session.queue[0];
      const next = { ...data, [card.id]: schedule(data[card.id], g) };
      setData(next);
      void api.study?.save(next);
      const rest = session.queue.slice(1);
      // «Otra vez»: vuelve al final de esta misma sesión.
      setSession({ ...session, queue: g === 0 ? [...rest, card] : rest, done: g === 0 ? session.done : session.done + 1, again: session.again + (g === 0 ? 1 : 0) });
      setShown(false);
    },
    [session, shown, data],
  );

  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA'].includes(el.tagName)) return;
      if (!shown && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ['1', '2', '3', '4'].includes(e.key)) grade((Number(e.key) - 1) as Grade);
      else if (e.key === 'Escape') setSession(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, shown, grade]);

  /* ───────── Sesión de repaso ───────── */
  if (session) {
    const card = session.queue[0];
    const pct = Math.round((session.done / session.total) * 100);
    return (
      <section className="wide-pane study-pane">
        <div className="wide-head drag">
          <button className="icon-btn no-drag" aria-label={t('tour.back')} title={`${t('tour.back')} (Esc)`} onClick={() => setSession(null)}>
            <ArrowLeft size={18} />
          </button>
          <div className="wide-title">
            <span>{session.deck.label}</span>
            <span className="wide-sub tabular">{t('study.progress', { n: session.done, total: session.total })}</span>
          </div>
        </div>
        <div className="study-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="wide-scroll study-stage">
          {card ? (
            <div key={`${card.id}:${session.done}:${session.again}`} className={`flash${shown ? ' flipped' : ''}`}>
              <div className="flash-from">{card.noteTitle}</div>
              <div className="flash-front">
                <Rich text={card.front} />
              </div>
              {shown ? (
                <div className="flash-back fade-in">
                  <Rich text={card.back} />
                </div>
              ) : null}
              <div className="flash-actions">
                {!shown ? (
                  <button className="btn btn-primary" onClick={() => setShown(true)} autoFocus>
                    {t('study.show')} <kbd>{t('study.space')}</kbd>
                  </button>
                ) : (
                  ([0, 1, 2, 3] as Grade[]).map((g) => (
                    <button key={g} className={`grade g${g}`} onClick={() => grade(g)}>
                      <b>{t(`study.g${g}` as 'study.g0')}</b>
                      <small className="tabular">{intervalLabel(schedule(data[card.id], g, now), now, lang)}</small>
                      <kbd>{g + 1}</kbd>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flash done fade-in">
              <div className="done-ico">
                <Check size={30} />
              </div>
              <h2>{t('study.doneT')}</h2>
              <p>{t('study.doneB', { n: session.total })}</p>
              <button className="btn btn-primary" onClick={() => setSession(null)}>
                {t('study.backDecks')}
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  /* ───────── Mazos ───────── */
  const total = cards?.length ?? 0;
  return (
    <section className="wide-pane study-pane">
      <div className="wide-head drag">
        <div className="wide-title">
          <GraduationCap size={20} />
          <span>{t('study.title')}</span>
          {total ? <span className="wide-sub tabular">{t('study.count', { n: total })}</span> : null}
        </div>
      </div>
      <div className="wide-scroll">
        {cards === null ? null : !total ? (
          <div className="empty">
            <div style={{ maxWidth: 440 }}>
              <Layers size={34} color="var(--text-faint)" />
              <h3>{t('study.emptyT')}</h3>
              <div>{t('study.emptyB')}</div>
              <pre className="study-example">{t('study.example')}</pre>
            </div>
          </div>
        ) : (
          <div className="decks">
            {decks.map((d) => {
              const due = d.cards.filter((c) => isDue(data[c.id], now)).length;
              const fresh = d.cards.filter((c) => !data[c.id]).length;
              return (
                <div key={d.key} className={`deck fade-in${d.kind === 'all' ? ' main' : ''}`}>
                  <div className="deck-ico" style={d.color ? { color: d.color } : undefined}>
                    {d.kind === 'all' ? <Layers size={20} /> : d.kind === 'tag' ? <span className="deck-hash">#</span> : <GraduationCap size={18} />}
                  </div>
                  <div className="deck-text">
                    <b>{d.label}</b>
                    <small className="tabular">
                      {t('study.deckInfo', { n: d.cards.length, f: fresh })}
                    </small>
                  </div>
                  {due ? (
                    <button className="btn btn-primary btn-sm" onClick={() => start(d)}>
                      {t('study.review', { n: due })} <ChevronRight size={15} />
                    </button>
                  ) : (
                    <button className="btn btn-soft btn-sm" title={t('study.cramHint')} onClick={() => start(d, true)}>
                      <RotateCcw size={14} /> {t('study.cram')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
