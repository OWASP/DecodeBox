import { useEffect, useState } from 'react';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { t } from '../../i18n/en';
import { encodeShare, shareUrl } from '../../lib/share';
import { Button } from './primitives';
import { Dialog } from './Dialog';

const LONG_URL = 2000;

export function ShareDialog() {
  const steps = useStore((s) => s.steps);
  const input = useStore((s) => s.input);
  const operations = useStore((s) => s.operations);
  const setDialog = useStore((s) => s.setDialog);

  const [includeInput, setIncludeInput] = useState(false);
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void encodeShare(steps, operations, includeInput ? input : undefined).then((fragment) => {
      if (!cancelled) setUrl(shareUrl(fragment));
    });
    return () => {
      cancelled = true;
    };
  }, [steps, operations, input, includeInput]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
    }
  };

  return (
    <Dialog
      title={t.share.title}
      subtitle={t.share.subtitle}
      closeLabel={t.common.close}
      onClose={() => setDialog(null)}
    >
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={includeInput}
          onChange={(e) => setIncludeInput(e.target.checked)}
          disabled={input.length === 0}
          className="mt-0.5 h-3.5 w-3.5 accent-(--accent)"
        />
        <span>
          <span className="text-xs2">{t.share.includeInput}</span>
          <span className="mt-0.5 block text-micro text-faint">{t.share.includeInputHint}</span>
        </span>
      </label>

      {includeInput && (
        <p
          className="mt-3 flex items-start gap-2 rounded-control border px-2.5 py-2 text-micro"
          style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}
        >
          <TriangleAlert size={13} aria-hidden="true" className="mt-px shrink-0" />
          {t.share.inputWarning}
        </p>
      )}

      <div className="mt-4">
        <label htmlFor="share-url" className="mb-1 block text-micro text-faint">
          {t.share.link}
        </label>
        <textarea
          id="share-url"
          readOnly
          value={url}
          rows={3}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full resize-none rounded-control border border-line bg-surface-2 p-2.5 font-mono text-micro leading-relaxed outline-hidden focus:border-accent-line"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span
            className="font-mono text-micro"
            style={{ color: url.length > LONG_URL ? 'var(--amber)' : 'var(--text-faint)' }}
          >
            {url.length > LONG_URL ? t.share.tooLong(url.length) : t.share.length(url.length)}
          </span>
          <Button variant="primary" onClick={copy} disabled={url.length === 0}>
            {copied ? (
              <>
                <Check size={13} aria-hidden="true" />
                {t.share.copied}
              </>
            ) : (
              <>
                <Copy size={13} aria-hidden="true" />
                {t.share.copy}
              </>
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
