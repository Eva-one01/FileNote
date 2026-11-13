import { Bell, CalendarPlus, CheckSquare, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { dayKey } from '@/lib/templates';
import { confirmDialog } from './ui';

interface Req {
  title: string;
  noteId?: string;
  noteTitle?: string;
}
const useSend = create<{ req: Req | null; set: (r: Req | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

/** ¿Está disponible el envío a Clipsy? (solo en la app de escritorio). */
export const canSendToClipsy = () => !!api.clipsy;
export const sendToClipsy = (r: Req) => useSend.getState().set({ ...r, title: r.title.trim() });

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
const nextMonday = () => {
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return dayKey(d);
};

/** «Enviar a Clipsy»: una tarea (con fecha y hora opcionales) o un recordatorio a una hora concreta. */
export function SendToClipsy() {
  const { t } = useT();
  const req = useSend((s) => s.req);
  const [kind, setKind] = useState<'task' | 'reminder'>('task');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState<string>('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!req) return;
    setTitle(req.title);
    setKind('task');
    setDate(dayKey());
    setTime('');
    setTimeout(() => input.current?.select(), 30);
  }, [req]);
  if (!req) return null;

  const close = () => useSend.getState().set(null);
  const chips: { label: string; value: string }[] = [
    { label: t('cl.today'), value: dayKey() },
    { label: t('cl.tomorrow'), value: addDays(1) },
    { label: t('cl.monday'), value: nextMonday() },
    ...(kind === 'task' ? [{ label: t('cl.noDate'), value: '' }] : []),
  ];
  const reminderAt = () => new Date(`${date || dayKey()}T${time || '09:00'}`).getTime();
  const ok = title.trim() && (kind === 'task' || (date && reminderAt() > Date.now() - 60_000));

  const send = async () => {
    if (!ok || busy) return;
    setBusy(true);
    const r = await api.clipsy!.send(
      kind === 'task' ? { kind, title: title.trim(), date: date || undefined, time: date && time ? time : undefined, noteId: req.noteId, noteTitle: req.noteTitle } : { kind, title: title.trim(), at: reminderAt() },
    );
    setBusy(false);
    if (r === 'sent') {
      close();
      useStore.getState().showToast(kind === 'task' ? t('cl.sentTask') : t('cl.sentReminder'));
    } else if (r === 'missing') {
      close();
      if (await confirmDialog({ title: t('cl.missingT'), body: t('cl.missingB'), ok: t('cl.get') })) window.open('https://razorgroup.dev/clipsy', '_blank');
    }
  };

  return createPortal(
    <div className="scrim scrim-top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog clipsy-dialog" role="dialog" aria-label={t('cl.title')} onKeyDown={(e) => (e.key === 'Escape' ? close() : e.key === 'Enter' && !e.shiftKey ? (e.preventDefault(), void send()) : undefined)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="cl-badge">
            <CalendarPlus size={17} />
          </span>
          <h3 style={{ flex: 1, margin: 0 }}>{t('cl.title')}</h3>
          <button className="icon-btn" aria-label={t('set.close')} onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="seg" style={{ marginTop: 14 }} role="radiogroup">
          <button role="radio" aria-checked={kind === 'task'} className={kind === 'task' ? 'on' : ''} onClick={() => setKind('task')} style={{ flex: 1 }}>
            <CheckSquare size={14} /> {t('cl.task')}
          </button>
          <button
            role="radio"
            aria-checked={kind === 'reminder'}
            className={kind === 'reminder' ? 'on' : ''}
            onClick={() => {
              setKind('reminder');
              if (!date) setDate(dayKey());
              if (!time) setTime('09:00');
            }}
            style={{ flex: 1 }}
          >
            <Bell size={14} /> {t('cl.reminder')}
          </button>
        </div>
        <input ref={input} className="input" style={{ marginTop: 12 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('note.titlePh')} aria-label={t('note.titlePh')} />
        <div className="label" style={{ margin: '14px 0 8px' }}>
          {t('cl.when')}
        </div>
        <div className="cl-chips">
          {chips.map((c) => (
            <button key={c.label} className={`math-chip${date === c.value ? ' on' : ''}`} onClick={() => setDate(c.value)}>
              {c.label}
            </button>
          ))}
          <input type="date" className="input cl-date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t('cl.when')} />
          {date ? <input type="time" className="input cl-time" value={time} onChange={(e) => setTime(e.target.value)} aria-label={t('cl.time')} /> : null}
        </div>
        {req.noteId && kind === 'task' ? <p className="set-hint" style={{ marginTop: 10 }}>{t('cl.linkBack')}</p> : null}
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={close}>
            {t('dlg.cancel')}
          </button>
          <button className="btn btn-primary" disabled={!ok || busy} onClick={() => void send()}>
            {t('cl.send')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
