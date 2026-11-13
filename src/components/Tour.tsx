import { ArrowLeft, ArrowRight, Briefcase, Check, Compass, GraduationCap, Home } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isDesktop } from '@/lib/api';
import { useT, type Key } from '@/lib/i18n';
import { setupStarter, type Persona } from '@/lib/onboarding';
import { useStore } from '@/lib/store';
import { Logo } from './Sidebar';

interface Step {
  id: string;
  /** Elemento a resaltar ([data-tour="…"]); sin él la tarjeta va centrada. */
  target?: string;
  title: Key;
  body: Key;
  /** Tecla o atajo que se muestra en la tarjeta. */
  key?: string;
}

const STEPS: Step[] = [
  { id: 'new', target: 'new', title: 'tour.newT', body: 'tour.newB', key: 'Ctrl+N' },
  { id: 'editor', target: 'editor', title: 'tour.slashT', body: 'tour.slashB', key: '/' },
  { id: 'links', target: 'editor', title: 'tour.linkT', body: 'tour.linkB', key: '[[' },
  { id: 'toolbar', target: 'toolbar', title: 'tour.toolbarT', body: 'tour.toolbarB' },
  { id: 'search', target: 'search', title: 'tour.searchT', body: 'tour.searchB', key: 'Ctrl+K' },
  { id: 'today', target: 'today', title: 'tour.todayT', body: 'tour.todayB', key: 'Ctrl+Shift+J' },
  { id: 'templates', target: 'templates', title: 'tour.tplT', body: 'tour.tplB' },
  { id: 'capture', target: 'settings', title: 'tour.capT', body: 'tour.capB', key: 'Ctrl+Alt+N' },
  { id: 'done', title: 'tour.doneT', body: 'tour.doneB' },
];

const PAD = 8;
const CARD_W = 340;

function useRect(selector: string | undefined, dep: unknown) {
  const [r, setR] = useState<DOMRect | null>(null);
  const measure = useCallback(() => {
    const el = selector ? (document.querySelector(`[data-tour="${selector}"]`) as HTMLElement | null) : null;
    if (!el) return setR(null);
    let b = el.getBoundingClientRect();
    // Solo se desplaza si el elemento no se ve en absoluto.
    if (b.bottom < 0 || b.top > window.innerHeight) {
      el.scrollIntoView({ block: 'nearest' });
      b = el.getBoundingClientRect();
    }
    // El editor puede ser muy alto: se resalta solo su parte visible.
    setR(new DOMRect(b.left, b.top, b.width, Math.min(b.height, Math.max(120, window.innerHeight * 0.32))));
  }, [selector]);
  useLayoutEffect(() => {
    measure();
    const id = setTimeout(measure, 60);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(id);
      window.removeEventListener('resize', measure);
    };
  }, [measure, dep]);
  return r;
}

/** Elección inicial: para qué vas a usar FileNote (prepara carpetas y la guía). */
function Welcome({ onPick }: { onPick: (p: Persona | null) => void }) {
  const { t } = useT();
  const opts: { id: Persona; icon: React.ReactNode; title: Key; body: Key }[] = [
    { id: 'study', icon: <GraduationCap size={22} />, title: 'ob.study', body: 'ob.studyB' },
    { id: 'work', icon: <Briefcase size={22} />, title: 'ob.work', body: 'ob.workB' },
    { id: 'personal', icon: <Home size={22} />, title: 'ob.personal', body: 'ob.personalB' },
  ];
  return (
    <div className="tour-welcome" role="dialog" aria-modal="true" aria-labelledby="tour-wt">
      <div className="tw-logo">
        <Logo size={30} />
      </div>
      <h2 id="tour-wt">{t('ob.title')}</h2>
      <p className="tw-lead">{t('ob.lead')}</p>
      <div className="tw-label">{t('ob.ask')}</div>
      <div className="tw-options">
        {opts.map((o, i) => (
          <button key={o.id} className="tw-option" style={{ animationDelay: `${120 + i * 70}ms` }} onClick={() => onPick(o.id)} autoFocus={i === 0}>
            <span className="tw-ico">{o.icon}</span>
            <span className="tw-text">
              <b>{t(o.title)}</b>
              <small>{t(o.body)}</small>
            </span>
            <ArrowRight size={16} className="tw-go" />
          </button>
        ))}
      </div>
      <button className="btn btn-ghost btn-sm tw-skip" onClick={() => onPick(null)}>
        <Compass size={15} /> {t('ob.explore')}
      </button>
    </div>
  );
}

