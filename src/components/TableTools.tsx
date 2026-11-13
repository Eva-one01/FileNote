import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine, ArrowUpToLine, Columns3, Combine, Heading, Rows3, Table2, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n';

const MAX = 8;

/** Botón «Tabla» con una cuadrícula para elegir filas × columnas (como en Word). */
export function TableButton({ editor, title }: { editor: Editor; title: string }) {
  const { t } = useT();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<[number, number]>([3, 3]);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos({ left: Math.min(r.left, window.innerWidth - 260), top: r.bottom + 6 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as HTMLElement).closest('.table-picker, .table-btn')) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const insert = (rows: number, cols: number) => {
    setOpen(false);
    const sel = editor.state.selection;
    const c = editor.chain().focus();
    (sel instanceof NodeSelection ? c.setTextSelection(sel.to) : c).insertTable({ rows, cols, withHeaderRow: true }).run();
  };

  return (
    <>
      <button
        ref={btn}
        className={`icon-btn table-btn${open ? ' on' : ''}`}
        title={title}
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <Table2 size={18} />
      </button>
      {open
        ? createPortal(
            <div className="table-picker" role="dialog" aria-label={title} style={{ left: pos.left, top: pos.top }}>
              <div className="tp-grid" onMouseLeave={() => setHover([3, 3])}>
                {Array.from({ length: MAX * MAX }, (_, i) => {
                  const r = Math.floor(i / MAX) + 1;
                  const c = (i % MAX) + 1;
                  const on = r <= hover[0] && c <= hover[1];
                  return (
                    <button
                      key={i}
                      className={`tp-cell${on ? ' on' : ''}`}
                      aria-label={`${r} × ${c}`}
                      onMouseEnter={() => setHover([r, c])}
                      onFocus={() => setHover([r, c])}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insert(r, c)}
                    />
                  );
                })}
              </div>
              <div className="tp-label tabular">
                {t('table.size', { r: hover[0], c: hover[1] })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function B({ title, onClick, children, danger, on }: { title: string; onClick: () => void; children: ReactNode; danger?: boolean; on?: boolean }) {
  return (
    <button className={`icon-btn${danger ? ' danger' : ''}${on ? ' on' : ''}`} title={title} aria-label={title} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

/** Barra flotante encima de la tabla en la que está el cursor: filas, columnas, encabezado, combinar y borrar. */
export function TableBar({ editor }: { editor: Editor }) {
  const { t } = useT();
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      inTable: e.isActive('table') && e.isEditable,
      focused: e.isFocused,
      sel: e.state.selection.from,
      canMerge: e.can().mergeCells(),
      canSplit: e.can().splitCell(),
      header: e.isActive('tableHeader'),
    }),
  });
  const [top, setTop] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!s.inTable) return setTop(null);
    const at = editor.view.domAtPos(editor.state.selection.from).node as HTMLElement;
    const el = (at.nodeType === 1 ? at : at.parentElement)?.closest('.tableWrapper, table') as HTMLElement | null;
    const doc = bar.current?.offsetParent as HTMLElement | null;
    if (!el || !doc) return setTop(null);
    const r = el.getBoundingClientRect();
    const d = doc.getBoundingClientRect();
    setTop(r.bottom - d.top + 8);
  }, [s.inTable, s.sel, editor]);

  const c = () => editor.chain().focus();
  const I = 16;
  return (
    <div ref={bar} className={`table-bar${s.inTable && top !== null ? ' show' : ''}`} style={{ top: top ?? 0 }} role="toolbar" aria-label={t('tb.table')}>
      <B title={t('table.rowAbove')} onClick={() => c().addRowBefore().run()}>
        <ArrowUpToLine size={I} />
      </B>
      <B title={t('table.rowBelow')} onClick={() => c().addRowAfter().run()}>
        <ArrowDownToLine size={I} />
      </B>
      <B title={t('table.colLeft')} onClick={() => c().addColumnBefore().run()}>
        <ArrowLeftToLine size={I} />
      </B>
      <B title={t('table.colRight')} onClick={() => c().addColumnAfter().run()}>
        <ArrowRightToLine size={I} />
      </B>
      <span className="sep" />
      <B title={t('table.header')} on={s.header} onClick={() => c().toggleHeaderRow().run()}>
        <Heading size={I} />
      </B>
      <B title={s.canSplit && !s.canMerge ? t('table.split') : t('table.merge')} onClick={() => c().mergeOrSplit().run()}>
        <Combine size={I} />
      </B>
      <span className="sep" />
      <B title={t('tb.delRow')} onClick={() => c().deleteRow().run()}>
        <Rows3 size={I} />
      </B>
      <B title={t('tb.delCol')} onClick={() => c().deleteColumn().run()}>
        <Columns3 size={I} />
      </B>
      <B title={t('tb.delTable')} danger onClick={() => c().deleteTable().run()}>
        <Trash2 size={I} />
      </B>
    </div>
  );
}
