import { ArrowLeft, Check, ChevronRight, FileText, GraduationCap, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderLatex } from '@/editor/math';
import { api, type DeckData, type StudyCard, type StudyData, type StudyDeck } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { uid, useStore } from '@/lib/store';
import { cardsIn, intervalLabel, isDue, schedule, type Grade } from '@/lib/study';
import { confirmDialog, promptDialog } from './ui';

const COLORS = ['#7B93FF', '#3CCB8A', '#F2B544', '#FF6B6B', '#B58CFF', '#4FC3D9'];

/** Tarjeta lista para repasar (de un mazo o de una nota). */
interface RCard {
  id: string;
  front: string;
  back: string;
  from: string;
}
interface Group {
  key: string;
  label: string;
  color: string;
  cards: RCard[];
  deck?: StudyDeck;
}

/** Texto con fórmulas ($…$, $$…$$) y saltos de línea. */
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

type Screen = { kind: 'home' } | { kind: 'deck'; id: string } | { kind: 'review'; group: Group; queue: RCard[]; done: number; total: number; round: number };

export function StudyPane() {
  const { t, lang } = useT();
  const notes = useStore((s) => s.notes);
  const [decks, setDecks] = useState<DeckData | null>(null);
  const [noteCards, setNoteCards] = useState<{ noteId: string; title: string; cards: RCard[] }[]>([]);
  const [srs, setSrs] = useState<StudyData>({});
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [flipped, setFlipped] = useState(false);
  const stamp = useMemo(() => notes.map((n) => `${n.id}:${n.updatedAt}:${n.trashedAt ?? ''}`).join('|'), [notes]);

  // Mazos y progreso de repaso.
  useEffect(() => {
    void (async () => {
      setDecks((await api.decks?.get()) ?? { decks: [], cards: [] });
      setSrs((await api.study?.get()) ?? {});
    })();
  }, []);
  // Tarjetas escritas dentro de las notas (siguen funcionando).
  useEffect(() => {
    let alive = true;
    void (async () => {
      await useStore.getState().flush();
      const live = useStore.getState().notes.filter((n) => !n.trashedAt && !n.template);
      const full = await Promise.all(live.map((m) => api.notes.get(m.id)));
      const out = full
        .map((n) => (n ? { noteId: n.id, title: n.title || t('app.untitled'), cards: cardsIn(n).map((c) => ({ id: c.id, front: c.front, back: c.back, from: n.title })) } : null))
        .filter((x): x is NonNullable<typeof x> => !!x && x.cards.length > 0);
      if (alive) setNoteCards(out);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  const saveDecks = (next: DeckData) => {
    setDecks(next);
    void api.decks?.save(next);
  };

  const now = Date.now();
  const groups = useMemo<Group[]>(() => {
    if (!decks) return [];
    return decks.decks.map((d) => ({ key: d.id, label: d.name, color: d.color, deck: d, cards: decks.cards.filter((c) => c.deckId === d.id).map((c) => ({ id: `d:${c.id}`, front: c.front, back: c.back, from: d.name })) }));
  }, [decks]);
  const noteGroups = useMemo<Group[]>(() => noteCards.map((n) => ({ key: `note:${n.noteId}`, label: n.title, color: 'var(--text-faint)', cards: n.cards })), [noteCards]);
  const allCards = [...groups, ...noteGroups].flatMap((g) => g.cards);
  const dueOf = (cs: RCard[]) => cs.filter((c) => isDue(srs[c.id], now)).length;

  const startReview = (group: Group, everything = false) => {
    const queue = group.cards.filter((c) => everything || isDue(srs[c.id], now)).sort((a, b) => (srs[a.id]?.due ?? 0) - (srs[b.id]?.due ?? 0));
    if (!queue.length) return;
    setFlipped(false);
    setScreen({ kind: 'review', group, queue, done: 0, total: queue.length, round: 0 });
  };

  const newDeck = async () => {
    const name = await promptDialog({ title: t('study.newDeck'), label: t('study.deckName'), ok: t('study.create') });
    if (!name?.trim() || !decks) return;
    const d: StudyDeck = { id: uid(), name: name.trim().slice(0, 80), color: COLORS[decks.decks.length % COLORS.length], createdAt: Date.now() };
    saveDecks({ ...decks, decks: [...decks.decks, d] });
    setScreen({ kind: 'deck', id: d.id });
  };

  const grade = useCallback(
    (g: Grade) => {
      if (screen.kind !== 'review' || !flipped) return;
      const card = screen.queue[0];
      const next = { ...srs, [card.id]: schedule(srs[card.id], g) };
      setSrs(next);
      void api.study?.save(next);
      const rest = screen.queue.slice(1);
      setFlipped(false);
      setScreen({ ...screen, queue: g === 0 ? [...rest, card] : rest, done: g === 0 ? screen.done : screen.done + 1, round: screen.round + 1 });
    },
    [screen, flipped, srs],
  );

  useEffect(() => {
    if (screen.kind !== 'review') return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA'].includes(el.tagName)) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (screen.queue.length) setFlipped((f) => !f);
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) grade((Number(e.key) - 1) as Grade);
      else if (e.key === 'Escape') setScreen({ kind: 'home' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, flipped, grade]);

  /* ───────── Repaso con la tarjeta que se voltea ───────── */
  if (screen.kind === 'review') {
    const card = screen.queue[0];
    const pct = Math.round((screen.done / screen.total) * 100);
    return (
      <section className="wide-pane study-pane">
        <div className="wide-head drag">
          <button className="icon-btn no-drag" aria-label={t('tour.back')} title={`${t('tour.back')} (Esc)`} onClick={() => setScreen({ kind: 'home' })}>
            <ArrowLeft size={18} />
          </button>
          <div className="wide-title">
            <span>{screen.group.label}</span>
            <span className="wide-sub tabular">{t('study.progress', { n: screen.done, total: screen.total })}</span>
          </div>
        </div>
        <div className="study-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="wide-scroll study-stage">
          {card ? (
            <div className="review">
              <div key={`${card.id}:${screen.round}`} className="flip-scene">
                <button className={`flip-card${flipped ? ' flipped' : ''}`} onClick={() => setFlipped((f) => !f)} aria-label={flipped ? t('study.answer') : t('study.question')} aria-live="polite">
                  <div className="face front">
                    <span className="face-tag">{t('study.question')}</span>
                    <div className="face-body big">
                      <Rich text={card.front} />
                    </div>
                    <span className="face-hint">{t('study.flipHint')}</span>
                  </div>
                  <div className="face back">
                    <span className="face-tag">{t('study.answer')}</span>
                    <div className="face-q">
                      <Rich text={card.front} />
                    </div>
                    <div className="face-body">
                      <Rich text={card.back} />
                    </div>
                  </div>
                </button>
              </div>
              <div className={`grades${flipped ? ' show' : ''}`}>
                {([0, 1, 2, 3] as Grade[]).map((g) => (
                  <button key={g} className={`grade g${g}`} tabIndex={flipped ? 0 : -1} onClick={() => grade(g)}>
                    <b>{t(`study.g${g}` as 'study.g0')}</b>
                    <small className="tabular">{intervalLabel(schedule(srs[card.id], g, now), now, lang)}</small>
                    <kbd>{g + 1}</kbd>
                  </button>
                ))}
              </div>
              {!flipped ? (
                <button className="btn btn-primary flip-btn" onClick={() => setFlipped(true)}>
                  <RotateCcw size={15} /> {t('study.flip')} <kbd>{t('study.space')}</kbd>
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flash done fade-in">
              <div className="done-ico">
                <Check size={30} />
              </div>
              <h2>{t('study.doneT')}</h2>
              <p>{t('study.doneB', { n: screen.total })}</p>
              <button className="btn btn-primary" onClick={() => setScreen({ kind: 'home' })}>
                {t('study.backDecks')}
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  /* ───────── Editor de un mazo ───────── */
  const openDeck = screen.kind === 'deck' && decks ? decks.decks.find((d) => d.id === screen.id) : undefined;
  if (openDeck && decks) {
    const deck = openDeck;
    const group = groups.find((g) => g.key === deck.id)!;
    return (
      <DeckEditor
        deck={deck}
        cards={decks.cards.filter((c) => c.deckId === deck.id)}
        due={dueOf(group.cards)}
        onBack={() => setScreen({ kind: 'home' })}
        onReview={() => startReview(group, !dueOf(group.cards))}
        onChange={(d, cards) => saveDecks({ decks: decks.decks.map((x) => (x.id === d.id ? d : x)), cards: [...decks.cards.filter((c) => c.deckId !== d.id), ...cards] })}
        onDelete={async () => {
          if (!(await confirmDialog({ title: t('study.deleteDeckT', { name: deck.name }), body: t('study.deleteDeckB'), ok: t('dlg.delete'), danger: true }))) return;
          saveDecks({ decks: decks.decks.filter((x) => x.id !== deck.id), cards: decks.cards.filter((c) => c.deckId !== deck.id) });
          setScreen({ kind: 'home' });
        }}
      />
    );
  }

  /* ───────── Inicio: mazos ───────── */
  const totalDue = dueOf(allCards);
  const everything: Group = { key: 'all', label: t('study.all'), color: 'var(--accent)', cards: allCards };
  return (
    <section className="wide-pane study-pane">
      <div className="wide-head drag">
        <div className="wide-title">
          <GraduationCap size={20} />
          <span>{t('study.title')}</span>
          {allCards.length ? <span className="wide-sub tabular">{t('study.count', { n: allCards.length })}</span> : null}
        </div>
        {totalDue ? (
          <button className="btn btn-soft btn-sm no-drag" onClick={() => startReview(everything)}>
            {t('study.reviewAll', { n: totalDue })}
          </button>
        ) : null}
        <button className="btn btn-primary btn-sm no-drag" onClick={() => void newDeck()}>
          <Plus size={15} /> {t('study.newDeck')}
        </button>
      </div>
      <div className="wide-scroll">
        {decks === null ? null : !groups.length && !noteGroups.length ? (
          <div className="empty">
            <div style={{ maxWidth: 420 }}>
              <div className="study-empty-art" aria-hidden>
                <i />
                <i />
                <i />
              </div>
              <h3>{t('study.emptyT')}</h3>
              <div>{t('study.emptyB2')}</div>
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => void newDeck()}>
                <Plus size={16} /> {t('study.firstDeck')}
              </button>
            </div>
          </div>
        ) : (
          <div className="decks-wrap">
            {groups.length ? (
              <div className="deck-grid">
                {groups.map((g, i) => {
                  const due = dueOf(g.cards);
                  return (
                    <div key={g.key} className="deck-tile" style={{ ['--deck' as string]: g.color, animationDelay: `${i * 40}ms` }} onClick={() => setScreen({ kind: 'deck', id: g.key })} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setScreen({ kind: 'deck', id: g.key })}>
                      <div className="deck-stack" aria-hidden>
                        <i />
                        <i />
                      </div>
                      <b className="dt-name">{g.label}</b>
                      <small className="tabular">{t(g.cards.length === 1 ? 'study.card1' : 'study.cards', { n: g.cards.length })}</small>
                      <div className="dt-foot">
                        {due ? <span className="dt-due tabular">{t('study.dueToday', { n: due })}</span> : <span className="dt-ok">{g.cards.length ? t('study.upToDate') : t('study.noCards')}</span>}
                        {g.cards.length ? (
                          <button
                            className={`btn btn-sm ${due ? 'btn-primary' : 'btn-soft'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              startReview(g, !due);
                            }}
                          >
                            {due ? t('study.study') : t('study.cram')}
                          </button>
                        ) : (
                          <span className="dt-add">
                            <Plus size={14} /> {t('study.addCards')}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <button className="deck-tile new" onClick={() => void newDeck()}>
                  <Plus size={22} />
                  <span>{t('study.newDeck')}</span>
                </button>
              </div>
            ) : null}
            {noteGroups.length ? (
              <>
                <div className="label" style={{ margin: '26px 4px 10px' }}>
                  {t('study.fromNotes')}
                </div>
                <div className="decks">
                  {noteGroups.map((g) => {
                    const due = dueOf(g.cards);
                    return (
                      <div key={g.key} className="deck">
                        <div className="deck-ico">
                          <FileText size={18} />
                        </div>
                        <div className="deck-text">
                          <b>{g.label}</b>
                          <small className="tabular">{t(g.cards.length === 1 ? 'study.card1' : 'study.cards', { n: g.cards.length })}</small>
                        </div>
                        <button className={`btn btn-sm ${due ? 'btn-primary' : 'btn-soft'}`} onClick={() => startReview(g, !due)}>
                          {due ? t('study.review', { n: due }) : t('study.cram')} <ChevronRight size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

/** Crear y editar las tarjetas de un mazo: pregunta y respuesta, como dos caras de una tarjeta. */
function DeckEditor({ deck, cards, due, onBack, onReview, onChange, onDelete }: { deck: StudyDeck; cards: StudyCard[]; due: number; onBack: () => void; onReview: () => void; onChange: (d: StudyDeck, cards: StudyCard[]) => void; onDelete: () => void }) {
  const { t } = useT();
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState(deck.name);
  const [peek, setPeek] = useState(false);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setName(deck.name), [deck.name]);

  const ready = front.trim() && back.trim();
  const save = () => {
    if (!ready) return;
    const list = editing ? cards.map((c) => (c.id === editing ? { ...c, front: front.trim(), back: back.trim() } : c)) : [...cards, { id: uid(), deckId: deck.id, front: front.trim(), back: back.trim(), createdAt: Date.now() }];
    onChange(deck, list);
    setFront('');
    setBack('');
    setEditing(null);
    setPeek(false);
    frontRef.current?.focus();
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <section className="wide-pane study-pane">
      <div className="wide-head drag">
        <button className="icon-btn no-drag" aria-label={t('tour.back')} title={t('tour.back')} onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <span className="deck-dot" style={{ background: deck.color }} />
        <input className="deck-name no-drag" value={name} aria-label={t('study.deckName')} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== deck.name && onChange({ ...deck, name: name.trim().slice(0, 80) }, cards)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <div className="deck-colors no-drag">
          {COLORS.map((c) => (
            <button key={c} className={`deck-color${deck.color === c ? ' on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => onChange({ ...deck, color: c }, cards)} />
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button className="icon-btn no-drag" title={t('study.deleteDeck')} aria-label={t('study.deleteDeck')} onClick={onDelete}>
          <Trash2 size={16} />
        </button>
        {cards.length ? (
          <button className="btn btn-primary btn-sm no-drag" onClick={onReview}>
            <GraduationCap size={15} /> {due ? t('study.review', { n: due }) : t('study.cram')}
          </button>
        ) : null}
      </div>
      <div className="wide-scroll">
        <div className="deck-editor">
          {/* Nueva tarjeta: dos caras */}
          <div className={`composer${editing ? ' editing' : ''}`}>
            <div className="composer-head">
              <b>{editing ? t('study.editCard') : t('study.newCard')}</b>
              <span className="faint">{t('study.mathHint')}</span>
            </div>
            <div className="composer-faces">
              <label className="cface">
                <span className="cface-tag">{t('study.question')}</span>
                <textarea ref={frontRef} autoFocus value={front} onChange={(e) => setFront(e.target.value)} onKeyDown={keys} placeholder={t('study.qPh')} rows={4} />
              </label>
              <label className="cface back">
                <span className="cface-tag">{t('study.answer')}</span>
                <textarea value={back} onChange={(e) => setBack(e.target.value)} onKeyDown={keys} placeholder={t('study.aPh')} rows={4} />
              </label>
            </div>
            <div className="composer-foot">
              {ready ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setPeek((p) => !p)}>
                  <RotateCcw size={14} /> {t('study.preview')}
                </button>
              ) : null}
              <span style={{ flex: 1 }} />
              {editing ? (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditing(null);
                    setFront('');
                    setBack('');
                  }}
                >
                  {t('dlg.cancel')}
                </button>
              ) : null}
              <button className="btn btn-primary btn-sm" disabled={!ready} onClick={save}>
                {editing ? <Check size={15} /> : <Plus size={15} />} {editing ? t('dlg.save') : t('study.addCard')} <kbd>Ctrl+Enter</kbd>
              </button>
            </div>
            {peek && ready ? (
              <div className="flip-scene small">
                <PreviewCard front={front} back={back} />
              </div>
            ) : null}
          </div>

          {/* Tarjetas del mazo */}
          <div className="label" style={{ margin: '22px 4px 10px' }}>
            {t(cards.length === 1 ? 'study.card1' : 'study.cards', { n: cards.length })}
          </div>
          {!cards.length ? <p className="set-hint" style={{ padding: '0 4px' }}>{t('study.noCardsYet')}</p> : null}
          <div className="card-list">
            {[...cards].reverse().map((c) => (
              <div key={c.id} className={`card-row${editing === c.id ? ' on' : ''}`}>
                <div className="cr-q">
                  <Rich text={c.front} />
                </div>
                <div className="cr-a">
                  <Rich text={c.back} />
                </div>
                <div className="cr-actions">
                  <button
                    className="icon-btn"
                    title={t('study.editCard')}
                    aria-label={t('study.editCard')}
                    onClick={() => {
                      setEditing(c.id);
                      setFront(c.front);
                      setBack(c.back);
                      frontRef.current?.focus();
                      frontRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button className="icon-btn" title={t('dlg.delete')} aria-label={t('dlg.delete')} onClick={() => onChange(deck, cards.filter((x) => x.id !== c.id))}>
                    <X size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Vista previa en el editor: la misma tarjeta que se voltea al hacer clic. */
function PreviewCard({ front, back }: { front: string; back: string }) {
  const { t } = useT();
  const [f, setF] = useState(false);
  return (
    <button className={`flip-card${f ? ' flipped' : ''}`} onClick={() => setF((x) => !x)}>
      <div className="face front">
        <span className="face-tag">{t('study.question')}</span>
        <div className="face-body big">
          <Rich text={front} />
        </div>
        <span className="face-hint">{t('study.flipHint')}</span>
      </div>
      <div className="face back">
        <span className="face-tag">{t('study.answer')}</span>
        <div className="face-body">
          <Rich text={back} />
        </div>
      </div>
    </button>
  );
}

