import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { FilePlus2, FileText } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { translate } from '@/lib/i18n';
import { useStore } from '@/lib/store';

export interface LinkItem {
  id: string;
  title: string;
  /** true: «Crear nota …» con el texto escrito. */
  create?: boolean;
  snippet?: string;
}

interface Handle {
  onKeyDown(e: KeyboardEvent): boolean;
}

/** Lista que aparece al escribir [[ : notas que coinciden y, al final, crear una nueva. */
const Menu = forwardRef<Handle, { items: LinkItem[]; command: (i: LinkItem) => void; query: string }>(function Menu({ items, command, query }, ref) {
  const [sel, setSel] = useState(0);
  const lang = useStore((s) => s.settings.language);
  useEffect(() => setSel(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown(e) {
      if (e.key === 'ArrowDown') return setSel((i) => (i + 1) % Math.max(1, items.length)), true;
      if (e.key === 'ArrowUp') return setSel((i) => (i - 1 + items.length) % Math.max(1, items.length)), true;
      if (e.key === 'Enter' || e.key === 'Tab') {
        const it = items[sel];
        if (it) command(it);
        return true;
      }
      return false;
    },
  }));
  return (
    <div className="menu" style={{ position: 'static' }} role="listbox">
      {items.length === 0 ? <div className="menu-empty">{translate(lang, 'link.none')}</div> : null}
      {items.map((it, i) => (
        <button
          key={it.create ? '__new' : it.id}
          className={`menu-item${i === sel ? ' on' : ''}`}
          role="option"
          aria-selected={i === sel}
          onMouseEnter={() => setSel(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            command(it);
          }}
        >
          {it.create ? <FilePlus2 size={16} color="var(--accent)" /> : <FileText size={16} color="var(--text-faint)" />}
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {it.create ? translate(lang, 'link.create', { q: query.trim() }) : it.title || translate(lang, 'app.untitled')}
          </span>
        </button>
      ))}
    </div>
  );
});

/** Monta el menú flotante junto al cursor (lo usa @tiptap/suggestion). */
export function suggestRenderer() {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;
  let handle: Handle | null = null;

  const place = (rect: DOMRect | null | undefined) => {
    if (!host || !rect) return;
    const below = window.innerHeight - rect.bottom > 340;
    host.style.left = `${Math.min(rect.left, window.innerWidth - 340)}px`;
    host.style.top = below ? `${rect.bottom + 6}px` : '';
    host.style.bottom = below ? '' : `${window.innerHeight - rect.top + 6}px`;
  };
  const draw = (p: SuggestionProps<LinkItem>) => {
    root?.render(<Menu ref={(h) => void (handle = h)} items={p.items} command={(i) => p.command(i)} query={p.query} />);
    place(p.clientRect?.());
  };

  return {
    onStart(p: SuggestionProps<LinkItem>) {
      host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.zIndex = '60';
      document.body.appendChild(host);
      root = createRoot(host);
      draw(p);
    },
    onUpdate(p: SuggestionProps<LinkItem>) {
      draw(p);
    },
    onKeyDown(p: SuggestionKeyDownProps) {
      if (p.event.key === 'Escape') {
        this.onExit();
        return true;
      }
      return handle?.onKeyDown(p.event) ?? false;
    },
    onExit() {
      const r = root;
      const h = host;
      root = null;
      host = null;
      handle = null;
      // Se desmonta después del ciclo actual de React.
      setTimeout(() => {
        r?.unmount();
        h?.remove();
      }, 0);
    },
  };
}
