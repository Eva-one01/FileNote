import { FolderOpen, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type AutoBackup } from '@/lib/api';
import { LANGS, useT } from '@/lib/i18n';
import { confirmDialog } from './ui';
import { useUpdates } from './UpdateBanner';
import { useStore } from '@/lib/store';
import type { AccentId, Lang, SizePref, ThemePref } from '@/types';

const ACCENTS: { id: AccentId; color: string }[] = [
  { id: 'blue', color: '#2E55E6' },
  { id: 'violet', color: '#7240D6' },
  { id: 'teal', color: '#0B7480' },
  { id: 'magenta', color: '#B5276F' },
  { id: 'graphite', color: '#2A2A2E' },
];

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" style={{ display: 'flex', padding: 3, borderRadius: 'var(--r-md)', background: 'var(--surface-alt)' }}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          style={{
            flex: 1,
            height: 34,
            border: 0,
            borderRadius: 8,
            fontWeight: 800,
            background: value === o.value ? 'var(--surface)' : 'transparent',
            color: value === o.value ? 'var(--text)' : 'var(--text-muted)',
            boxShadow: value === o.value ? 'var(--shadow)' : 'none',
            transition: 'background var(--fast), color var(--fast)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div className="label" style={{ marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Backups() {
  const { t, lang } = useT();
  const [list, setList] = useState<AutoBackup[] | null>(null);
  const b = api.backups;
  useEffect(() => {
    void b?.list().then(setList);
  }, [b]);
  if (!b) return null;
  const fmt = (ts: number) => new Date(ts).toLocaleString(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const restore = async (x: AutoBackup) => {
    const ok = await confirmDialog({ title: t('set.restoreQ'), body: t('set.restoreBody', { d: fmt(x.savedAt) }), ok: t('set.restore') });
    if (!ok) return;
    await useStore.getState().flush();
    if (await b.restore(x.name)) {
      // Se cierra la nota abierta para que el editor se monte de nuevo con el contenido restaurado.
      useStore.setState({ selectedId: null, current: null });
      await new Promise((r) => setTimeout(r, 0));
      await useStore.getState().load();
      useStore.getState().showToast(t('set.restored'));
      setList(await b.list());
    }
  };
  return (
    <div className="set-section">
      <h4>{t('set.backups')}</h4>
      <p className="set-hint">{t('set.backupsHint')}</p>
      {list && list.length ? (
        <div className="bak-list">
          {list.map((x) => (
            <div className="bak-row" key={x.name}>
              <span className="when">{fmt(x.savedAt)}</span>
              <span className="meta">
                {x.kind === 'safety' ? `${t('set.safety')} · ` : ''}
                {x.count != null ? t(x.count === 1 ? 'set.note1' : 'set.notesN', { n: x.count }) : ''}
              </span>
              <button className="btn btn-soft btn-sm" onClick={() => void restore(x)}>
                {t('set.restore')}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="set-hint">{t('set.backupsNone')}</p>
      )}
      <button className="btn btn-soft btn-sm" onClick={() => void b.openFolder()}>
        <FolderOpen size={14} /> {t('set.openFolder')}
      </button>
    </div>
  );
}

function Privacy() {
  const { t } = useT();
  const r = api.errorReports;
  const [st, setSt] = useState<{ enabled: boolean; available: boolean } | null>(null);
  useEffect(() => {
    void r?.get().then(setSt);
  }, [r]);
  if (!r || !st || !st.available) return null; // Sin DSN de Sentry configurado no se muestra.
  return (
    <div className="set-section">
      <h4>{t('set.privacy')}</h4>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 700 }}>
        <input type="checkbox" checked={st.enabled} onChange={async (e) => setSt(await r.set(e.target.checked))} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
        {t('set.errors')}
      </label>
      <p className="set-hint" style={{ marginTop: 6 }}>
        {t('set.errorsHint')}
      </p>
      {st.enabled && st.available ? (
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            await r.test();
            useStore.getState().showToast(t('set.testSent'));
          }}
        >
          {t('set.testError')}
        </button>
      ) : null}
    </div>
  );
}

