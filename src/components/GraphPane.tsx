import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { Crosshair, Search, Waypoints } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { tagColor, useStore } from '@/lib/store';

interface GNode extends SimulationNodeDatum {
  id: string;
  title: string;
  degree: number;
  color: string | null;
}
type GLink = SimulationLinkDatum<GNode>;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Mapa de notas y sus enlaces [[…]]: arrastrar mueve, rueda acerca, clic abre la nota. */
export function GraphPane() {
  const { t } = useT();
  const notes = useStore((s) => s.notes);
  const theme = typeof document !== 'undefined' ? document.documentElement.dataset.theme : 'light';
  const [orphans, setOrphans] = useState(true);
  const [q, setQ] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<GNode | null>(null);
  const [hoverTitle, setHoverTitle] = useState<string | null>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const sim = useRef<Simulation<GNode, GLink> | null>(null);
  const draw = useRef<() => void>(() => {});
  const fitRef = useRef<() => void>(() => {});

  const { nodes, links } = useMemo(() => {
    const live = notes.filter((n) => !n.trashedAt && !n.template);
    const ids = new Set(live.map((n) => n.id));
    const links: GLink[] = [];
    const deg = new Map<string, number>();
    const seen = new Set<string>();
    for (const n of live)
      for (const to of n.links) {
        if (!ids.has(to) || to === n.id) continue;
        const key = n.id < to ? `${n.id}|${to}` : `${to}|${n.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ source: n.id, target: to });
        deg.set(n.id, (deg.get(n.id) ?? 0) + 1);
        deg.set(to, (deg.get(to) ?? 0) + 1);
      }
    const nodes: GNode[] = live
      .filter((n) => orphans || deg.get(n.id))
      .map((n) => ({ id: n.id, title: n.title || t('app.untitled'), degree: deg.get(n.id) ?? 0, color: n.tags[0] ? tagColor(n.tags[0]) : null }));
    const keep = new Set(nodes.map((n) => n.id));
    return { nodes, links: links.filter((l) => keep.has(l.source as string) && keep.has(l.target as string)) };
    // Solo se rehace si cambian títulos, enlaces o etiquetas (no al escribir texto).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useMemo(() => notes.map((n) => `${n.id}:${n.title}:${n.links.join(',')}:${n.tags[0] ?? ''}:${n.trashedAt ? 1 : 0}:${n.template ? 1 : 0}`).join('|'), [notes]), orphans]);

  useEffect(() => {
    const c = canvas.current;
    const box = wrap.current;
    if (!c || !box) return;
    const ctx = c.getContext('2d')!;
    let w = 0;
    let h = 0;
    const dpr = window.devicePixelRatio || 1;
    const size = () => {
      w = box.clientWidth;
      h = box.clientHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      draw.current();
    };
    const colors = { text: css('--text'), faint: css('--text-faint'), border: css('--border-strong'), accent: css('--accent'), bg: css('--surface') };
    const radius = (n: GNode) => 4 + Math.sqrt(n.degree) * 2.6;
    const fq = fold(q.trim());

    // Mantener las posiciones de los nodos que ya existían.
    const prev = new Map((sim.current?.nodes() ?? []).map((n) => [n.id, n]));
    for (const n of nodes) {
      const p = prev.get(n.id);
      if (p) Object.assign(n, { x: p.x, y: p.y, vx: p.vx, vy: p.vy });
    }
    sim.current?.stop();
    const s = forceSimulation<GNode>(nodes)
      .force('link', forceLink<GNode, GLink>(links).id((d) => d.id).distance(70).strength(0.6))
      .force('charge', forceManyBody().strength(-170))
      .force('center', forceCenter(0, 0))
      .force('x', forceX(0).strength(0.04))
      .force('y', forceY(0).strength(0.04))
      .force('collide', forceCollide<GNode>().radius((d) => radius(d) + 6));
    if (prev.size) s.alpha(0.3);
    sim.current = s;

    const neighbors = (n: GNode | null) => {
      const set = new Set<string>();
      if (!n) return set;
      set.add(n.id);
      for (const l of links) {
        const a = (l.source as GNode).id;
        const b = (l.target as GNode).id;
        if (a === n.id) set.add(b);
        if (b === n.id) set.add(a);
      }
      return set;
    };

    draw.current = () => {
      const { x, y, k } = view.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + x, h / 2 + y);
      ctx.scale(k, k);
      const hov = hoverRef.current;
      const near = neighbors(hov);
      const match = (n: GNode) => !fq || fold(n.title).includes(fq);
      const dim = (n: GNode) => (hov ? !near.has(n.id) : fq ? !match(n) : false);
      // Enlaces
      for (const l of links) {
        const a = l.source as GNode;
        const b = l.target as GNode;
        const on = hov && (a.id === hov.id || b.id === hov.id);
        ctx.globalAlpha = hov ? (on ? 0.95 : 0.08) : fq ? 0.15 : 0.55;
        ctx.strokeStyle = on ? colors.accent : colors.border;
        ctx.lineWidth = (on ? 1.8 : 1) / Math.sqrt(k);
        ctx.beginPath();
        ctx.moveTo(a.x!, a.y!);
        ctx.lineTo(b.x!, b.y!);
        ctx.stroke();
      }
      // Nodos
      for (const n of nodes) {
        const r = radius(n);
        ctx.globalAlpha = dim(n) ? 0.18 : 1;
        ctx.fillStyle = n.color ?? (n.degree ? colors.accent : colors.faint);
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
        ctx.fill();
        if (hov?.id === n.id || (fq && match(n))) {
          ctx.lineWidth = 2.5 / k;
          ctx.strokeStyle = colors.text;
          ctx.stroke();
        }
      }
      // Títulos: con zoom, al pasar el ratón, o los de las notas más enlazadas
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const fs = 12 / Math.max(0.6, Math.min(k, 1.6));
      ctx.font = `700 ${fs}px Nunito, system-ui, sans-serif`;
      for (const n of nodes) {
        const show = k > 1.15 || n.degree >= 3 || near.has(n.id) || (fq && match(n));
        if (!show) continue;
        ctx.globalAlpha = dim(n) ? 0.15 : near.has(n.id) || (fq && match(n)) ? 1 : 0.75;
        ctx.fillStyle = colors.text;
        const label = n.title.length > 34 ? `${n.title.slice(0, 32)}…` : n.title;
        ctx.fillText(label, n.x!, n.y! + radius(n) + 4);
      }
      ctx.globalAlpha = 1;
    };
    s.on('tick', () => draw.current());

    fitRef.current = () => {
      if (!nodes.length) return;
      const xs = nodes.map((n) => n.x ?? 0);
      const ys = nodes.map((n) => n.y ?? 0);
      const bw = Math.max(...xs) - Math.min(...xs) + 120;
      const bh = Math.max(...ys) - Math.min(...ys) + 120;
      const k = Math.min(2, Math.max(0.2, Math.min(w / bw, h / bh)));
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
      const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      animateTo({ k, x: -cx * k, y: -cy * k });
    };
    const animateTo = (to: { x: number; y: number; k: number }) => {
      const from = { ...view.current };
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 420);
        const e = 1 - Math.pow(1 - p, 3);
        view.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
        draw.current();
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if (!prev.size) setTimeout(() => fitRef.current(), 900);

    // Interacción
    const toWorld = (ev: { clientX: number; clientY: number }) => {
      const r = c.getBoundingClientRect();
      const { x, y, k } = view.current;
      return { x: (ev.clientX - r.left - w / 2 - x) / k, y: (ev.clientY - r.top - h / 2 - y) / k };
    };
    const hit = (ev: { clientX: number; clientY: number }) => {
      const p = toWorld(ev);
      let best: GNode | null = null;
      let bd = Infinity;
      for (const n of nodes) {
        const d = Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y);
        if (d < radius(n) + 6 / view.current.k && d < bd) [best, bd] = [n, d];
      }
      return best;
    };
    let drag: { node: GNode | null; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null = null;
    const down = (ev: PointerEvent) => {
      c.setPointerCapture(ev.pointerId);
      const node = hit(ev);
      drag = { node, sx: ev.clientX, sy: ev.clientY, vx: view.current.x, vy: view.current.y, moved: false };
      if (node) {
        s.alphaTarget(0.25).restart();
        node.fx = node.x;
        node.fy = node.y;
      }
    };
    const move = (ev: PointerEvent) => {
      if (drag) {
        if (Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 3) drag.moved = true;
        if (drag.node) {
          const p = toWorld(ev);
          drag.node.fx = p.x;
          drag.node.fy = p.y;
        } else {
          view.current = { ...view.current, x: drag.vx + ev.clientX - drag.sx, y: drag.vy + ev.clientY - drag.sy };
          draw.current();
        }
        return;
      }
      const n = hit(ev);
      if (n !== hoverRef.current) {
        hoverRef.current = n;
        setHoverTitle(n?.title ?? null);
        c.style.cursor = n ? 'pointer' : 'grab';
        draw.current();
      }
    };
    const up = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.node) {
        s.alphaTarget(0);
        d.node.fx = null;
        d.node.fy = null;
        if (!d.moved) void useStore.getState().select(d.node.id);
      }
    };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = c.getBoundingClientRect();
      const { x, y, k } = view.current;
      const nk = Math.min(4, Math.max(0.15, k * Math.exp(-ev.deltaY * 0.0015)));
      const mx = ev.clientX - r.left - w / 2;
      const my = ev.clientY - r.top - h / 2;
      view.current = { k: nk, x: mx - ((mx - x) / k) * nk, y: my - ((my - y) / k) * nk };
      draw.current();
    };
    const leave = () => {
      hoverRef.current = null;
      setHoverTitle(null);
      draw.current();
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointerleave', leave);
    c.addEventListener('wheel', wheel, { passive: false });
    const ro = new ResizeObserver(size);
    ro.observe(box);
    size();
    return () => {
      s.stop();
      ro.disconnect();
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointerleave', leave);
      c.removeEventListener('wheel', wheel);
    };
  }, [nodes, links, q, theme]);

  const linked = nodes.filter((n) => n.degree).length;
  return (
    <section className="wide-pane graph-pane">
      <div className="wide-head drag">
        <div className="wide-title">
          <Waypoints size={20} />
          <span>{t('graph.title')}</span>
          <span className="wide-sub tabular">{t('graph.count', { n: nodes.length, l: links.length })}</span>
        </div>
        <label className="graph-toggle no-drag">
          <input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} />
          {t('graph.orphans')}
        </label>
        <button className="icon-btn no-drag" title={t('graph.fit')} aria-label={t('graph.fit')} onClick={() => fitRef.current()}>
          <Crosshair size={17} />
        </button>
        <div className="wide-search no-drag">
          <Search size={15} />
          <input className="input" placeholder={t('graph.search')} aria-label={t('graph.search')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
        </div>
      </div>
      <div ref={wrap} className="graph-wrap">
        <canvas ref={canvas} aria-label={t('graph.title')} role="img" />
        {nodes.length === 0 || (!linked && !orphans) ? (
          <div className="empty graph-empty">
            <div>
              <Waypoints size={34} color="var(--text-faint)" />
              <h3>{t('graph.emptyT')}</h3>
              <div>{t('graph.emptyB')}</div>
            </div>
          </div>
        ) : null}
        {hoverTitle ? <div className="graph-tip">{hoverTitle}</div> : <div className="graph-hint">{t('graph.hint')}</div>}
      </div>
    </section>
  );
}
