import { CornerDownLeft, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { useAppearance } from '@/App';
import { Logo } from '@/components/Sidebar';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { textOf, uid } from '@/lib/store';
import type { Note } from '@/types';

/** Texto plano → documento: cada línea un párrafo; «- » o «* » listas; «[ ] » tareas. */
function toDoc(text: string): JSONContent {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: JSONContent[] = [];
  const P = (s: string): JSONContent => (s ? { type: 'paragraph', content: [{ type: 'text', text: s }] } : { type: 'paragraph' });
  for (const line of lines) {
    const task = line.match(/^\s*\[( |x)\]\s+(.*)$/i);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const last = out[out.length - 1];
    if (task) {
      const item = { type: 'taskItem', attrs: { checked: task[1].toLowerCase() === 'x' }, content: [P(task[2])] };
      if (last?.type === 'taskList') last.content!.push(item);
      else out.push({ type: 'taskList', content: [item] });
    } else if (bullet) {
      const item = { type: 'listItem', content: [P(bullet[1])] };
      if (last?.type === 'bulletList') last.content!.push(item);
      else out.push({ type: 'bulletList', content: [item] });
    } else out.push(P(line));
  }
  while (out.length > 1 && out[out.length - 1].type === 'paragraph' && !out[out.length - 1].content) out.pop();
  return { type: 'doc', content: out.length ? out : [P('')] };
}

/** Ventana pequeña para apuntar algo al vuelo (atajo global). Ctrl+Enter guarda, Esc cierra. */
export function Capture() {
  const { t } = useT();
  useAppearance(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.classList.add('capture-mode');
    // La ventana se reutiliza: al volver a mostrarse, empieza vacía y con el cursor en el título.
    const reset = () => {
      if (document.visibilityState === 'visible') titleRef.current?.focus();
    };
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('focus', reset);
    return () => {
      document.removeEventListener('visibilitychange', reset);
      window.removeEventListener('focus', reset);
    };
  }, []);

  const close = () => {
    setTitle('');
    setBody('');
    api.capture?.close();
  };
  const save = async () => {
    if (saving) return;
    if (!title.trim() && !body.trim()) return close();
    setSaving(true);
    const content = toDoc(body);
    const now = Date.now();
    const note: Note = { id: uid(), title: title.trim() || body.trim().split('\n')[0].slice(0, 80), content, text: textOf(content), folderId: null, tags: [], pinned: false, links: [], createdAt: now, updatedAt: now, trashedAt: null };
    await api.notes.save(note);
    setSaving(false);
    setTitle('');
    setBody('');
    api.capture?.done(note.id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div className="capture" onKeyDown={onKey}>
      <div className="capture-head">
        <Logo size={18} />
        <span>{t('cap.title')}</span>
        <button className="icon-btn" aria-label={t('set.close')} title={`${t('set.close')} (Esc)`} onClick={close}>
          <X size={16} />
        </button>
      </div>
      <input
        ref={titleRef}
        className="capture-title"
        placeholder={t('note.titlePh')}
        aria-label={t('note.titlePh')}
        value={title}
        autoFocus
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            bodyRef.current?.focus();
          }
        }}
      />
      <textarea ref={bodyRef} className="capture-body" placeholder={t('cap.bodyPh')} aria-label={t('cap.bodyPh')} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="capture-foot">
        <span className="faint">{t('cap.hint')}</span>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>
          <CornerDownLeft size={14} /> {t('cap.save')}
        </button>
      </div>
    </div>
  );
}
