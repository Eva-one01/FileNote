import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { LANGS, useT } from '@/lib/i18n';
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

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const s = useStore((x) => x.settings);
  const set = useStore((x) => x.setSettings);
  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog" role="dialog" aria-label={t('set.title')} style={{ width: 'min(480px, calc(100vw - 32px))' }}>
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
      </div>
    </div>,
    document.body,
  );
}
