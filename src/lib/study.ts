import type { JSONContent } from '@tiptap/core';
import type { CardState } from './api';

export interface Card {
  id: string;
  noteId: string;
  noteTitle: string;
  tags: string[];
  front: string;
  back: string;
}

/** Hash corto y estable (la tarjeta conserva su progreso mientras no cambie la pregunta). */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const inline = (n?: JSONContent): string => {
  if (!n) return '';
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  if (n.type === 'noteLink') return String(n.attrs?.title ?? '');
  if (n.type === 'inlineMath') return `$${n.attrs?.latex ?? ''}$`;
  return (n.content ?? []).map(inline).join('');
};
const blockText = (n: JSONContent): string => {
  if (n.type === 'blockMath') return `$$${n.attrs?.latex ?? ''}$$`;
  if (n.type === 'paragraph' || n.type === 'heading') return inline(n);
  if (n.type === 'listItem' || n.type === 'taskItem') return `• ${(n.content ?? []).map(blockText).join('\n')}`;
  return (n.content ?? []).map(blockText).join('\n');
};

export const CARD_TAGS = ['tarjetas', 'flashcards', 'cartoes', 'cartões', 'cartes', 'karteikarten', 'карточки'];

/**
 * Tarjetas de una nota:
 *  · cualquier línea «pregunta :: respuesta»;
 *  · en notas con la etiqueta #tarjetas, cada título es una pregunta y lo de debajo, la respuesta.
 */
export function cardsIn(note: { id: string; title: string; tags: string[]; content: JSONContent }): Card[] {
  const out: Card[] = [];
  const add = (front: string, back: string) => {
    const f = front.trim();
    const b = back.trim();
    if (f && b) out.push({ id: `${note.id}:${hash(f)}`, noteId: note.id, noteTitle: note.title, tags: note.tags, front: f, back: b });
  };
  const walk = (n: JSONContent) => {
    if (n.type === 'paragraph' || n.type === 'heading') {
      const t = inline(n);
      const i = t.indexOf('::');
      if (i > 0) add(t.slice(0, i), t.slice(i + 2));
      return;
    }
    if (n.type === 'codeBlock') return;
    n.content?.forEach(walk);
  };
  walk(note.content);
  if (note.tags.some((t) => CARD_TAGS.includes(t.toLowerCase()))) {
    const blocks = note.content.content ?? [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type !== 'heading' || inline(b).includes('::')) continue;
      const level = Number(b.attrs?.level ?? 1);
      const body: string[] = [];
      for (let j = i + 1; j < blocks.length; j++) {
        const nb = blocks[j];
        if (nb.type === 'heading' && Number(nb.attrs?.level ?? 1) <= level) break;
        if (nb.type === 'heading') continue;
        const tx = blockText(nb);
        if (tx.trim()) body.push(tx);
      }
      add(inline(b), body.join('\n'));
    }
  }
  return out;
}

const DAY = 86_400_000;
export type Grade = 0 | 1 | 2 | 3; // otra vez, difícil, bien, fácil

/** Repetición espaciada (SM-2 simplificado, como Anki). */
export function schedule(prev: CardState | undefined, grade: Grade, now = Date.now()): CardState {
  const s: CardState = prev ? { ...prev } : { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: now, last: now };
  if (grade === 0) {
    s.lapses += 1;
    s.reps = 0;
    s.interval = 0;
    s.ease = Math.max(1.3, s.ease - 0.2);
    s.due = now + 10 * 60_000; // vuelve en 10 minutos
  } else {
    const q = [0, 3, 4, 5][grade];
    s.ease = Math.max(1.3, s.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    if (s.reps === 0) s.interval = grade === 1 ? 1 : grade === 2 ? 2 : 4;
    else if (s.reps === 1) s.interval = grade === 1 ? 3 : grade === 2 ? 6 : 8;
    else s.interval = Math.round(s.interval * (grade === 1 ? 1.2 : grade === 3 ? s.ease * 1.3 : s.ease));
    s.interval = Math.max(1, Math.min(s.interval, 3650));
    s.reps += 1;
    s.due = now + s.interval * DAY;
  }
  s.last = now;
  return s;
}

export const isDue = (s: CardState | undefined, now = Date.now()) => !s || s.due <= now;

/** «10 min», «1 d», «2 sem», «3 mes» para los botones. */
export function intervalLabel(s: CardState, now: number, lang: string) {
  const ms = Math.max(0, s.due - now);
  const fmt = (v: number, unit: Intl.RelativeTimeFormatUnit) => {
    try {
      return new Intl.NumberFormat(lang, { style: 'unit', unit: unit as string, unitDisplay: 'narrow' }).format(v);
    } catch {
      return `${v} ${unit}`;
    }
  };
  if (ms < 3_600_000) return fmt(Math.max(1, Math.round(ms / 60_000)), 'minute');
  const d = Math.round(ms / DAY);
  if (d < 14) return fmt(Math.max(1, d), 'day');
  if (d < 60) return fmt(Math.round(d / 7), 'week');
  if (d < 365) return fmt(Math.round(d / 30), 'month');
  return fmt(Math.round((d / 365) * 10) / 10, 'year');
}
