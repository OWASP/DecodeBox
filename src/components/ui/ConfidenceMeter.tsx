import { confidenceColor, cx } from './helpers';
import { t } from '../../i18n/en';


const CELLS = 5;

function band(confidence: number): { label: string; cells: number } {
  if (confidence >= 0.9) return { label: t.confidence.high, cells: 5 };
  if (confidence >= 0.75) return { label: t.confidence.good, cells: 4 };
  if (confidence >= 0.6) return { label: t.confidence.medium, cells: 3 };
  if (confidence >= 0.4) return { label: t.confidence.low, cells: 2 };
  return { label: t.confidence.weak, cells: 1 };
}

export function ConfidenceMeter({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const percent = Math.round(value * 100);
  const { label, cells } = band(value);
  const colour = confidenceColor(value);

  return (
    <span
      className={cx('inline-flex shrink-0 items-baseline gap-2', className)}
      title={t.confidence.explain}
    >
      <span className="font-mono text-[10px] uppercase tracking-wider text-faint max-lg:hidden">
        {t.confidence.label}
      </span>

      <span
        role="img"
        aria-label={t.confidence.aria(percent, label)}
        className="inline-flex items-end gap-[2px]"
      >
        {Array.from({ length: CELLS }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            style={{
              height: `${5 + i * 2}px`,
              backgroundColor: i < cells ? colour : 'var(--border-strong)',
            }}
            className="w-[3px] rounded-[1px]"
          />
        ))}
      </span>

      <span className="font-mono text-micro tabular-nums" style={{ color: colour }}>
        {percent}%
      </span>
      <span className="text-micro text-faint max-md:hidden">{label}</span>
    </span>
  );
}
