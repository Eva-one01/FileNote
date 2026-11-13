import type { JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { buildExtensions } from '@/editor/extensions';
import type { Note } from '@/types';
import { api, type ImportBundle } from './api';
import { linksIn, normalizeTag, textOf, uid, useStore } from './store';

const IMG = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', pdf: 'application/pdf' };
const lower = (s: string) => s.normalize('NFC').toLowerCase();
const stripExt = (s: string) => s.replace(/\.(md|markdown|txt)$/i, '');
const base = (s: string) => s.split('/').pop() ?? s;
const dirOf = (s: string) => (s.includes('/') ? s.slice(0, s.lastIndexOf('/')) : '');
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Normaliza «a/./b/../c» → «a/c». */
function joinPath(dir: string, rel: string) {
  const out: string[] = [];
  for (const p of `${dir}/${rel}`.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

/** Cabecera YAML (---) → etiquetas; devuelve el texto sin ella. */
function frontmatter(md: string): { body: string; tags: string[] } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!m) return { body: md, tags: [] };
  const tags: string[] = [];
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(tags?|keywords)\s*:\s*(.*)$/i);
    if (!kv) continue;
    const v = kv[2].trim();
    if (v) tags.push(...v.replace(/^\[|\]$/g, '').split(/[,\s]+/));
    else for (let j = i + 1; j < lines.length && /^\s*-\s+/.test(lines[j]); j++) tags.push(lines[j].replace(/^\s*-\s+/, ''));
  }
  return { body: md.slice(m[0].length), tags: tags.map((x) => x.replace(/^#/, '').replace(/^["']|["']$/g, '')).filter(Boolean) };
}

type Token = { kind: 'link'; target: string; label: string } | { kind: 'file'; rel: string | null; name: string };
type Saved = { url: string; name: string; size: number; mime: string } | null;

export interface ImportResult {
  notes: number;
  attachments: number;
  folderId: string | null;
}

/**
 * Importa una carpeta de Markdown (Obsidian, Notion, Bear, Logseq…): subcarpetas, [[enlaces]], ![[incrustados]],
 * imágenes, adjuntos, etiquetas (#tag y cabecera YAML) y ==resaltado==.
 */
export async function importBundle(bundle: ImportBundle, onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const st = useStore.getState();
  await st.flush();
  const manager = new MarkdownManager({ extensions: buildExtensions('', null) });

  // 1) Carpetas: una carpeta raíz con el nombre de lo importado y dentro la misma estructura.
  const folderIds = new Map<string, string>();
  const multi = bundle.files.length > 1;
  let rootId: string | null = null;
  if (multi) {
    rootId = (await st.addFolder(bundle.name)).id;
    folderIds.set('', rootId);
    const dirs = [...new Set(bundle.files.map((f) => dirOf(f.rel)).filter(Boolean))].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    for (const d of dirs) {
      let acc = '';
      for (const part of d.split('/')) {
        const parent = acc;
        acc = acc ? `${acc}/${part}` : part;
        if (!folderIds.has(acc)) folderIds.set(acc, (await useStore.getState().addFolder(part, folderIds.get(parent) ?? rootId)).id);
      }
    }
  }

  // 2) Identificadores y títulos de antemano, para que los enlaces funcionen en cualquier orden.
  const ids = new Map<string, string>();
  const byTitle = new Map<string, { id: string; title: string }>();
  const byPath = new Map<string, { id: string; title: string }>();
  for (const f of bundle.files) {
    const id = uid();
    ids.set(f.rel, id);
    const title = stripExt(base(f.rel));
    if (!byTitle.has(lower(title))) byTitle.set(lower(title), { id, title });
    byPath.set(lower(stripExt(f.rel)), { id, title });
  }
  const resolveNote = (target: string, fromDir: string) => {
    const t = stripExt(safeDecode(target.trim()));
    return byPath.get(lower(joinPath(fromDir, t))) ?? byPath.get(lower(t)) ?? byTitle.get(lower(base(t)));
  };

  // Adjuntos: por ruta relativa o, como Obsidian, por nombre en cualquier carpeta.
  const assetByPath = new Map(bundle.assets.map((a) => [lower(a), a]));
  const assetByName = new Map<string, string>();
  for (const a of bundle.assets) if (!assetByName.has(lower(base(a)))) assetByName.set(lower(base(a)), a);
  const resolveAsset = (ref: string, fromDir: string) => {
    const r = safeDecode(ref.trim().replace(/^<|>$/g, ''));
    return assetByPath.get(lower(joinPath(fromDir, r))) ?? assetByPath.get(lower(r)) ?? assetByName.get(lower(base(r))) ?? null;
  };
  const copied = new Map<string, Saved>();
  const copy = async (rel: string): Promise<Saved> => {
    if (!copied.has(rel)) copied.set(rel, (await api.importer?.asset(rel)) ?? null);
    return copied.get(rel) ?? null;
  };

  let attachments = 0;
  let done = 0;
  for (const f of bundle.files) {
    const fromDir = dirOf(f.rel);
    const { body, tags: fmTags } = frontmatter(f.text.replace(/^﻿/, ''));
    const tokens: Token[] = [];
    const tags = new Set(fmTags.map(normalizeTag).filter(Boolean));
    const imgs: string[] = [];

    // Lo que está dentro de bloques de código no se toca.
    const parts = body.replace(/%%[\s\S]*?%%/g, '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/);
    const md = parts
      .map((seg, k) => {
        if (k % 2) return seg;
        for (const m of seg.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu)) {
          const tg = normalizeTag(m[1]);
          if (tg) tags.add(tg);
        }
        return (
          seg
            // ![[archivo]] (imagen, nota u otro archivo)
            .replace(/!\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => {
              const rel = resolveAsset(target, fromDir);
              if (rel && IMG.test(rel)) {
                imgs.push(rel);
                return `![${alias && !/^\d+(x\d+)?$/.test(alias) ? alias : base(rel)}](fnimg:${imgs.length - 1})`;
              }
              if (/\.(md|markdown)$/i.test(target) || !/\.[a-z0-9]{2,5}$/i.test(target)) {
                tokens.push({ kind: 'link', target, label: alias || stripExt(base(target)) });
                return `FNTOK${tokens.length - 1}X`;
              }
              tokens.push({ kind: 'file', rel, name: base(target) });
              return `FNTOK${tokens.length - 1}X`;
            })
            // [[nota#sección|alias]]
            .replace(/\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => {
              tokens.push({ kind: 'link', target, label: alias || stripExt(base(target)) });
              return `FNTOK${tokens.length - 1}X`;
            })
            // ![alt](ruta/local.png)
            .replace(/!\[([^\]]*)\]\((?!https?:|data:|fnimg:)([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt: string, ref: string) => {
              const rel = resolveAsset(ref, fromDir);
              if (!rel || !IMG.test(rel)) return m;
              imgs.push(rel);
              return `![${alt}](fnimg:${imgs.length - 1})`;
            })
            // [texto](Otra%20nota.md) → enlace entre notas; [texto](archivo.pdf) → adjunto
            .replace(/(?<!!)\[([^\]]+)\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (m, label: string, ref: string) => {
              if (/\.(md|markdown)$/i.test(safeDecode(ref)) && resolveNote(ref, fromDir)) {
                tokens.push({ kind: 'link', target: joinPath(fromDir, safeDecode(ref)), label });
                return `FNTOK${tokens.length - 1}X`;
              }
              const rel = resolveAsset(ref, fromDir);
              if (rel) {
                tokens.push({ kind: 'file', rel, name: label || base(rel) });
                return `FNTOK${tokens.length - 1}X`;
              }
              return m;
            })
        );
      })
      .join('');

    // Imágenes y archivos a la carpeta de FileNote.
    const imgUrls = await Promise.all(imgs.map((rel) => copy(rel)));
    const fileUrls = await Promise.all(tokens.map((tk) => (tk.kind === 'file' && tk.rel ? copy(tk.rel) : Promise.resolve(null))));
    attachments += imgUrls.filter(Boolean).length + fileUrls.filter(Boolean).length;

    let doc: JSONContent;
    try {
      doc = manager.parse(md);
    } catch {
      doc = { type: 'doc', content: md.split(/\n{2,}/).map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] })) };
    }

    // Marcas propias → enlaces entre notas, adjuntos, imágenes y ==resaltado==.
    const splitText = (n: JSONContent): JSONContent[] => {
      const text = n.text ?? '';
      if (!/FNTOK\d+X|==[^=\n]+==/.test(text)) return [n];
      const out: JSONContent[] = [];
      for (const piece of text.split(/(FNTOK\d+X|==[^=\n]+==)/)) {
        if (!piece) continue;
        const tok = piece.match(/^FNTOK(\d+)X$/);
        if (tok) {
          const tk = tokens[Number(tok[1])];
          if (tk?.kind === 'link') {
            const hit = resolveNote(tk.target, fromDir);
            out.push(hit ? { type: 'noteLink', attrs: { id: hit.id, title: hit.title } } : { ...n, text: tk.label });
          } else if (tk?.kind === 'file') {
            const saved = fileUrls[Number(tok[1])];
            out.push(saved ? { type: 'text', text: tk.name, marks: [...(n.marks ?? []), { type: 'link', attrs: { href: saved.url } }] } : { ...n, text: tk.name });
          }
        } else if (/^==[^=\n]+==$/.test(piece)) out.push({ ...n, text: piece.slice(2, -2), marks: [...(n.marks ?? []), { type: 'highlight' }] });
        else out.push({ ...n, text: piece });
      }
      return out;
    };
    const walk = (n: JSONContent): JSONContent | null => {
      if (n.type === 'image') {
        const m = String(n.attrs?.src ?? '').match(/^fnimg:(\d+)$/);
        if (m) {
          const saved = imgUrls[Number(m[1])];
          return saved ? { ...n, attrs: { ...n.attrs, src: saved.url } } : null;
        }
        return n;
      }
      if (!n.content) return n;
      // Un párrafo que solo tiene un archivo adjunto → tarjeta de adjunto.
      if (n.type === 'paragraph' && n.content.length === 1 && n.content[0].type === 'text') {
        const only = n.content[0].text?.match(/^\s*FNTOK(\d+)X\s*$/);
        const tk = only ? tokens[Number(only[1])] : null;
        const saved = only ? fileUrls[Number(only[1])] : null;
        if (tk?.kind === 'file' && saved) return { type: 'attachment', attrs: { url: saved.url, name: tk.name, size: saved.size, mime: saved.mime || MIME[tk.name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream' } };
      }
      const content: JSONContent[] = [];
      for (const c of n.content) {
        if (c.type === 'text') content.push(...splitText(c));
        else {
          const w = walk(c);
          if (w) content.push(w);
        }
      }
      return { ...n, content };
    };
    doc = walk(doc) ?? { type: 'doc', content: [{ type: 'paragraph' }] };
    if (!doc.content?.length) doc = { type: 'doc', content: [{ type: 'paragraph' }] };

    const note: Note = {
      id: ids.get(f.rel)!,
      title: stripExt(base(f.rel)),
      content: doc,
      text: textOf(doc),
      folderId: multi ? (folderIds.get(fromDir) ?? rootId) : null,
      tags: [...tags].slice(0, 20),
      pinned: false,
      links: linksIn(doc),
      createdAt: Math.round(f.ctime || f.mtime || Date.now()),
      updatedAt: Math.round(f.mtime || Date.now()),
      trashedAt: null,
    };
    await api.notes.save(note);
    done++;
    onProgress?.(done, bundle.files.length);
  }

  await useStore.getState().refresh();
  return { notes: done, attachments, folderId: rootId };
}
