import { AlertTriangle, CheckCircle2, DownloadCloud, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type UpdateState } from '@/lib/api';
import { useT } from '@/lib/i18n';

/** Estado de las actualizaciones, compartido por el aviso, la barra de título y los Ajustes. */
export function useUpdates() {
  const [st, setSt] = useState<UpdateState | null>(null);
  useEffect(() => {
    const u = api.updates;
    if (!u) return;
    void u.get().then(setSt);
    return u.onChange(setSt);
  }, []);
  return st;
}

/** Aviso flotante (abajo a la derecha), como en Clipsy: versión nueva, descargando, instalando, actualizada o fallida. */
export function UpdateBanner() {
  const { t } = useT();
  const update = useUpdates();
  const [hidden, setHidden] = useState<string | null>(null);
  const u = api.updates;

  // «Actualizado»: se va solo a los pocos segundos.
  const updatedTo = update?.updatedTo;
  useEffect(() => {
    if (!updatedTo) return;
    const id = setTimeout(() => u?.dismiss(), 9000);
    return () => clearTimeout(id);
  }, [updatedTo, u]);

  if (!u || !update) return null;

  // 1) Instalando: la ventana se cerrará en un momento.
  if (update.status === 'installing') {
    return <Box icon={<Loader2 size={18} className="spin" />} title={t('upd.installingTitle', { v: update.version ?? '' })} body={t('upd.installingBody')} />;
  }

  // 2) Plan B: se intentó instalar y la app volvió a abrir con la versión anterior.
  if (update.failedTo) {
    const canRetry = update.status === 'ready' && update.version === update.failedTo;
    return (
      <Box tone="danger" icon={<AlertTriangle size={18} />} title={t('upd.failedTitle', { v: update.failedTo })} body={t('upd.failedBody')} onClose={() => u.dismiss()} closeLabel={t('upd.later')}>
        <div className="ub-actions">
          {canRetry ? (
            <button className="btn btn-primary btn-sm" onClick={() => u.install({ visible: true })}>
              {t('upd.retry')}
            </button>
          ) : null}
          <button className={`btn btn-sm ${canRetry ? 'btn-soft' : 'btn-primary'}`} onClick={() => u.download()}>
            {t('upd.getInstaller')}
          </button>
        </div>
      </Box>
    );
  }

  // 3) Recién actualizada.
  if (update.updatedTo) {
    return <Box tone="success" icon={<CheckCircle2 size={18} />} title={t('upd.updatedTitle', { v: update.updatedTo })} body={t('upd.updatedBody')} onClose={() => u.dismiss()} closeLabel={t('set.close')} />;
  }

  // 4) Versión nueva: se avisa en cuanto se detecta (también mientras se descarga).
  const ready = update.status === 'ready';
  const manual = update.status === 'available' && update.manual;
  const downloading = update.status === 'downloading';
  if (!update.version || (!ready && !manual && !downloading) || hidden === update.version) return null;

  return (
    <Box
      icon={<DownloadCloud size={18} />}
      title={t('upd.newTitle', { v: update.version })}
      body={ready ? t('upd.readyBody') : downloading ? t('upd.downloadingBody', { p: update.progress ?? 0 }) : t('upd.manualBody')}
      onClose={() => setHidden(update.version ?? null)}
      closeLabel={t('upd.later')}
    >
      {downloading ? (
        <div className="ub-bar">
          <i style={{ width: `${Math.max(4, update.progress ?? 0)}%` }} />
        </div>
      ) : (
        <div className="ub-actions">
          <button className="btn btn-primary btn-sm" onClick={() => u.install()}>
            {ready ? t('upd.restart') : t('upd.download')}
          </button>
        </div>
      )}
    </Box>
  );
}

function Box({ tone, icon, title, body, children, onClose, closeLabel }: { tone?: 'success' | 'danger'; icon: React.ReactNode; title: string; body: string; children?: React.ReactNode; onClose?: () => void; closeLabel?: string }) {
  return (
    <div className={`update-banner${tone ? ` ub-${tone}` : ''}`} role="alert">
      <div className="ub-icon">{icon}</div>
      <div className="ub-text">
        <strong>{title}</strong>
        <span>{body}</span>
        {children}
      </div>
      {onClose ? (
        <button className="icon-btn ub-close" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}

/** Botón en la barra de título mientras se descarga o cuando ya se puede actualizar (el punto late). */
export function TitleBarUpdate() {
  const { t } = useT();
  const update = useUpdates();
  const u = api.updates;
  if (!u || !update?.version) return null;
  const ready = update.status === 'ready';
  const downloading = update.status === 'downloading';
  if (!ready && !downloading) return null;
  const label = ready ? t('upd.barReady', { v: update.version }) : t('upd.barDownloading', { v: update.version, p: update.progress ?? 0 });
  return (
    <button className={`tb-update${ready ? ' ready' : ''}`} onClick={() => ready && u.install()} aria-label={label} title={label}>
      <span className="tb-update-ico">
        <DownloadCloud size={14} />
        {ready ? <i /> : null}
      </span>
      {ready ? t('upd.barShort') : `${update.progress ?? 0} %`}
    </button>
  );
}
