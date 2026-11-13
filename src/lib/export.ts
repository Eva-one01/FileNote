import type { Editor, JSONContent } from '@tiptap/core';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import { drawingSvg, type Stroke } from '@/editor/drawing';
import { api } from './api';
import { translate } from './i18n';
import { useStore } from './store';

type Fmt = 'pdf' | 'docx' | 'md';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fileSafe = (s: string) => (s || 'nota').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'nota';
const noteTitle = (id: string, fallback: string) => {
  const st = useStore.getState();
  return st.notes.find((n) => n.id === id)?.title || fallback || translate(st.settings.language, 'app.untitled');
};

/* ───────── HTML (para PDF) ───────── */

function marksHtml(n: JSONContent): string {
  let s = esc(n.text ?? '');
  for (const m of n.marks ?? []) {
    if (m.type === 'bold') s = `<strong>${s}</strong>`;
    else if (m.type === 'italic') s = `<em>${s}</em>`;
    else if (m.type === 'underline') s = `<u>${s}</u>`;
    else if (m.type === 'strike') s = `<s>${s}</s>`;
    else if (m.type === 'code') s = `<code>${s}</code>`;
    else if (m.type === 'highlight') s = `<mark>${s}</mark>`;
    else if (m.type === 'link') s = `<a href="${esc(String(m.attrs?.href ?? ''))}">${s}</a>`;
  }
  return s;
}

function toHtml(n: JSONContent): string {
  const kids = () => (n.content ?? []).map(toHtml).join('');
  switch (n.type) {
    case 'doc':
      return kids();
    case 'paragraph':
      return `<p>${kids() || '&nbsp;'}</p>`;
    case 'heading':
      return `<h${n.attrs?.level ?? 1}>${kids()}</h${n.attrs?.level ?? 1}>`;
    case 'text':
      return marksHtml(n);
    case 'hardBreak':
      return '<br>';
    case 'bulletList':
      return `<ul>${kids()}</ul>`;
    case 'orderedList':
      return `<ol start="${n.attrs?.start ?? 1}">${kids()}</ol>`;
    case 'listItem':
      return `<li>${kids()}</li>`;
    case 'taskList':
      return `<ul class="tasks">${kids()}</ul>`;
    case 'taskItem':
      return `<li class="${n.attrs?.checked ? 'done' : ''}"><span class="box">${n.attrs?.checked ? '✓' : ''}</span><div>${kids()}</div></li>`;
    case 'blockquote':
      return `<blockquote>${kids()}</blockquote>`;
    case 'codeBlock':
      return `<pre><code>${esc((n.content ?? []).map((c) => c.text ?? '').join(''))}</code></pre>`;
    case 'horizontalRule':
      return '<hr>';
    case 'image':
      return `<img src="${esc(String(n.attrs?.src ?? ''))}" alt="${esc(String(n.attrs?.alt ?? ''))}">`;
    case 'table':
      return `<table>${kids()}</table>`;
    case 'tableRow':
      return `<tr>${kids()}</tr>`;
    case 'tableHeader':
      return `<th>${kids()}</th>`;
    case 'tableCell':
      return `<td>${kids()}</td>`;
    case 'noteLink':
      return `<span class="link">${esc(noteTitle(String(n.attrs?.id), String(n.attrs?.title ?? '')))}</span>`;
    case 'drawing':
      return `<div class="drawing">${drawingSvg((n.attrs?.strokes as Stroke[]) ?? [], Number(n.attrs?.height) || 360)}</div>`;
    case 'attachment':
      return `<p class="att">📎 ${esc(String(n.attrs?.name ?? ''))}</p>`;
    default:
      return kids();
  }
}

