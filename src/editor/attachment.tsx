import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { File, FileArchive, FileAudio, FileSpreadsheet, FileText, FileVideo, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { openPdf } from './PdfViewer';

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function iconFor(mime: string, name: string): LucideIcon {
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.startsWith('audio/')) return FileAudio;
  if (/pdf|text|word|document/.test(mime) || /\.(pdf|docx?|txt|md|rtf)$/i.test(name)) return FileText;
  if (/sheet|excel|csv/.test(mime) || /\.(xlsx?|csv)$/i.test(name)) return FileSpreadsheet;
  if (/zip|rar|7z|tar/.test(mime) || /\.(zip|rar|7z|tar|gz)$/i.test(name)) return FileArchive;
  return File;
}

function AttachmentView({ node, selected, editor, getPos }: NodeViewProps) {
  const { t } = useT();
  const { url, name, size, mime } = node.attrs as { url: string; name: string; size: number; mime: string };
  const Icon = iconFor(mime || '', name || '');
  const isPdf = /pdf/.test(mime || '') || /\.pdf$/i.test(name || '');
  // Los PDF se abren dentro de FileNote (para leer y subrayar); el resto, con su programa.
  const open = () => (isPdf ? openPdf({ url, name, editor: editor.isEditable ? editor : null, pos: typeof getPos === 'function' ? (getPos() ?? null) : null }) : void api.attachments.open(url));
  return (
    <NodeViewWrapper data-drag-handle>
      <div
        onDoubleClick={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 12px',
          borderRadius: 'var(--r-md)',
          border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: 'var(--surface)',
          maxWidth: 460,
          userSelect: 'none',
        }}
      >
        <span style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, borderRadius: 'var(--r-sm)', background: 'var(--accent-soft)', color: 'var(--accent)', flex: 'none' }}>
          <Icon size={20} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <span className="faint" style={{ fontSize: 12.5 }}>
            {formatSize(size || 0)}
          </span>
        </span>
        <button className="btn btn-ghost" style={{ height: 32, padding: '0 12px' }} onClick={open}>
          {isPdf ? t('pdf.read') : t('att.open')}
        </button>
      </div>
    </NodeViewWrapper>
  );
}

/** Archivo adjunto que no es imagen (PDF, Word, audio…). Se abre con el programa del sistema. */
export const Attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      url: { default: '' },
      name: { default: '' },
      size: { default: 0 },
      mime: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="attachment"]', getAttrs: (el) => ({ url: el.getAttribute('data-url'), name: el.getAttribute('data-name'), size: Number(el.getAttribute('data-size')) || 0, mime: el.getAttribute('data-mime') || '' }) }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'attachment', 'data-url': node.attrs.url, 'data-name': node.attrs.name, 'data-size': node.attrs.size, 'data-mime': node.attrs.mime }), `📎 ${node.attrs.name}`];
  },
  renderText({ node }) {
    return `📎 ${node.attrs.name}`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});
