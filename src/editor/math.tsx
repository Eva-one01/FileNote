import type { Editor } from '@tiptap/core';
import katex from 'katex';
import { Sigma, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useT } from '@/lib/i18n';

/** Editor activo (solo hay uno a la vez): lo usan los clics sobre una fórmula. */
let active: Editor | null = null;
export const setActiveEditor = (e: Editor | null) => {
  active = e;
};

interface MathReq {
  latex: string;
  block: boolean;
  /** Posición de una fórmula existente; sin ella se inserta una nueva. */
  pos: number | null;
  editor: Editor;
}
const useMath = create<{ req: MathReq | null; set: (r: MathReq | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

export function openMath(req: Omit<MathReq, 'editor'> & { editor?: Editor }) {
  const editor = req.editor ?? active;
  if (editor) useMath.getState().set({ ...req, editor });
}

/** Clic en una fórmula del documento → se abre para editarla. */
export const mathClick = (block: boolean) => (node: { attrs: Record<string, unknown> }, pos: number) => {
  if (!active?.isEditable) return;
  openMath({ latex: String(node.attrs.latex ?? ''), block, pos });
};

export function renderLatex(latex: string, displayMode: boolean, output: 'html' | 'mathml' = 'html') {
  try {
    return katex.renderToString(latex || '\\square', { displayMode, throwOnError: true, output });
  } catch {
    return null;
  }
}

/** Atajos para quien no sabe LaTeX de memoria. */
const SNIPPETS: { label: string; tex: string }[] = [
  { label: 'a/b', tex: '\\frac{a}{b}' },
  { label: 'x²', tex: 'x^{2}' },
  { label: 'xᵢ', tex: 'x_{i}' },
  { label: '√', tex: '\\sqrt{x}' },
  { label: 'Σ', tex: '\\sum_{i=1}^{n}' },
  { label: '∫', tex: '\\int_{a}^{b}' },
  { label: 'lim', tex: '\\lim_{x \\to 0}' },
  { label: '≤', tex: '\\leq' },
  { label: '≥', tex: '\\geq' },
  { label: '≠', tex: '\\neq' },
  { label: '±', tex: '\\pm' },
  { label: '×', tex: '\\times' },
  { label: '÷', tex: '\\div' },
  { label: '∞', tex: '\\infty' },
  { label: 'π', tex: '\\pi' },
  { label: 'α', tex: '\\alpha' },
  { label: 'β', tex: '\\beta' },
  { label: 'θ', tex: '\\theta' },
  { label: 'Δ', tex: '\\Delta' },
  { label: '→', tex: '\\rightarrow' },
  { label: '( )', tex: '\\left( x \\right)' },
  { label: '[ ]', tex: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}' },
];

/** Ventana para escribir o editar una fórmula con vista previa en vivo. */
export function MathDialog() {
  const { t } = useT();
  const req = useMath((s) => s.req);
  const [tex, setTex] = useState('');
  const [block, setBlock] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!req) return;
    setTex(req.latex);
    setBlock(req.block);
    setTimeout(() => area.current?.focus(), 30);
  }, [req]);

  const preview = useMemo(() => renderLatex(tex, block), [tex, block]);
  if (!req) return null;

  const close = () => {
    useMath.getState().set(null);
    req.editor.commands.focus();
  };
  const save = () => {
    const latex = tex.trim();
    const e = req.editor;
    if (!latex) return close();
    if (req.pos === null) {
      if (block) e.chain().focus().insertBlockMath({ latex }).run();
      else e.chain().focus().insertInlineMath({ latex }).run();
    } else if (block === req.block) {
      if (block) e.chain().focus().updateBlockMath({ latex, pos: req.pos }).run();
      else e.chain().focus().updateInlineMath({ latex, pos: req.pos }).run();
    } else {
      // Cambió de «en línea» a «en bloque» (o al revés): se reemplaza.
      const chain = e.chain().focus();
      (req.block ? chain.deleteBlockMath({ pos: req.pos }) : chain.deleteInlineMath({ pos: req.pos })).run();
      if (block) e.chain().focus().insertBlockMath({ latex }).run();
      else e.chain().focus().insertInlineMath({ latex }).run();
    }
    useMath.getState().set(null);
  };
  const remove = () => {
    if (req.pos === null) return close();
    const chain = req.editor.chain().focus();
    (req.block ? chain.deleteBlockMath({ pos: req.pos }) : chain.deleteInlineMath({ pos: req.pos })).run();
    useMath.getState().set(null);
  };
  const insert = (snippet: string) => {
    const el = area.current;
    if (!el) return setTex((x) => x + snippet);
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const next = tex.slice(0, a) + snippet + tex.slice(b);
    setTex(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + snippet.length, a + snippet.length);
    });
  };

  return createPortal(
    <div className="scrim scrim-top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog math-dialog" role="dialog" aria-label={t('math.title')} onKeyDown={(e) => (e.key === 'Escape' ? close() : e.key === 'Enter' && (e.ctrlKey || e.metaKey) ? save() : undefined)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sigma size={18} color="var(--accent)" />
          <h3 style={{ flex: 1, margin: 0 }}>{t('math.title')}</h3>
          <button className="icon-btn" aria-label={t('set.close')} onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className={`math-preview${preview ? '' : ' bad'}`} dangerouslySetInnerHTML={{ __html: preview ?? `<span>${t('math.error')}</span>` }} />
        <div className="math-snippets">
          {SNIPPETS.map((s) => (
            <button key={s.tex} className="math-chip" title={s.tex} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(s.tex)}>
              {s.label}
            </button>
          ))}
        </div>
        <textarea ref={area} className="input math-input" spellCheck={false} placeholder="E = mc^2" value={tex} onChange={(e) => setTex(e.target.value)} rows={3} />
        <div className="math-foot">
          <label className="math-block">
            <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} />
            {t('math.block')}
          </label>
          <span className="faint" style={{ fontSize: 12 }}>
            {t('math.hint')}
          </span>
        </div>
        <div className="dialog-actions">
          {req.pos !== null ? (
            <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={remove}>
              <Trash2 size={15} /> {t('dlg.delete')}
            </button>
          ) : null}
          <button className="btn btn-ghost" onClick={close}>
            {t('dlg.cancel')}
          </button>
          <button className="btn btn-primary" onClick={save}>
            {t('dlg.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