/**
 * Tutorial de inicio: primero «¿para qué la usarás?» (solo en una app nueva) y luego un recorrido
 * que resalta cada parte de la interfaz. Se puede repetir desde Ajustes.
 */
export function Tour() {
  const { t } = useT();
  const open = useStore((s) => s.tourOpen);
  const ready = useStore((s) => s.ready);
  const onboarded = useStore((s) => s.settings.onboarded);
  const hasNotes = useStore((s) => s.notes.length > 0);
  const [phase, setPhase] = useState<'welcome' | 'steps' | null>(null);
  const [i, setI] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(240);

  // Primera vez: se abre solo. Con notas ya creadas (quien actualiza) no se pregunta el perfil.
  useEffect(() => {
    if (!ready) return;
    if (!onboarded && !open) useStore.getState().setTour(true);
  }, [ready, onboarded, open]);
  useEffect(() => {
    if (!open) return setPhase(null);
    setI(0);
    setPhase(!onboarded && !hasNotes ? 'welcome' : 'steps');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const steps = STEPS.filter((s) => s.id !== 'capture' || isDesktop);
  const step = steps[i];
  const rect = useRect(phase === 'steps' ? step?.target : undefined, `${phase}:${i}`);

  // Alto real de la tarjeta (para que nunca se salga de la ventana).
  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [phase, i, rect]);

  const finish = useCallback(() => {
    useStore.getState().setSettings({ onboarded: true });
    useStore.getState().setTour(false);
  }, []);
  const next = useCallback(() => (i < steps.length - 1 ? setI(i + 1) : finish()), [i, steps.length, finish]);
  const back = useCallback(() => setI((x) => Math.max(0, x - 1)), []);

  useEffect(() => {
    if (phase !== 'steps') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [phase, next, back, finish]);

  if (!open || !phase) return null;

  if (phase === 'welcome')
    return createPortal(
      <div className="tour-scrim">
        <Welcome
          onPick={async (p) => {
            await setupStarter(p);
            setPhase('steps');
          }}
        />
      </div>,
      document.body,
    );

  // Posición de la tarjeta: a la derecha del elemento si cabe; si no, debajo o encima; sin elemento, centrada.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const h = cardH;
  let left = (vw - CARD_W) / 2;
  let top = (vh - h) / 2;
  if (rect) {
    const right = rect.right + PAD + 16;
    const below = rect.bottom + PAD + 14;
    const above = rect.top - PAD - 14 - h;
    if (right + CARD_W < vw - 12) [left, top] = [right, rect.top - 6];
    else {
      left = rect.left;
      top = below + h < vh - 12 ? below : above > 12 ? above : vh - h - 12;
    }
  }
  const card: React.CSSProperties = { left: Math.min(Math.max(12, left), vw - CARD_W - 12), top: Math.min(Math.max(12, top), vh - h - 12) };
  const hole = rect ? { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : { left: vw / 2, top: vh / 2, width: 0, height: 0 };

  return createPortal(
    <div className="tour-layer" aria-live="polite">
      <div className={`tour-hole${rect ? '' : ' none'}`} style={hole} />
      <div ref={cardRef} key={step.id} className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-ct" style={{ ...card, width: CARD_W }}>
        <div className="tc-top">
          <span className="tc-count tabular">
            {i + 1} / {steps.length}
          </span>
          <button className="tc-skip" onClick={finish}>
            {t('tour.skip')}
          </button>
        </div>
        <h3 id="tour-ct">{t(step.title)}</h3>
        <p>{t(step.body)}</p>
        {step.key ? <kbd className="tc-key">{step.key}</kbd> : null}
        <div className="tc-foot">
          <div className="tc-dots" aria-hidden>
            {steps.map((s, k) => (
              <i key={s.id} className={k === i ? 'on' : k < i ? 'past' : ''} />
            ))}
          </div>
          {i > 0 ? (
            <button className="icon-btn" aria-label={t('tour.back')} title={t('tour.back')} onClick={back}>
              <ArrowLeft size={16} />
            </button>
          ) : null}
          <button className="btn btn-primary btn-sm" onClick={next} autoFocus>
            {i === steps.length - 1 ? (
              <>
                <Check size={15} /> {t('tour.finish')}
              </>
            ) : (
              <>
                {t('tour.next')} <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
