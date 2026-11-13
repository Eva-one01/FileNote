import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useT } from '@/lib/i18n';

/* ───────── Diálogos (confirmar y pedir un texto) ───────── */

type DialogReq =
  | { kind: 'confirm'; title: string; body?: string; ok: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; label?: string; value: string; ok: string; resolve: (v: string | null) => void };

const useDialogs = create<{ req: DialogReq | null; set: (r: DialogReq | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

export function confirmDialog(o: { title: string; body?: string; ok: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => useDialogs.getState().set({ kind: 'confirm', ...o, resolve }));
}
export function promptDialog(o: { title: string; label?: string; value?: string; ok: string }): Promise<string | null> {
  return new Promise((resolve) => useDialogs.getState().set({ kind: 'prompt', value: '', ...o, resolve }));
}

export function DialogHost() {
  const { t } = useT();
  const req = useDialogs((s) => s.req);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (req?.kind === 'prompt') {
      setValue(req.value);
      setTimeout(() => input.current?.select(), 30);
    }
  }, [req]);
  if (!req) return null;
  const close = (v: boolean) => {
    useDialogs.getState().set(null);
    if (req.kind === 'confirm') req.resolve(v);
    else req.resolve(v && value.trim() ? value.trim() : null);
  };
  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close(false)} onKeyDown={(e) => e.key === 'Escape' && close(false)}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        onSubmit={(e) => {
          e.preventDefault();
          close(true);
        }}
      >
        <h3>{req.title}</h3>
        {req.kind === 'confirm' && req.body ? <p>{req.body}</p> : null}
        {req.kind === 'prompt' ? <input ref={input} className="input" aria-label={req.label ?? req.title} placeholder={req.label} value={value} onChange={(e) => setValue(e.target.value)} autoFocus /> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
            {t('dlg.cancel')}
          </button>
          <button type="submit" className={`btn ${req.kind === 'confirm' && req.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus={req.kind === 'confirm'}>
            {req.ok}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/* ───────── Menús flotantes (botón «…» y clic derecho) ───────── */

export interface MenuEntry {
  label?: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  checked?: boolean;
  onClick?: () => void;
  sep?: boolean;
  /** Submenú (se despliega dentro del mismo menú). */
  children?: MenuEntry[];
}

const useMenus = create<{ menu: { x: number; y: number; items: MenuEntry[] } | null; set: (m: { x: number; y: number; items: MenuEntry[] } | null) => void }>((set) => ({
  menu: null,
  set: (menu) => set({ menu }),
}));

export function openMenu(x: number, y: number, items: MenuEntry[]) {
  useMenus.getState().set({ x, y, items });
}
/** Abre el menú debajo de un botón. */
export function openMenuAt(el: HTMLElement, items: MenuEntry[], align: 'left' | 'right' = 'left') {
  const r = el.getBoundingClientRect();
  openMenu(align === 'right' ? r.right : r.left, r.bottom + 6, align === 'right' ? items.map((i) => ({ ...i })) : items);
  useMenus.setState((s) => (s.menu ? { menu: { ...s.menu, x: align === 'right' ? r.right - 240 : r.left } } : s));
}

export function MenuHost() {
  const menu = useMenus((s) => s.menu);
  const [stack, setStack] = useState<MenuEntry[][]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => setStack(menu ? [menu.items] : []), [menu]);
  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)) });
  }, [menu, stack]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (ref.current && e.target instanceof globalThis.Node && ref.current.contains(e.target)) return;
      useMenus.getState().set(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && useMenus.getState().set(null);
    window.addEventListener('mousedown', close, true);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', close);
    };
  }, [menu]);
  if (!menu || !stack.length) return null;
  const items = stack[stack.length - 1];
  return createPortal(
    <div ref={ref} className="menu" role="menu" style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item${it.danger ? ' danger' : ''}`}
            onClick={() => {
              if (it.children) return setStack((s) => [...s, it.children!]);
              useMenus.getState().set(null);
              it.onClick?.();
            }}
          >
            {it.icon}
            <span style={{ flex: 1 }}>{it.label}</span>
            {it.checked ? <span style={{ color: 'var(--accent)', fontWeight: 900 }}>✓</span> : null}
            {it.hint ? <span className="hint">{it.hint}</span> : null}
            {it.children ? <span className="hint">›</span> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
