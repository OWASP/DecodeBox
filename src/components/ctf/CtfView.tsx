import { useState } from 'react';
import {
  Binary,
  Check,
  Copy,
  Fingerprint,
  Flag,
  KeyRound,
  Layers as LayersIcon,
  Lightbulb,
  Play,
  Search,
  Shapes,
  ShieldAlert,
  Target,
  Unlock,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { formatBytes, toMarkdown } from '../../engine';
import type { Hint, HintKind, Layer } from '../../engine';
import { t } from '../../i18n/en';
import { bySeverity, confidenceColor, cx } from '../ui/helpers';
import { LayerFind } from './LayerFind';
import { Button, ConfidenceBar } from '../ui/primitives';
import { CopyChip, FindingCard, IndicatorList } from '../analysis/Evidence';


const KIND_ICON: Record<HintKind, typeof Flag> = {
  flag: Flag,
  decode: Binary,
  crack: KeyRound,
  shape: Shapes,
  identify: Fingerprint,
  inspect: Search,
};

const KIND_COLOUR: Record<HintKind, string> = {
  flag: 'var(--green)',
  decode: 'var(--accent-text)',
  crack: 'var(--accent-text)',
  shape: 'var(--blue)',
  identify: 'var(--text-muted)',
  inspect: 'var(--text-muted)',
};

function CopyButton({ text }: { text: string }) {
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
      className="inline-flex shrink-0 items-center gap-1 rounded-control border border-line px-2 py-1 text-micro text-muted transition-colors hover:border-line-strong hover:text-text"
    >
      {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
      {copied ? t.ctf.copied : t.ctf.copy}
    </button>
  );
}

function Where({ hint }: { hint: Hint }) {
  return (
    <span className="font-mono text-micro text-faint">
      {hint.depth === 0 ? t.ctf.atInput : t.ctf.atDepth(hint.depth, hint.path)}
    </span>
  );
}

function HintRow({ hint }: { hint: Hint }) {
  const applyHint = useStore((s) => s.applyHint);
  const Icon = KIND_ICON[hint.kind];
  const colour = KIND_COLOUR[hint.kind];
  const actionable = hint.steps.length > 0;

  return (
    <li
      className="rounded-control border border-line border-s-2 bg-surface p-3"
      style={{ borderInlineStartColor: colour }}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span style={{ color: colour }} className="flex shrink-0 items-center">
          <Icon size={14} aria-hidden="true" />
        </span>
        <span
          className="shrink-0 font-mono text-micro uppercase tracking-wider"
          style={{ color: colour }}
        >
          {t.ctf.kinds[hint.kind]}
        </span>

        <h3
          className={cx(
            'min-w-0 flex-1 text-xs2 font-medium',
            hint.kind === 'flag' && 'break-all font-mono',
          )}
        >
          {hint.title}
        </h3>

        <span className="flex shrink-0 items-center gap-2 text-micro text-muted">
          <ConfidenceBar value={hint.confidence} />
          <span style={{ color: confidenceColor(hint.confidence) }}>
            {Math.round(hint.confidence * 100)}%
          </span>
        </span>

        {hint.kind === 'flag' && <CopyButton text={hint.title} />}

        {actionable ? (
          <Button
            variant="primary"
            onClick={() => applyHint(hint)}
            title={t.ctf.applyHint}
            className="shrink-0 py-1! text-micro!"
          >
            <Play size={11} aria-hidden="true" />
            {t.ctf.apply}
          </Button>
        ) : (
          <span className="shrink-0 text-micro text-faint">{t.ctf.noSteps}</span>
        )}
      </div>

      <p className="mt-2 max-w-4xl text-xs2 leading-relaxed text-muted">{hint.reason}</p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Where hint={hint} />
        {hint.preview && hint.kind !== 'flag' && (
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-chip border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-micro text-muted">
            {hint.preview}
          </pre>
        )}
      </div>
    </li>
  );
}

function SectionHead({
  icon,
  title,
  count,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex items-center" style={{ color: 'var(--accent-text)' }}>
        {icon}
      </span>
      <h2
        className="font-mono text-micro font-semibold uppercase tracking-[0.08em]"
        style={{ color: 'var(--accent-text)' }}
      >
        {title}
      </h2>
      {count !== undefined && count > 0 && (
        <span className="font-mono text-micro text-faint">{count}</span>
      )}
      <span className="h-px flex-1 bg-line" />
      {action}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-control border border-dashed border-line px-3 py-4 text-center text-micro text-faint">
      {children}
    </p>
  );
}

function LayerRow({ layer, last }: { layer: Layer; last: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-control border border-line bg-surface px-2.5 py-1.5">
      <span className="font-mono text-micro text-faint">{layer.depth}</span>
      <span className="font-mono text-micro font-medium" style={{ color: 'var(--accent-text)' }}>
        {layer.format}
      </span>
      <span className="font-mono text-[10px] text-faint">{formatBytes(layer.byteLength)}</span>
      {layer.depth > 0 && (
        <span className="font-mono text-[10px]" style={{ color: confidenceColor(layer.confidence) }}>
          {Math.round(layer.confidence * 100)}%
        </span>
      )}
      <code className="min-w-0 flex-1 basis-64 truncate font-mono text-micro text-muted">
        {layer.output.slice(0, 160)}
      </code>
      {last && layer.terminus && (
        <span
          className="shrink-0 font-mono text-[10px] uppercase tracking-wider"
          style={{ color: layer.terminus.complete ? 'var(--green)' : 'var(--amber)' }}
        >
          {layer.terminus.reason}
        </span>
      )}
    </li>
  );
}

export function CtfView() {
  const report = useStore((s) => s.ctf);
  const running = useStore((s) => s.ctfRunning);
  const input = useStore((s) => s.input);
  const analysis = useStore((s) => s.analysis);
  const chain = useStore((s) => s.chain);

  if (input.trim().length === 0) {
    return (
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Search size={22} aria-hidden="true" className="text-faint" />
        <h2 className="text-sm font-medium">{t.ctf.emptyTitle}</h2>
        <p className="max-w-md text-xs2 leading-relaxed text-muted">{t.ctf.emptyDetail}</p>
      </main>
    );
  }

  const flags = report?.flags ?? [];

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-5">
        <header className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-sm font-semibold">{t.ctf.title}</h1>
            <p className="text-micro text-muted">{t.ctf.subtitle}</p>
            {report && (
              <span className="ms-auto font-mono text-micro text-faint">
                {t.ctf.layers(report.layers)} · {Math.round(report.durationMs)} ms
              </span>
            )}
          </div>
        </header>

        <LayerFind />

        {flags.length > 0 && (
          <section
            className="rounded-card border border-s-2 bg-surface p-3"
            style={{ borderColor: 'var(--line)', borderInlineStartColor: 'var(--green)' }}
          >
            <h2 className="flex items-center gap-2 text-xs2 font-medium">
              <Unlock size={13} aria-hidden="true" style={{ color: 'var(--green)' }} />
              {t.ctf.flagsFound(flags.length)}
            </h2>
            <ul className="mt-2 space-y-1.5">
              {flags.map((flag) => (
                <li key={flag.text} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <code className="min-w-0 break-all font-mono text-xs2 text-text">{flag.text}</code>
                  <span className="font-mono text-micro text-faint">
                    {flag.depth === 0 ? t.ctf.atInput : t.ctf.atDepth(flag.depth, flag.path)}
                  </span>
                  <CopyButton text={flag.text} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {analysis && analysis.findings.length > 0 && (
          <section>
            <SectionHead
              icon={<ShieldAlert size={13} aria-hidden="true" />}
              title={t.report.findings}
              count={analysis.findings.length}
            />
            <ul className="space-y-2">
              {[...analysis.findings].sort(bySeverity).map((finding) => (
                <FindingCard key={finding.id} finding={finding} />
              ))}
            </ul>
          </section>
        )}

        <section>
          <SectionHead
            icon={<Lightbulb size={13} aria-hidden="true" />}
            title={t.ctf.hints}
            count={report?.hints.length}
          />

          {running && !report ? (
            <p className="text-xs2 text-muted">{t.ctf.working}</p>
          ) : report && report.hints.length > 0 ? (
            <ul className="space-y-2">
              {report.hints.map((hint) => (
                <HintRow key={hint.id} hint={hint} />
              ))}
            </ul>
          ) : (
            <Empty>{flags.length > 0 ? t.ctf.noHints : `${t.ctf.noFlags} ${t.ctf.noHints}`}</Empty>
          )}
        </section>

        {analysis && (
          <section>
            <SectionHead
              icon={<Target size={13} aria-hidden="true" />}
              title={t.report.indicators}
              count={analysis.indicators.length}
              action={
                analysis.indicators.length > 0 ? (
                  <CopyChip text={analysis.indicators.map((i) => i.defanged).join('\n')} />
                ) : undefined
              }
            />
            {analysis.indicators.length === 0 ? (
              <Empty>{t.report.noIndicators}</Empty>
            ) : (
              <>
                <IndicatorList indicators={analysis.indicators} />
                <p className="mt-2 text-micro text-faint">{t.report.defangNote}</p>
              </>
            )}
          </section>
        )}

        {chain.length > 0 && (
          <section>
            <SectionHead
              icon={<LayersIcon size={13} aria-hidden="true" />}
              title={t.report.layers}
              count={chain.length}
            />
            <ul className="space-y-1">
              {chain.map((layer, index) => (
                <LayerRow key={layer.id} layer={layer} last={index === chain.length - 1} />
              ))}
            </ul>
          </section>
        )}

        {report?.truncated && (
          <p className="text-micro" style={{ color: 'var(--amber)' }}>
            {t.ctf.truncated}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <p className="min-w-0 flex-1 text-micro text-faint">{t.ctf.privacy}</p>
          {analysis && (
            <CopyChip text={toMarkdown(analysis)} label={t.ctf.copyReport} />
          )}
        </div>
      </div>
    </main>
  );
}
