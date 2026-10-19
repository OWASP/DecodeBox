import type { Evidence } from '../../engine';
import { t } from '../../i18n/en';

function Chip({ evidence }: { evidence: Evidence }) {
  return (
    <span
      title={evidence.detail}
      className="cursor-help rounded-chip border border-line bg-surface-2 px-2 py-1 font-mono text-micro text-muted"
    >
      {evidence.label}
    </span>
  );
}

export function WhyPanel({ format, evidence }: { format: string; evidence: Evidence[] }) {
  if (evidence.length === 0) return null;

  const strongest = [...evidence].sort((a, b) => b.weight - a.weight)[0];

  return (
    <section
      aria-label={t.detection.whyTitle(format)}
      className="rounded-control border border-line bg-surface-2 p-3"
    >
      <h3 className="text-xs2 font-medium text-text">{t.detection.whyTitle(format)}</h3>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {evidence.map((item, i) => (
          <Chip key={`${item.label}-${i}`} evidence={item} />
        ))}
      </div>

      {strongest && <p className="mt-2.5 max-w-2xl text-micro leading-relaxed text-muted">{strongest.detail}</p>}
    </section>
  );
}
