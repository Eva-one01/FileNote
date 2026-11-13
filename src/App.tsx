import { useEffect, useState } from 'react';
import { UpdateBanner } from '@/components/UpdateBanner';
import { CommandPalette } from './components/CommandPalette';
import { NoteEditor } from './components/NoteEditor';
import { NoteList } from './components/NoteList';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { DialogHost, MenuHost } from './components/ui';
import { api, isDesktop } from './lib/api';
import { useT } from './lib/i18n';
import { useStore } from './lib/store';

/** Tema, color y tamaño de letra en <html> (y el color de la barra de título de la ventana). */
function useAppearance() {
  const { theme, accent, size, language } = useStore((s) => s.settings);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = dark ? 'dark' : 'light';
    r.dataset.accent = accent;
    r.dataset.size = size;
    r.lang = language;
    api.window.setTheme(dark);
  }, [dark, accent, size, language]);
}

function Toast() {
  const { t } = useT();
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => useStore.getState().hideToast(), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.action?.label === 'undo' ? `${t('toast.trashed')} ${toast.msg}` : toast.msg}</span>
      {toast.action ? (
        <button
          onClick={() => {
            toast.action!.run();
            useStore.getState().hideToast();
          }}
        >
          {toast.action.label === 'undo' ? t('toast.undo') : toast.action.label}
        </button>
      ) : null}
    </div>
  );
}

export function App() {
  const ready = useStore((s) => s.ready);
  const focus = useStore((s) => s.focus);
  const [settings, setSettings] = useState(false);
  useAppearance();

  useEffect(() => {
    void useStore.getState().load();
    // Guardar lo pendiente al cerrar la ventana.
    const flush = () => void useStore.getState().flush();
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // Atajos de teclado de toda la app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && (k === 'k' || k === 'p') && !e.shiftKey) {
        e.preventDefault();
        st.setPalette(!st.paletteOpen);
      } else if (mod && k === 'n') {
        e.preventDefault();
        void st.createNote();
      } else if (mod && e.shiftKey && k === 'f') {
        e.preventDefault();
        st.setFocus(!st.focus);
      } else if (e.key === 'Escape' && st.focus && !st.paletteOpen) {
        st.setFocus(false);
      } else if (e.key === 'Delete' && st.selectedId && st.current && !st.current.trashedAt) {
        const el = document.activeElement as HTMLElement | null;
        const typing = !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
        if (!typing) {
          e.preventDefault();
          void st.trash(st.selectedId);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return <div style={{ height: '100%', background: 'var(--bg)' }} />;
  return (
    <>
      {isDesktop ? <div className="titlebar" /> : null}
      <div className={`app${focus ? ' focus' : ''}`} style={isDesktop ? ({ '--titlebar': '34px' } as React.CSSProperties) : undefined}>
        <Sidebar onSettings={() => setSettings(true)} />
        <NoteList />
        <NoteEditor />
      </div>
      <CommandPalette />
      <UpdateBanner />
      <DialogHost />
      <MenuHost />
      <Toast />
      {settings ? <SettingsDialog onClose={() => setSettings(false)} /> : null}
    </>
  );
}
