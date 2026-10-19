import { Download } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { t } from '../../i18n/en';
import { Dialog } from './Dialog';

export function DownloadDialog() {
  const setDialog = useStore((s) => s.setDialog);

  return (
    <Dialog title={t.download.title} closeLabel={t.common.close} onClose={() => setDialog(null)}>
      <div className="space-y-3 text-xs2 leading-relaxed text-muted">
        <p className="text-text">{t.download.lead}</p>
        <p>{t.download.privacy}</p>
        <p>{t.download.airgap}</p>
        <p style={{ color: 'var(--amber)' }}>{t.download.stale}</p>
        <p className="text-faint">{t.download.worker}</p>
      </div>

      <dl className="mt-4 space-y-1.5 border-t border-line pt-3 font-mono text-micro">
        <div className="flex justify-between gap-4">
          <dt className="text-faint">{t.download.version}</dt>
          <dd className="text-muted">{__APP_VERSION__}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-faint">{t.download.built}</dt>
          <dd className="text-muted">{__BUILD_TIME__}</dd>
        </div>
      </dl>

      <a
        href="./decodebox.html"
        download="decodebox.html"
        className="mt-4 flex items-center justify-center gap-2 rounded-control border border-accent-line bg-accent-soft px-3 py-2 text-xs2 font-medium text-text transition-colors duration-150 ease-smooth hover:border-accent"
      >
        <Download size={14} aria-hidden="true" />
        {t.download.button}
        <span className="font-mono text-micro text-faint">({t.download.size})</span>
      </a>
    </Dialog>
  );
}
