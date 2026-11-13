import { useEffect, useState } from 'react';
import { TitleBarUpdate, UpdateBanner } from '@/components/UpdateBanner';
import { CommandPalette } from './components/CommandPalette';
import { Tour } from './components/Tour';
import { MathDialog } from './editor/math';
import { PdfViewer } from './editor/PdfViewer';
import { SendToClipsy } from './components/SendToClipsy';
import { GraphPane } from './components/GraphPane';
import { TasksPane } from './components/TasksPane';
import { StudyPane } from './components/StudyPane';
import { NoteEditor } from './components/NoteEditor';
import { NoteList } from './components/NoteList';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { DialogHost, MenuHost } from './components/ui';
import { api, isDesktop } from './lib/api';
import { useT } from './lib/i18n';
import { useStore } from './lib/store';

/** Tema, color y tamaño de letra en <html> (y el color de la barra de título de la ventana). */
export function useAppearance(ownWindow = true) {
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
    if (ownWindow) {
      api.window.setTheme(dark);
      api.prefs?.lang(language);
    }
  }, [dark, accent, size, language, ownWindow]);
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
  const view = useStore((s) => s.view);
  const [settings, setSettings] = useState(false);
  useAppearance();

  useEffect(() => {
    void useStore.getState().load().then(() => api.ready?.());
    // Avisos del proceso principal: nota guardada desde la captura rápida, «Nota de hoy» desde la bandeja…
    const off = api.events?.on((ev) => {
      if (ev.type === 'notes-changed') void useStore.getState().refresh(ev.select);
      else if (ev.type === 'daily') void useStore.getState().openDaily();
      else if (ev.type === 'new-note') void useStore.getState().createNote();
      else if (ev.type === 'open-note') void useStore.getState().select(ev.id);
      else if (ev.type === 'meeting') void useStore.getState().openMeeting(ev);
    });
    // Guardar lo pendiente al cerrar la ventana.
    const flush = () => void useStore.getState().flush();
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      off?.();
    };
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
      } else if (mod && e.shiftKey && k === 'j') {
        e.preventDefault();
        void st.openDaily();
      } else if (mod && k === 'n' && !e.shiftKey) {
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
      {isDesktop ? (
        <div className={`titlebar${api.platform === 'win32' ? ' win' : ''}`} style={{ '--titlebar': '34px' } as React.CSSProperties}>
          <TitleBarUpdate />
        </div>
      ) : null}
      <div className={`app${focus ? ' focus' : ''}`} style={isDesktop ? ({ '--titlebar': '34px' } as React.CSSProperties) : undefined}>
        <Sidebar onSettings={() => setSettings(true)} />
        {view.kind === 'tasks' ? (
          <TasksPane />
        ) : view.kind === 'graph' ? (
          <GraphPane />
        ) : view.kind === 'study' ? (
          <StudyPane />
        ) : (
          <>
            <NoteList />
            <NoteEditor />
          </>
        )}
      </div>
      <CommandPalette />
      <UpdateBanner />
      <Tour />
      <MathDialog />
      <PdfViewer />
      <SendToClipsy />
      <DialogHost />
      <MenuHost />
      <Toast />
      {settings ? <SettingsDialog onClose={() => setSettings(false)} /> : null}
    </>
  );
}
