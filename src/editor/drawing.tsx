import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Eraser, Highlighter, PenLine, Plus, Trash2, Undo2 } from 'lucide-react';
import { getStroke } from 'perfect-freehand';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/lib/i18n';

/** Un trazo: puntos [x, y, presión] en un lienzo de 800 de ancho. */
export interface Stroke {
  points: [number, number, number][];
  color: string;
  tool: 'pen' | 'marker';
}

const W = 800;
/** «ink» sigue el color del texto (se ve bien en claro y oscuro). */
const COLORS = ['ink', '#2E55E6', '#CC3D3D', '#16875A', '#E0A100', '#7240D6'];
const fill = (c: string) => (c === 'ink' ? 'var(--text)' : c);

function pathFor(s: Stroke): string {
  const pts = getStroke(s.points, {
    size: s.tool === 'marker' ? 16 : 3.2,
    thinning: s.tool === 'marker' ? 0 : 0.55,
    smoothing: 0.6,
    streamline: 0.45,
    simulatePressure: s.points.every((p) => p[2] === 0.5),
    last: true,
  });
  if (!pts.length) return '';
  const d = pts.reduce<(string | number)[]>(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...pts[0], 'Q'],
  );
  return d.join(' ') + ' Z';
}

function StrokesSvg({ strokes, height }: { strokes: Stroke[]; height: number }) {
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block' }}>
      {strokes.map((s, i) => (
        <path key={i} d={pathFor(s)} fill={fill(s.color)} opacity={s.tool === 'marker' ? 0.35 : 1} />
      ))}
    </svg>
  );
}

