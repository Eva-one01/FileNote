import type { JSONContent } from '@tiptap/core';

export interface TaskRef {
  /** Posición de la casilla dentro de la nota (orden de aparición). */
  index: number;
  text: string;
  checked: boolean;
  depth: number;
}

const plain = (n?: JSONContent): string => (n ? (n.type === 'text' ? (n.text ?? '') : n.type === 'noteLink' ? String(n.attrs?.title ?? '') : (n.content ?? []).map(plain).join('')) : '');

/** Todas las casillas de un documento (también las anidadas). */
export function tasksIn(doc: JSONContent | undefined): TaskRef[] {
  const out: TaskRef[] = [];
  const walk = (n: JSONContent | undefined, depth: number) => {
    if (!n) return;
    if (n.type === 'taskItem') {
      const first = n.content?.find((c) => c.type === 'paragraph');
      out.push({ index: out.length, text: plain(first).trim(), checked: !!n.attrs?.checked, depth });
      n.content?.forEach((c) => walk(c, depth + 1));
      return;
    }
    n.content?.forEach((c) => walk(c, depth));
  };
  walk(doc, 0);
  return out;
}

/** Copia del documento con la casilla número `index` marcada o desmarcada. */
export function setTaskChecked(doc: JSONContent, index: number, checked: boolean): JSONContent {
  let i = 0;
  const walk = (n: JSONContent): JSONContent => {
    if (n.type === 'taskItem') {
      const mine = i++ === index;
      const content = n.content?.map(walk);
      return { ...n, ...(mine ? { attrs: { ...n.attrs, checked } } : {}), ...(content ? { content } : {}) };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return walk(doc);
}