const PDF_CSS = `
@page { margin: 22mm 20mm; }
body { font-family: Nunito, 'Segoe UI', system-ui, sans-serif; color: #0E0E10; font-size: 12pt; line-height: 1.6; font-weight: 600; }
h1.title { font-size: 26pt; font-weight: 900; letter-spacing: -0.02em; margin: 0 0 4pt; line-height: 1.2; }
.meta { color: #9C9CA3; font-size: 9.5pt; margin-bottom: 18pt; }
h1, h2, h3 { font-weight: 900; line-height: 1.25; margin: 16pt 0 4pt; } h1 { font-size: 19pt; } h2 { font-size: 15.5pt; } h3 { font-size: 13pt; }
p { margin: 0 0 6pt; } strong { font-weight: 900; }
a { color: #2E55E6; } mark { background: #FCE6A9; }
code { font-family: Consolas, monospace; font-size: 10pt; background: #EEEEEB; padding: 1px 4px; border-radius: 4px; }
pre { background: #EEEEEB; padding: 10pt 12pt; border-radius: 8px; white-space: pre-wrap; } pre code { background: none; padding: 0; }
blockquote { margin: 0 0 6pt; padding-left: 12pt; border-left: 3px solid #2E55E6; color: #5F5F66; }
ul.tasks { list-style: none; padding-left: 0; } ul.tasks li { display: flex; gap: 8pt; align-items: flex-start; }
ul.tasks .box { flex: none; width: 11pt; height: 11pt; margin-top: 3pt; border: 1.5px solid #9C9CA3; border-radius: 3px; font-size: 8pt; line-height: 11pt; text-align: center; color: #fff; }
ul.tasks li.done .box { background: #2E55E6; border-color: #2E55E6; } ul.tasks li.done div { color: #9C9CA3; text-decoration: line-through; }
img, .drawing svg { max-width: 100%; height: auto; border-radius: 6px; } .drawing { margin: 6pt 0; border: 1px solid #e5e5e2; border-radius: 6px; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; } td, th { border: 1px solid #d6d6d2; padding: 4pt 7pt; text-align: left; vertical-align: top; } th { background: #EEEEEB; }
.link { color: #2E55E6; font-weight: 800; } .att { color: #5F5F66; }
hr { border: 0; border-top: 1px solid #d6d6d2; margin: 14pt 0; }
`;

/* ───────── Markdown ───────── */

function mdInline(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n';
      if (n.type === 'noteLink') return `[[${noteTitle(String(n.attrs?.id), String(n.attrs?.title ?? ''))}]]`;
      if (n.type !== 'text') return mdInline(n.content);
      let s = n.text ?? '';
      const marks = (n.marks ?? []).map((m) => m.type);
      if (marks.includes('code')) return '`' + s + '`';
      s = s.replace(/([*_~`[\]])/g, '\\$1');
      if (marks.includes('bold')) s = `**${s}**`;
      if (marks.includes('italic')) s = `*${s}*`;
      if (marks.includes('strike')) s = `~~${s}~~`;
      if (marks.includes('highlight')) s = `==${s}==`;
      const link = n.marks?.find((m) => m.type === 'link');
      if (link) s = `[${s}](${link.attrs?.href})`;
      return s;
    })
    .join('');
}

async function toDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;
  try {
    const b = await (await fetch(src)).blob();
    return await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(b);
    });
  } catch {
    return src;
  }
}

async function toMd(n: JSONContent, depth = 0, ordered?: number): Promise<string> {
  const pad = '  '.repeat(depth);
  const blocks = async (list?: JSONContent[], d = depth) => (await Promise.all((list ?? []).map((c) => toMd(c, d)))).join('');
  switch (n.type) {
    case 'doc':
      return (await Promise.all((n.content ?? []).map((c) => toMd(c, 0)))).join('\n');
    case 'paragraph':
      return `${mdInline(n.content)}\n`;
    case 'heading':
      return `${'#'.repeat(Number(n.attrs?.level) || 1)} ${mdInline(n.content)}\n`;
    case 'bulletList':
    case 'taskList':
      return (await Promise.all((n.content ?? []).map((c) => toMd(c, depth)))).join('');
    case 'orderedList':
      return (await Promise.all((n.content ?? []).map((c, i) => toMd(c, depth, Number(n.attrs?.start ?? 1) + i)))).join('');
    case 'listItem':
    case 'taskItem': {
      const [first, ...rest] = n.content ?? [];
      const bullet = n.type === 'taskItem' ? `- [${n.attrs?.checked ? 'x' : ' '}] ` : ordered ? `${ordered}. ` : '- ';
      const head = first?.type === 'paragraph' ? mdInline(first.content) : '';
      return `${pad}${bullet}${head}\n${await blocks(first?.type === 'paragraph' ? rest : n.content, depth + 1)}`;
    }
    case 'blockquote':
      return (await blocks(n.content))
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n') + '\n';
    case 'codeBlock':
      return '```' + (n.attrs?.language ?? '') + '\n' + (n.content ?? []).map((c) => c.text ?? '').join('') + '\n```\n';
    case 'horizontalRule':
      return '---\n';
    case 'image':
      return `![${n.attrs?.alt ?? ''}](${await toDataUrl(String(n.attrs?.src ?? ''))})\n`;
    case 'drawing': {
      const svg = drawingSvg((n.attrs?.strokes as Stroke[]) ?? [], Number(n.attrs?.height) || 360);
      return `![](data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))})\n`;
    }
    case 'attachment':
      return `📎 ${n.attrs?.name ?? ''}\n`;
    case 'table': {
      const rows = (n.content ?? []).map((r) => (r.content ?? []).map((c) => (c.content ?? []).map((p) => mdInline(p.content)).join(' ').replace(/\|/g, '\\|')));
      if (!rows.length) return '';
      const cols = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ')} |`;
      return [line(rows[0]), `|${' --- |'.repeat(cols)}`, ...rows.slice(1).map(line)].join('\n') + '\n';
    }
    default:
      return mdInline(n.content);
  }
}