/** Lienzo a pantalla casi completa para dibujar con mouse, lápiz o dedo. */
function DrawingEditor({ initial, initialHeight, onDone }: { initial: Stroke[]; initialHeight: number; onDone: (s: Stroke[], h: number) => void }) {
  const { t } = useT();
  const [strokes, setStrokes] = useState<Stroke[]>(initial);
  const [history, setHistory] = useState<Stroke[][]>([]);
  const [height, setHeight] = useState(initialHeight);
  const [tool, setTool] = useState<'pen' | 'marker' | 'eraser'>('pen');
  const [color, setColor] = useState('ink');
  const live = useRef<Stroke | null>(null);
  const [, force] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);

  const toLocal = (e: React.PointerEvent): [number, number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    const k = W / r.width;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k, e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5];
  };
  const commit = (next: Stroke[]) => {
    setHistory((h) => [...h.slice(-49), strokes]);
    setStrokes(next);
  };
  const eraseAt = (x: number, y: number) => {
    const hit = strokes.filter((s) => !s.points.some((p) => Math.hypot(p[0] - x, p[1] - y) < (s.tool === 'marker' ? 14 : 10)));
    if (hit.length !== strokes.length) commit(hit);
  };

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toLocal(e);
    if (tool === 'eraser') return eraseAt(p[0], p[1]);
    live.current = { points: [p], color, tool };
    force((n) => n + 1);
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.buttons !== 1) return;
    const p = toLocal(e);
    if (tool === 'eraser') return eraseAt(p[0], p[1]);
    if (!live.current) return;
    live.current.points.push(p);
    force((n) => n + 1);
  };
  const up = () => {
    if (live.current && live.current.points.length > 0) commit([...strokes, live.current]);
    live.current = null;
  };
  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      setStrokes(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        undo();
      } else if (e.key === 'Escape') onDone(strokes, height);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [undo, onDone, strokes, height]);

  const all = live.current ? [...strokes, live.current] : strokes;
  return createPortal(
    <div className="scrim" style={{ paddingTop: '5vh' }} onMouseDown={(e) => e.target === e.currentTarget && onDone(strokes, height)}>
      <div className="palette" style={{ width: 'min(980px, calc(100vw - 40px))' }}>
        <div className="toolbar" style={{ borderBottom: '1px solid var(--border)' }}>
          <strong style={{ fontWeight: 900, marginRight: 10 }}>{t('draw.title')}</strong>
          <button className={`icon-btn${tool === 'pen' ? ' on' : ''}`} title={t('draw.pen')} onClick={() => setTool('pen')}>
            <PenLine size={18} />
          </button>
          <button className={`icon-btn${tool === 'marker' ? ' on' : ''}`} title={t('draw.marker')} onClick={() => setTool('marker')}>
            <Highlighter size={18} />
          </button>
          <button className={`icon-btn${tool === 'eraser' ? ' on' : ''}`} title={t('draw.eraser')} onClick={() => setTool('eraser')}>
            <Eraser size={18} />
          </button>
          <span className="sep" />
          {COLORS.map((c) => (
            <button
              key={c}
              className="icon-btn"
              aria-label={c}
              onClick={() => {
                setColor(c);
                if (tool === 'eraser') setTool('pen');
              }}
            >
              <span style={{ width: 18, height: 18, borderRadius: 9, background: fill(c), boxShadow: color === c ? '0 0 0 2px var(--surface), 0 0 0 4px var(--accent)' : 'none' }} />
            </button>
          ))}
          <span className="sep" />
          <button className="icon-btn" title={t('tb.undo')} onClick={undo} disabled={!history.length}>
            <Undo2 size={18} />
          </button>
          <button className="icon-btn" title={t('draw.clear')} onClick={() => commit([])} disabled={!strokes.length}>
            <Trash2 size={18} />
          </button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={() => onDone(strokes, height)}>
            {t('draw.done')}
          </button>
        </div>
        <div style={{ maxHeight: '72vh', overflowY: 'auto', background: 'var(--surface)' }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${height}`}
            width="100%"
            style={{ display: 'block', touchAction: 'none', cursor: tool === 'eraser' ? 'cell' : 'crosshair', backgroundImage: 'radial-gradient(var(--border-strong) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          >
            {all.map((s, i) => (
              <path key={i} d={pathFor(s)} fill={fill(s.color)} opacity={s.tool === 'marker' ? 0.35 : 1} />
            ))}
          </svg>
          <button className="btn btn-ghost" style={{ width: '100%', borderRadius: 0 }} onClick={() => setHeight((h) => h + 200)}>
            <Plus size={16} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DrawingView({ node, updateAttributes, selected }: NodeViewProps) {
  const { t } = useT();
  const strokes = (node.attrs.strokes as Stroke[]) || [];
  const height = (node.attrs.height as number) || 360;
  const [open, setOpen] = useState(!!node.attrs.autoOpen);
  useEffect(() => {
    if (node.attrs.autoOpen) updateAttributes({ autoOpen: false });
  }, [node.attrs.autoOpen, updateAttributes]);
  return (
    <NodeViewWrapper className="drawing" data-drag-handle>
      <div
        onDoubleClick={() => setOpen(true)}
        title={t('draw.edit')}
        style={{ position: 'relative', borderRadius: 'var(--r-md)', border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, overflow: 'hidden', cursor: 'pointer', minHeight: 60 }}
      >
        <StrokesSvg strokes={strokes} height={height} />
        {!strokes.length ? (
          <div className="faint" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 14 }}>
            {t('draw.edit')}
          </div>
        ) : null}
      </div>
      {open ? (
        <DrawingEditor
          initial={strokes}
          initialHeight={height}
          onDone={(s, h) => {
            setOpen(false);
            updateAttributes({ strokes: s, height: h });
          }}
        />
      ) : null}
    </NodeViewWrapper>
  );
}

export const Drawing = Node.create({
  name: 'drawing',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      strokes: { default: [], parseHTML: (el) => JSON.parse(el.getAttribute('data-strokes') || '[]'), renderHTML: (a) => ({ 'data-strokes': JSON.stringify(a.strokes) }) },
      height: { default: 360, parseHTML: (el) => Number(el.getAttribute('data-height')) || 360, renderHTML: (a) => ({ 'data-height': a.height }) },
      /** Al insertarlo desde la barra se abre el lienzo directamente. */
      autoOpen: { default: false, renderHTML: () => ({}) },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="drawing"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'drawing' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DrawingView);
  },
});

/** SVG del dibujo para exportar (PDF/Word/Markdown). */
export function drawingSvg(strokes: Stroke[], height: number, ink = '#0E0E10'): string {
  const paths = strokes.map((s) => `<path d="${pathFor(s)}" fill="${s.color === 'ink' ? ink : s.color}" ${s.tool === 'marker' ? 'opacity="0.35"' : ''}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}">${paths}</svg>`;
}
