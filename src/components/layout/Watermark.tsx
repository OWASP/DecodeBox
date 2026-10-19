import { OwaspMark } from '../ui/OwaspMark';
import { t } from '../../i18n/en';

const KEYS: [string, string][] = [
  [t.watermark.find, 'Ctrl K'],
  [t.watermark.run, 'Ctrl ⏎'],
  [t.watermark.copy, 'Alt C'],
  [t.watermark.sidebar, 'Ctrl B'],
];

export function Watermark() {
  return (
    <div className="flex min-h-full select-none flex-col items-center justify-center gap-5 p-6">
      <OwaspMark size={84} style={{ color: 'var(--accent)' }} className="shrink-0 opacity-90" />

      <div className="flex flex-col items-center gap-1.5">
        <p className="font-sans text-[15px] tracking-tight text-muted">
          <span style={{ color: 'var(--accent-text)' }}>OWASP</span>
          <span className="ms-1.5 text-text">DecodeBox</span>
        </p>
        <p className="font-mono text-[11px] tracking-[0.14em] text-faint">{t.app.tagline}</p>
      </div>

      <p className="max-w-[34ch] text-center text-[12px] leading-relaxed text-faint">
        {t.watermark.hint}
      </p>

      <dl className="mt-1 grid gap-1.5">
        {KEYS.map(([what, keys]) => (
          <div key={keys} className="flex items-center justify-between gap-10 text-[11px]">
            <dt className="text-faint">{what}</dt>
            <dd>
              <kbd className="rounded-[3px] border border-line px-1.5 py-px font-mono text-[10px] text-faint">
                {keys}
              </kbd>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