/* ───────── Word (.docx) ───────── */

async function imageBytes(src: string): Promise<{ data: ArrayBuffer; w: number; h: number; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null> {
  try {
    const blob = await (await fetch(src)).blob();
    const bmp = await createImageBitmap(blob);
    const type = blob.type.includes('png') ? 'png' : blob.type.includes('gif') ? 'gif' : blob.type.includes('bmp') ? 'bmp' : 'jpg';
    return { data: await blob.arrayBuffer(), w: bmp.width, h: bmp.height, type };
  } catch {
    return null;
  }
}

/** El dibujo se convierte en PNG (Word no muestra bien SVG en todas las versiones). */
async function drawingPng(strokes: Stroke[], height: number): Promise<{ data: ArrayBuffer; w: number; h: number } | null> {
  const svg = drawingSvg(strokes, height);
  const img = new Image();
  img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  await img.decode().catch(() => null);
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  return blob ? { data: await blob.arrayBuffer(), w: 800, h: height } : null;
}

function runs(nodes: JSONContent[] | undefined): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') out.push(new TextRun({ text: '', break: 1 }));
    else if (n.type === 'noteLink') out.push(new TextRun({ text: noteTitle(String(n.attrs?.id), String(n.attrs?.title ?? '')), color: '2E55E6', bold: true }));
    else if (n.type === 'text') {
      const m = (n.marks ?? []).map((x) => x.type);
      const r = new TextRun({
        text: n.text ?? '',
        bold: m.includes('bold'),
        italics: m.includes('italic'),
        underline: m.includes('underline') ? {} : undefined,
        strike: m.includes('strike'),
        highlight: m.includes('highlight') ? 'yellow' : undefined,
        font: m.includes('code') ? 'Consolas' : undefined,
        color: n.marks?.some((x) => x.type === 'link') ? '2E55E6' : undefined,
      });
      const link = n.marks?.find((x) => x.type === 'link');
      out.push(link ? new ExternalHyperlink({ link: String(link.attrs?.href ?? ''), children: [r] }) : r);
    }
  }
  return out;
}

