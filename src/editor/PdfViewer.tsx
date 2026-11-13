import type { Editor } from '@tiptap/core';
import { ExternalLink, FileText, Highlighter, ListPlus, Minus, MoveHorizontal, Plus, Trash2, X } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { api, type PdfHighlight } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { uid, useStore } from '@/lib/store';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface PdfReq {
  url: string;
  name: string;
  editor: Editor | null;
  /** Posición del adjunto en la nota (las citas se insertan justo después). */
  pos: number | null;
}
const usePdf = create<{ req: PdfReq | null; set: (r: PdfReq | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));
export const openPdf = (req: PdfReq) => usePdf.getState().set(req);

const COLORS: PdfHighlight['color'][] = ['yellow', 'green', 'blue', 'pink'];

/** Una página: lienzo + capa de texto seleccionable + resaltados. Se dibuja solo cuando se ve. */
function Page({ doc, index, scale, width, height, highlights, active, onPick }: { doc: PDFDocumentProxy; index: number; scale: number; width: number; height: number; highlights: PdfHighlight[]; active: string | null; onPick: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    void (async () => {
      const page = await doc.getPage(index + 1);
      if (cancelled) return;
      const vp = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      const c = canvas.current!;
      c.width = Math.floor(vp.width * dpr);
      c.height = Math.floor(vp.height * dpr);
      const r = page.render({ canvas: c, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      task = r;
      try {
        await r.promise;
      } catch {
        return;
      }
      if (cancelled || !text.current) return;
      text.current.replaceChildren();
      text.current.style.setProperty('--total-scale-factor', String(scale));
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text.current, viewport: vp });
      await tl.render().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, doc, index, scale]);

  return (
    <div ref={box} className="pdf-page" data-page={index + 1} style={{ width, height }}>
      <canvas ref={canvas} style={{ width, height }} />
      <div className="pdf-hl-layer">
        {highlights.map((h) =>
          h.rects.map((r, i) => (
            <div
              key={`${h.id}:${i}`}
              className={`pdf-hl c-${h.color}${active === h.id ? ' on' : ''}`}
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(h.id);
              }}
            />
          )),
        )}
      </div>
      <div ref={text} className="pdf-text" />
    </div>
  );
}

