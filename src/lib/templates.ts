import type { JSONContent } from '@tiptap/core';
import { translate, type Key } from './i18n';
import type { NoteMeta } from '@/types';

/** Plantilla lista para usar: las de la app (traducidas) y las del usuario (notas marcadas como plantilla). */
export interface Template {
  id: string;
  name: string;
  builtin: boolean;
  /** Título de la nota nueva (puede llevar {{date}}). */
  title: string;
  content: () => Promise<JSONContent> | JSONContent;
}

const P = (text = ''): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });
const H = (text: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });
const tasks = (n: number): JSONContent => ({ type: 'taskList', content: Array.from({ length: n }, () => ({ type: 'taskItem', attrs: { checked: false }, content: [P()] })) });
const bullets = (n: number): JSONContent => ({ type: 'bulletList', content: Array.from({ length: n }, () => ({ type: 'listItem', content: [P()] })) });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

export const BUILTIN_IDS = ['meeting', 'lecture', 'daily', 'project', 'weekly'] as const;
export type BuiltinId = (typeof BUILTIN_IDS)[number];

export function builtinTemplate(id: BuiltinId, lang: string): Template {
  const t = (k: Key) => translate(lang, k);
  const name = t(`tpl.${id}` as Key);
  const body: Record<BuiltinId, () => JSONContent> = {
    meeting: () => doc(H(t('tpl.attendees')), bullets(1), H(t('tpl.topics')), bullets(1), H(t('tpl.decisions')), tasks(1)),
    lecture: () => doc(H(t('tpl.subject')), P(), H(t('tpl.keyIdeas')), bullets(3), H(t('tpl.questions')), bullets(1), H(t('tpl.summary')), P()),
    daily: () => doc(H(t('tpl.priorities')), tasks(3), H(t('tpl.notes')), P(), H(t('tpl.tomorrow')), tasks(1)),
    project: () => doc(H(t('tpl.goal')), P(), H(t('tpl.tasks')), tasks(3), H(t('tpl.resources')), bullets(1), H(t('tpl.notes')), P()),
    weekly: () => doc(H(t('tpl.wentWell')), bullets(1), H(t('tpl.improve')), bullets(1), H(t('tpl.nextWeek')), tasks(3)),
  };
  return { id: `builtin:${id}`, name, builtin: true, title: id === 'daily' ? '{{date}}' : `${name} · {{date}}`, content: body[id] };
}

/** Todas las plantillas: primero las del usuario, luego las de la app. */
export function allTemplates(notes: NoteMeta[], lang: string, load: (id: string) => Promise<JSONContent | undefined>): Template[] {
  const mine: Template[] = notes
    .filter((n) => n.template && !n.trashedAt)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((n) => ({ id: n.id, name: n.title || translate(lang, 'app.untitled'), builtin: false, title: '', content: async () => (await load(n.id)) ?? doc(P()) }));
  return [...mine, ...BUILTIN_IDS.map((id) => builtinTemplate(id, lang))];
}

export function longDate(d: Date, lang: string) {
  const s = d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Sustituye {{date}}, {{time}} (y {{fecha}}, {{hora}}) en el texto de la plantilla. */
export function fillTokens<T extends JSONContent | string>(v: T, lang: string, now = new Date()): T {
  const date = now.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });
  const time = now.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  const rep = (s: string) => s.replace(/\{\{\s*(date|fecha)\s*\}\}/gi, date).replace(/\{\{\s*(time|hora)\s*\}\}/gi, time);
  if (typeof v === 'string') return rep(v) as T;
  const walk = (n: JSONContent): JSONContent => ({ ...n, ...(n.text !== undefined ? { text: rep(n.text) } : {}), ...(n.content ? { content: n.content.map(walk) } : {}) });
  return walk(v as JSONContent) as T;
}