async function docxBlocks(list: JSONContent[] | undefined, level = 0, listRef?: 'bullets' | 'numbers'): Promise<(Paragraph | Table)[]> {
  const out: (Paragraph | Table)[] = [];
  for (const n of list ?? []) {
    switch (n.type) {
      case 'paragraph':
        out.push(new Paragraph({ children: runs(n.content), spacing: { after: 120 } }));
        break;
      case 'heading':
        out.push(new Paragraph({ children: runs(n.content), heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][(Number(n.attrs?.level) || 1) - 1] }));
        break;
      case 'bulletList':
      case 'orderedList':
        out.push(...(await docxBlocks(n.content, level, n.type === 'bulletList' ? 'bullets' : 'numbers')));
        break;
      case 'listItem': {
        const [first, ...rest] = n.content ?? [];
        out.push(new Paragraph({ children: runs(first?.content), numbering: { reference: listRef ?? 'bullets', level } }));
        out.push(...(await docxBlocks(rest, level + 1, listRef)));
        break;
      }
      case 'taskList':
        out.push(...(await docxBlocks(n.content, level)));
        break;
      case 'taskItem': {
        const [first, ...rest] = n.content ?? [];
        out.push(new Paragraph({ indent: { left: 360 * level }, children: [new TextRun({ text: n.attrs?.checked ? '☑ ' : '☐ ' }), ...runs(first?.content)] }));
        out.push(...(await docxBlocks(rest, level + 1)));
        break;
      }
      case 'blockquote':
        for (const p of await docxBlocks(n.content, level)) out.push(p);
        break;
      case 'codeBlock':
        out.push(
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill: 'EEEEEB', color: 'auto' },
            children: (n.content ?? [])
              .map((c) => c.text ?? '')
              .join('')
              .split('\n')
              .map((l, i) => new TextRun({ text: l, font: 'Consolas', size: 19, break: i ? 1 : 0 })),
          }),
        );
        break;
      case 'horizontalRule':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D6D6D2', space: 1 } }, children: [] }));
        break;
      case 'image': {
        const img = await imageBytes(String(n.attrs?.src ?? ''));
        if (img) {
          const w = Math.min(600, img.w);
          out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: w, height: Math.round((img.h * w) / img.w) } })] }));
        }
        break;
      }
      case 'drawing': {
        const png = await drawingPng((n.attrs?.strokes as Stroke[]) ?? [], Number(n.attrs?.height) || 360);
        if (png) out.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: png.data, transformation: { width: 600, height: Math.round((png.h * 600) / png.w) } })] }));
        break;
      }
      case 'attachment':
        out.push(new Paragraph({ children: [new TextRun({ text: `📎 ${n.attrs?.name ?? ''}`, color: '5F5F66' })] }));
        break;
      case 'table': {
        const rows = await Promise.all(
          (n.content ?? []).map(
            async (r) =>
              new TableRow({
                children: await Promise.all(
                  (r.content ?? []).map(
                    async (c) =>
                      new TableCell({
                        shading: c.type === 'tableHeader' ? { type: ShadingType.CLEAR, fill: 'EEEEEB', color: 'auto' } : undefined,
                        children: ((await docxBlocks(c.content)) as Paragraph[]).filter((x) => x instanceof Paragraph).length ? ((await docxBlocks(c.content)) as Paragraph[]) : [new Paragraph('')],
                      }),
                  ),
                ),
              }),
          ),
        );
        if (rows.length) out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        break;
      }
      default:
        if (n.content) out.push(...(await docxBlocks(n.content, level, listRef)));
    }
  }
  return out;
}

async function toDocx(title: string, doc: JSONContent): Promise<ArrayBuffer> {
  const d = new Document({
    styles: { default: { document: { run: { font: 'Segoe UI', size: 22 } } } },
    numbering: {
      config: [
        { reference: 'bullets', levels: [0, 1, 2, 3, 4].map((level) => ({ level, format: LevelFormat.BULLET, text: ['•', '◦', '▪', '•', '◦'][level], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } } })) },
        { reference: 'numbers', levels: [0, 1, 2, 3, 4].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 300 } } } })) },
      ],
    },
    sections: [{ children: [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true })] }), ...(await docxBlocks(doc.content))] }],
  });
  return Packer.toArrayBuffer(d);
}

/**
 * Exporta una nota. Devuelve el nombre del archivo, null si la persona canceló, o false si falló.
 * `editor` es opcional: si la nota está abierta se usa su contenido más reciente.
 */
export async function exportNote(id: string, fmt: Fmt, editor: Editor | null): Promise<string | null | false> {
  try {
    const st = useStore.getState();
    const note = st.current?.id === id ? st.current : await api.notes.get(id);
    if (!note) return false;
    const doc = editor && st.current?.id === id ? editor.getJSON() : note.content;
    const title = note.title || translate(st.settings.language, 'app.untitled');
    const base = fileSafe(title);
    let path: string | null;
    if (fmt === 'md') {
      const md = `# ${title}\n\n${note.tags.length ? note.tags.map((t) => `#${t}`).join(' ') + '\n\n' : ''}${await toMd(doc)}`;
      path = await api.files.saveAs(`${base}.md`, md, [{ name: 'Markdown', extensions: ['md'] }]);
    } else if (fmt === 'docx') {
      path = await api.files.saveAs(`${base}.docx`, await toDocx(title, doc), [{ name: 'Word', extensions: ['docx'] }]);
    } else {
      const date = new Date(note.updatedAt).toLocaleDateString(st.settings.language, { dateStyle: 'long' });
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PDF_CSS}</style></head><body><h1 class="title">${esc(title)}</h1><div class="meta">${esc(date)}${note.tags.length ? ' · ' + note.tags.map((t) => '#' + esc(t)).join(' ') : ''}</div>${toHtml(doc)}</body></html>`;
      path = await api.files.pdf(`${base}.pdf`, html);
    }
    return path ? path.split(/[\\/]/).pop() ?? path : null;
  } catch (e) {
    console.error(e);
    return false;
  }
}