function About() {
  const { t } = useT();
  const st = useUpdates();
  const [version, setVersion] = useState('');
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    void api.app?.version().then(setVersion);
  }, []);
  const u = api.updates;
  if (!u) return null;
  const line = !asked || !st ? '' : st.status === 'checking' ? t('upd.checking') : st.status === 'none' ? t('upd.none') : st.status === 'error' ? t('upd.error') : st.status === 'disabled' ? t('upd.disabled') : st.status === 'downloading' ? t('upd.downloading', { v: st.version ?? '', p: st.progress ?? 0 }) : st.status === 'ready' ? t('upd.ready', { v: st.version ?? '' }) : st.status === 'available' ? t('upd.available', { v: st.version ?? '' }) : '';
  return (
    <div className="set-section">
      <h4>{t('upd.section')}</h4>
      <p className="set-hint">FileNote · {t('set.version', { v: version || st?.current || '' })}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          className="btn btn-soft btn-sm"
          disabled={st?.status === 'checking'}
          onClick={() => {
            setAsked(true);
            void u.check();
          }}
        >
          {t('set.check')}
        </button>
        {line ? <span className="set-hint" style={{ margin: 0 }}>{line}</span> : null}
        {asked && st && (st.status === 'ready' || st.status === 'available') ? (
          <button className="btn btn-primary btn-sm" onClick={() => u.install()}>
            {st.status === 'ready' ? t('upd.restart') : t('upd.download')}
          </button>
        ) : null}
      </div>
      <p className="set-hint" style={{ marginTop: 10, marginBottom: 0 }}>
        {t('upd.dataNote')}
      </p>
    </div>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const s = useStore((x) => x.settings);
  const set = useStore((x) => x.setSettings);
  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog" role="dialog" aria-label={t('set.title')} style={{ width: 'min(520px, calc(100vw - 32px))', maxHeight: 'calc(82vh - 24px)', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h3 style={{ flex: 1, margin: 0 }}>{t('set.title')}</h3>
          <button className="icon-btn" aria-label={t('set.close')} onClick={onClose} autoFocus>
            <X size={18} />
          </button>
        </div>
        <Row label={t('set.theme')}>
          <Segmented<ThemePref>
            value={s.theme}
            onChange={(v) => set({ theme: v })}
            options={[
              { value: 'system', label: t('set.system') },
              { value: 'light', label: t('set.light') },
              { value: 'dark', label: t('set.dark') },
            ]}
          />
        </Row>
        <Row label={t('set.accent')}>
          <div style={{ display: 'flex', gap: 12 }}>
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                aria-label={a.id}
                aria-pressed={s.accent === a.id}
                onClick={() => set({ accent: a.id })}
                style={{ width: 34, height: 34, borderRadius: 17, border: 0, background: a.color, boxShadow: s.accent === a.id ? '0 0 0 3px var(--surface), 0 0 0 5px var(--accent)' : 'none', transition: 'box-shadow var(--fast)' }}
              />
            ))}
          </div>
        </Row>
        <Row label={t('set.size')}>
          <Segmented<SizePref>
            value={s.size}
            onChange={(v) => set({ size: v })}
            options={[
              { value: 'normal', label: t('set.normal') },
              { value: 'large', label: t('set.large') },
              { value: 'xlarge', label: t('set.xlarge') },
            ]}
          />
        </Row>
        <Row label={t('set.language')}>
          <select className="input" value={s.language} onChange={(e) => set({ language: e.target.value as Lang })}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.native}
              </option>
            ))}
          </select>
        </Row>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, cursor: 'pointer' }}>
          <input type="checkbox" checked={s.spellcheck} onChange={(e) => set({ spellcheck: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
          {t('set.spellcheck')}
        </label>
        <Backups />
        <Privacy />
        <About />
      </div>
    </div>,
    document.body,
  );
}
