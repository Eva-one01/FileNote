import { Download, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type UpdateState } from '@/lib/api';
import { useT } from '@/lib/i18n';

/** Estado de las actualizaciones, compartido por el aviso y los Ajustes. */
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

/** Aviso discreto abajo a la derecha: versión lista, instalando, actualizada o fallida. */
export function UpdateBanner() {
  const { t } = useT();
  const st = useUpdates();
  const [hidden, setHidden] = useState<string | null>(null);
  const u = api.updates;
  if (!u || !st) return null;

  let msg = '';
  let actions: React.ReactNode = null;
  const key = `${st.status}:${st.version}:${st.updatedTo}:${st.failedTo}`;
  const close = (dismiss = false) => {
    setHidden(key);
    if (dismiss) u.dismiss();
  };

  if (st.updatedTo) {
    msg = t('upd.updated', { v: st.updatedTo });
    actions = (
      <button className="icon-btn" aria-label={t('set.close')} onClick={() => close(true)}>
        <X size={16} />
      </button>
    );
  } else if (st.failedTo) {
    msg = t('upd.failed', { v: st.failedTo });
    actions = (
      <>
        <button className="btn btn-soft" onClick={() => u.install({ visible: true })}>
          <RefreshCw size={14} /> {t('upd.retry')}
        </button>
        <button className="btn btn-ghost" onClick={() => u.download()}>
          <Download size={14} /> {t('upd.download')}
        </button>
        <button className="icon-btn" aria-label={t('set.close')} onClick={() => close(true)}>
          <X size={16} />
        </button>
      </>
    );
  } else if (st.status === 'installing') {
    msg = t('upd.installing');
  } else if (st.status === 'ready' || (st.status === 'available' && st.manual)) {
    msg = st.status === 'ready' ? t('upd.ready', { v: st.version ?? '' }) : t('upd.available', { v: st.version ?? '' });
    actions = (
      <>
        {st.status === 'ready' ? (
          <button className="btn btn-primary" onClick={() => u.install()}>
            <RefreshCw size={14} /> {t('upd.install')}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => u.install()}>
            <Download size={14} /> {t('upd.download')}
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => close()}>
          {t('upd.later')}
        </button>
      </>
    );
  } else return null;

  if (hidden === key) return null;
  return (
    <div className="update-banner" role="status">
      <span>{msg}</span>
      {actions ? <div className="update-actions">{actions}</div> : null}
    </div>
  );
}
