import type { JSONContent } from '@tiptap/core';
import { translate, type Key } from './i18n';
import { useStore } from './store';

export type Persona = 'study' | 'work' | 'personal';

const P = (text = ''): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });
const H = (text: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });
const task = (text: string): JSONContent => ({ type: 'taskItem', attrs: { checked: false }, content: [P(text)] });
const kbd = (key: string, text: string): JSONContent => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'code' }], text: key }, { type: 'text', text: `  ${text}` }] }] });

/** «Guía rápida»: una nota que enseña la app haciendo (cada paso es una casilla). */
export function guideNote(lang: string, persona: Persona | null): { title: string; content: JSONContent } {
  const t = (k: Key) => translate(lang, k);
  const content: JSONContent[] = [
    P(t('guide.intro')),
    H(t('guide.steps')),
    { type: 'taskList', content: [task(t('guide.s1')), task(t('guide.s2')), task(t('guide.s3')), task(t('guide.s4')), task(t('guide.s5')), task(t('guide.s6'))] },
    H(t('guide.keys')),
    {
      type: 'bulletList',
      content: [kbd('Ctrl+N', t('guide.k1')), kbd('Ctrl+K', t('guide.k2')), kbd('Ctrl+Shift+J', t('guide.k3')), kbd('Ctrl+Alt+N', t('guide.k4')), kbd('Ctrl+Shift+F', t('guide.k5'))],
    },
  ];
  if (persona) content.push(H(t('guide.ideas')), P(t(`guide.${persona}` as Key)));
  content.push(H(t('guide.data')), P(t('guide.dataB')));
  return { title: t('guide.title'), content: { type: 'doc', content } };
}

const FOLDERS: Record<Persona, [Key, Key]> = {
  study: ['ob.f.study1', 'ob.f.study2'],
  work: ['ob.f.work1', 'ob.f.work2'],
  personal: ['ob.f.personal1', 'ob.f.personal2'],
};

/** Prepara la app según para qué se va a usar: carpetas de ejemplo y la guía rápida (fijada y abierta). */
export async function setupStarter(persona: Persona | null) {
  const st = useStore.getState();
  const lang = st.settings.language;
  if (persona) for (const k of FOLDERS[persona]) if (!st.folders.some((f) => f.name === translate(lang, k))) await st.addFolder(translate(lang, k));
  st.setView({ kind: 'all' });
  const g = guideNote(lang, persona);
  const n = await st.createNote({ title: g.title, content: g.content, folderId: null, tags: [], template: false });
  await st.patchNote(n.id, { pinned: true });
}
