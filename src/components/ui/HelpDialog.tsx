import { useStore } from '../../store/useStore';
import { t } from '../../i18n/en';
import { Dialog } from './Dialog';

export function HelpDialog() {
  const setDialog = useStore((s) => s.setDialog);

  return (
    <Dialog
      title={t.help.title}
      closeLabel={t.common.close}
      onClose={() => setDialog(null)}
    >
      <dl className="space-y-2.5">
        {t.help.shortcuts.map(([keys, description]) => (
          <div key={keys} className="flex items-center justify-between gap-4">
            <dt className="text-xs2 text-muted">{description}</dt>
            <dd className="shrink-0 rounded-chip border border-line bg-surface-2 px-2 py-0.5 font-mono text-micro text-faint">
              {keys}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 border-t border-line pt-3 text-micro text-faint">{t.help.note}</p>
    </Dialog>
  );
}
