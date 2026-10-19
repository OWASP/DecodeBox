import { useState } from 'react';
import { AlertTriangle, Check, Copy, Info, ShieldAlert } from 'lucide-react';
import type { Finding, Indicator, Severity } from '../../engine';
import { t } from '../../i18n/en';
import { cx } from '../ui/helpers';


const SEVERITY_COLOUR: Record<Severity, string> = {
  critical: 'var(--red)',
  high: 'var(--amber)',
  medium: 'var(--amber)',
  low: 'var(--blue)',
  info: 'var(--text-faint)',
};

function severityIcon(severity: Severity) {
  if (severity === 'critical') return <ShieldAlert size={14} aria-hidden="true" />;
  if (severity === 'high' || severity === 'medium') {
    return <AlertTriangle size={14} aria-hidden="true" />;
  }
  return <Info size={14} aria-hidden="true" />;
}

export function CopyChip({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-control border border-line px-2 py-1',
        'text-micro text-muted transition-colors duration-150 ease-smooth',
        'hover:border-line-strong hover:text-text',
      )}
    >
      {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
      {copied ? t.ctf.copied : (label ?? t.ctf.copy)}
    </button>
  );
}

export function FindingCard({ finding }: { finding: Finding }) {
  const colour = SEVERITY_COLOUR[finding.severity];

  return (
    <li
      className="rounded-control border border-line border-s-2 bg-surface p-3"
      style={{ borderInlineStartColor: colour }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span style={{ color: colour }} className="flex items-center">
          {severityIcon(finding.severity)}
        </span>
        <span className="font-mono text-micro uppercase tracking-wider" style={{ color: colour }}>
          {finding.severity}
        </span>
        <h3 className="min-w-0 flex-1 text-xs2 font-medium">{finding.title}</h3>
        {finding.reference && (
          <span className="rounded-chip border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint">
            {finding.reference}
          </span>
        )}
      </div>

      <p className="mt-2 max-w-4xl text-xs2 leading-relaxed text-muted">{finding.detail}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro">
        <span className="text-faint">{t.report.foundAt}</span>
        <span className="font-mono" style={{ color: 'var(--accent-text)' }}>
          {finding.path}
        </span>
      </div>

      <pre className="mt-2 overflow-x-auto rounded-chip border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-micro text-muted">
        {finding.evidence.slice(0, 300)}
      </pre>
    </li>
  );
}

export function IndicatorList({ indicators }: { indicators: Indicator[] }) {
  const kinds = [...new Set(indicators.map((i) => i.kind))];

  return (
    <div className="space-y-3">
      {kinds.map((kind) => {
        const group = indicators.filter((i) => i.kind === kind);
        return (
          <div key={kind}>
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-micro uppercase tracking-wider text-faint">
                {kind}
              </span>
              <span className="font-mono text-micro text-faint">{group.length}</span>
              <span className="h-px flex-1 bg-line" />
              <CopyChip text={group.map((i) => i.defanged).join('\n')} label={t.ctf.copy} />
            </div>
            <ul className="space-y-1">
              {group.map((indicator) => (
                <li
                  key={`${indicator.kind}-${indicator.value}-${indicator.depth}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-control border border-line bg-surface px-2.5 py-1.5"
                >
                  <code className="min-w-0 flex-1 break-all font-mono text-micro text-text">
                    {indicator.defanged}
                  </code>
                  <span className="shrink-0 font-mono text-[10px] text-faint">
                    {indicator.depth === 0 ? t.ctf.atInput : indicator.path}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