/** Visor de PDF a pantalla completa: leer, resaltar, comentar y llevar las citas a la nota. */
export function PdfViewer() {
  const { t } = useT();
  const req = usePdf((s) => s.req);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [scale, setScale] = useState(1.2);
  const [error, setError] = useState(false);
  const [hls, setHls] = useState<PdfHighlight[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [sel, setSel] = useState<{ x: number; y: number; page: number; rects: PdfHighlight['rects']; text: string } | null>(null);
  const pages = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Abrir el documento y sus anotaciones.
  useEffect(() => {
    if (!req) return;
    let alive = true;
    let loaded: PDFDocumentProxy | null = null;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    setDoc(null);
    setError(false);
    setHls([]);
    setActive(null);
    void (async () => {
      try {
        const data = await (await fetch(req.url)).arrayBuffer();
        task = pdfjs.getDocument({ data });
        loaded = await task.promise;
        const first = await loaded.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        const all: { w: number; h: number }[] = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          // Las páginas suelen medir lo mismo; las distintas se corrigen al leerlas.
          const p = i === 1 ? first : await loaded.getPage(i);
          const v = i === 1 ? vp : p.getViewport({ scale: 1 });
          all.push({ w: v.width, h: v.height });
        }
        const list = (await api.annotations?.get(req.url)) ?? [];
        if (!alive) return;
        setSizes(all);
        setDoc(loaded);
        setHls(list);
        // Ajustar al ancho disponible.
        const avail = (pages.current?.clientWidth ?? 900) - 64;
        setScale(Math.max(0.6, Math.min(2, avail / vp.width)));
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
      void task?.destroy();
    };
  }, [req]);

  const persist = useCallback(
    (next: PdfHighlight[]) => {
      setHls(next);
      if (!req) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void api.annotations?.save(req.url, next), 300);
    },
    [req],
  );

  // Selección de texto → barrita para resaltar.
  const onMouseUp = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return setSel(null);
    const range = s.getRangeAt(0);
    const pageEl = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest('.pdf-page') as HTMLElement | null;
    const text = s.toString().replace(/\s+/g, ' ').trim();
    if (!pageEl || !text) return setSel(null);
    const pr = pageEl.getBoundingClientRect();
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({ x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height }));
    if (!rects.length) return setSel(null);
    const last = range.getBoundingClientRect();
    setSel({ x: last.left + last.width / 2, y: last.top, page: Number(pageEl.dataset.page), rects, text });
  };
  const addHighlight = (color: PdfHighlight['color']) => {
    if (!sel) return;
    const h: PdfHighlight = { id: uid(), page: sel.page, rects: sel.rects, text: sel.text.slice(0, 4000), color, comment: '', createdAt: Date.now() };
    persist([...hls, h].sort((a, b) => a.page - b.page || a.rects[0].y - b.rects[0].y));
    setActive(h.id);
    setSel(null);
    window.getSelection()?.removeAllRanges();
  };

  const goTo = (h: PdfHighlight) => {
    setActive(h.id);
    const el = pages.current?.querySelector(`.pdf-page[data-page="${h.page}"]`) as HTMLElement | null;
    if (el && pages.current) pages.current.scrollTo({ top: el.offsetTop + h.rects[0].y * el.offsetHeight - 120, behavior: 'smooth' });
  };

  /** Lleva las citas a la nota, justo después del PDF (o al final). */
  const toNote = (list: PdfHighlight[]) => {
    const e = req?.editor;
    if (!e || !list.length) return;
    const nodes = list.flatMap((h) => [
      {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: h.text, ...(h.color === 'yellow' ? { marks: [{ type: 'highlight' }] } : {}) },
              { type: 'text', text: ` — ${req!.name}, ${t('pdf.page', { n: h.page })}`, marks: [{ type: 'italic' }] },
            ],
          },
        ],
      },
      ...(h.comment.trim() ? [{ type: 'paragraph', content: [{ type: 'text', text: h.comment.trim() }] }] : []),
    ]);
    const node = req!.pos !== null ? e.state.doc.nodeAt(req!.pos) : null;
    const at = node ? req!.pos! + node.nodeSize : e.state.doc.content.size;
    e.chain().insertContentAt(at, nodes).run();
    useStore.getState().showToast(t('pdf.added', { n: list.length }));
  };

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(document.activeElement instanceof HTMLTextAreaElement)) usePdf.getState().set(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  if (!req) return null;
  const close = () => usePdf.getState().set(null);

  return createPortal(
    <div className="pdf-viewer" role="dialog" aria-label={req.name}>
      <div className="pdf-head">
        <FileText size={18} color="var(--accent)" />
        <span className="pdf-name">{req.name}</span>
        {doc ? <span className="faint tabular" style={{ fontSize: 12.5 }}>{t('pdf.pages', { n: doc.numPages })}</span> : null}
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title={t('pdf.zoomOut')} aria-label={t('pdf.zoomOut')} onClick={() => setScale((s) => Math.max(0.5, +(s - 0.15).toFixed(2)))}>
          <Minus size={16} />
        </button>
        <span className="tabular pdf-zoom">{Math.round(scale * 100)} %</span>
        <button className="icon-btn" title={t('pdf.zoomIn')} aria-label={t('pdf.zoomIn')} onClick={() => setScale((s) => Math.min(3, +(s + 0.15).toFixed(2)))}>
          <Plus size={16} />
        </button>
        <button className="icon-btn" title={t('pdf.fit')} aria-label={t('pdf.fit')} onClick={() => sizes[0] && setScale(Math.max(0.6, Math.min(2.5, ((pages.current?.clientWidth ?? 900) - 64) / sizes[0].w)))}>
          <MoveHorizontal size={16} />
        </button>
        <button className="icon-btn" title={t('pdf.external')} aria-label={t('pdf.external')} onClick={() => void api.attachments.open(req.url)}>
          <ExternalLink size={16} />
        </button>
        <button className="icon-btn" title={`${t('set.close')} (Esc)`} aria-label={t('set.close')} onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div className="pdf-body">
        <div ref={pages} className="pdf-pages" onMouseUp={onMouseUp} onScroll={() => sel && setSel(null)}>
          {error ? (
            <div className="empty">
              <div>
                <h3>{t('pdf.error')}</h3>
                <button className="btn btn-soft btn-sm" style={{ marginTop: 10 }} onClick={() => void api.attachments.open(req.url)}>
                  <ExternalLink size={14} /> {t('pdf.external')}
                </button>
              </div>
            </div>
          ) : !doc ? (
            <div className="empty">
              <div className="faint">{t('pdf.loading')}</div>
            </div>
          ) : (
            sizes.map((s, i) => (
              <Page key={i} doc={doc} index={i} scale={scale} width={Math.round(s.w * scale)} height={Math.round(s.h * scale)} highlights={hls.filter((h) => h.page === i + 1)} active={active} onPick={(id) => goTo(hls.find((h) => h.id === id)!)} />
            ))
          )}
        </div>
        <aside className="pdf-side">
          <div className="pdf-side-head">
            <Highlighter size={16} />
            <b>{t('pdf.highlights')}</b>
            <span className="faint tabular">{hls.length}</span>
            <span style={{ flex: 1 }} />
            {hls.length && req.editor ? (
              <button className="btn btn-soft btn-sm" onClick={() => toNote(hls)} title={t('pdf.allToNoteHint')}>
                <ListPlus size={14} /> {t('pdf.allToNote')}
              </button>
            ) : null}
          </div>
          <div className="pdf-side-list">
            {!hls.length ? <p className="set-hint" style={{ padding: '4px 4px 0' }}>{t('pdf.hint')}</p> : null}
            {hls.map((h) => (
              <div key={h.id} className={`pdf-item${active === h.id ? ' on' : ''}`} onClick={() => goTo(h)}>
                <div className="pdf-item-top">
                  <i className={`dot c-${h.color}`} />
                  <span className="faint tabular">{t('pdf.page', { n: h.page })}</span>
                  <span style={{ flex: 1 }} />
                  {req.editor ? (
                    <button className="icon-btn" title={t('pdf.toNote')} aria-label={t('pdf.toNote')} onClick={(e) => (e.stopPropagation(), toNote([h]))}>
                      <ListPlus size={15} />
                    </button>
                  ) : null}
                  <button className="icon-btn" title={t('dlg.delete')} aria-label={t('dlg.delete')} onClick={(e) => (e.stopPropagation(), persist(hls.filter((x) => x.id !== h.id)))}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <blockquote className={`c-${h.color}`}>{h.text}</blockquote>
                <textarea
                  className="pdf-comment"
                  placeholder={t('pdf.comment')}
                  value={h.comment}
                  rows={h.comment ? 2 : 1}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => persist(hls.map((x) => (x.id === h.id ? { ...x, comment: e.target.value } : x)))}
                />
              </div>
            ))}
          </div>
        </aside>
      </div>
      {sel ? (
        <div className="pdf-pop" style={{ left: sel.x, top: Math.max(60, sel.y - 46) }} onMouseDown={(e) => e.preventDefault()}>
          <Highlighter size={15} />
          {COLORS.map((c) => (
            <button key={c} className={`swatch c-${c}`} aria-label={`${t('pdf.highlight')} ${c}`} title={t('pdf.highlight')} onClick={() => addHighlight(c)} />
          ))}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
