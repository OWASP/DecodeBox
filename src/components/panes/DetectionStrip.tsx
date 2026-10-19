import { useState } from 'react';
import { ChevronDown, Crosshair, Layers, ScanSearch, TriangleAlert, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { chainConfidence, describeRuns, explain, MAX_AUTO_DEPTH, summariseChain } from '../../engine';
import type { ChainRun, EmbeddedFind, TerminusReason } from '../../engine';
import { t } from '../../i18n/en';
import { cx } from '../ui/helpers';
import { ConfidenceMeter } from '../ui/ConfidenceMeter';
import { LayerChain } from '../result/LayerChain';
import { WhyPanel } from '../result/WhyPanel';


function Headline({ runs, ending }: { runs: ChainRun[]; ending: string | null }) {
  return (
    <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
        {t.detection.label}
      </span>

      {runs.map((run, index) => (
        <span key={`${run.format}-${index}`} className="flex items-baseline gap-1.5">
          {index > 0 && (
            <span aria-hidden="true" className="text-faint">
              →
            </span>
          )}
          <span className="font-mono text-xs2 font-semibold text-text">{run.format}</span>
          {run.count > 1 && (
            <span
              className="rounded-chip px-1.5 py-px font-mono text-[10px] font-semibold"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
            >
              ×{run.count}
            </span>
          )}
        </span>
      ))}

      {ending && (
        <span className="flex items-baseline gap-1.5">
          <span aria-hidden="true" className="text-faint">
            →
          </span>
          <span className="font-mono text-xs2 font-semibold" style={{ color: 'var(--accent-text)' }}>
            {ending}
          </span>
        </span>
      )}
    </h2>
  );
}

/*
 * `reason` decides whether the button appears at all. A chain that stopped
 * because the input is four characters long is not going to end differently
 * for being asked again — only a limit that was actually hit, depth or time,
 * has anything left to give.
 */
function Incomplete({ note, reason }: { note: string; reason: TerminusReason }) {
  const deeper = useStore((s) => s.analyseDeeper);
  const depth = useStore((s) => s.decodeDepth);
  const analysing = useStore((s) => s.analysing);
  const canGoDeeper = (reason === 'depth' || reason === 'budget') && depth < MAX_AUTO_DEPTH;

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-3 py-2"
      style={{ borderTopColor: 'var(--border)', backgroundColor: 'var(--amber-wash)' }}
    >
      <TriangleAlert size={13} aria-hidden="true" style={{ color: 'var(--amber)' }} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs2 font-medium" style={{ color: 'var(--amber)' }}>
          {t.detection.incompleteTitle}
        </p>
        <p className="text-micro text-muted">{note}</p>
      </div>
      {canGoDeeper && (
        <button
          type="button"
          onClick={deeper}
          disabled={analysing}
          className={cx(
            'shrink-0 rounded-control border px-2.5 py-1 text-micro font-medium',
            'transition-colors duration-150 ease-smooth disabled:opacity-50',
            'hover:bg-surface-3',
          )}
          style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}
        >
          {analysing ? t.detection.deepening : t.detection.deeper(depth)}
        </button>
      )}
    </div>
  );
}

/*
 * Shown when a run inside the input decodes even though the input as a whole
 * does not. `testbTRzaA==` is the shape of it: four characters of text and
 * then Base64. The offset is part of the answer, not decoration — it is what
 * makes the claim checkable, and what the recipe uses to cut the run out.
 */
function Embedded({ finds }: { finds: EmbeddedFind[] }) {
  const applySteps = useStore((s) => s.applySteps);

  return (
    <div
      className="border-t px-3 py-2"
      style={{ borderTopColor: 'var(--border)', backgroundColor: 'var(--accent-wash)' }}
    >
      <div className="flex items-center gap-2">
        <Crosshair size={13} aria-hidden="true" style={{ color: 'var(--accent-text)' }} className="shrink-0" />
        <p className="text-xs2 font-medium text-text">{t.detection.embeddedTitle}</p>
      </div>
      <p className="mt-0.5 ps-[21px] text-micro text-muted">{t.detection.embeddedHint}</p>

      <ul className="mt-1.5 flex flex-col gap-1.5 ps-[21px]">
        {finds.map((find) => (
          <li
            key={`${find.format}-${find.offset}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            <span
              className="shrink-0 rounded-chip px-1.5 py-px font-mono text-[10px] font-semibold"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
            >
              {t.detection.embeddedAt(find.format, find.offset, find.length)}
            </span>
            <span aria-hidden="true" className="text-faint">
              →
            </span>
            <code className="min-w-0 flex-1 truncate font-mono text-xs2 text-text" title={find.preview}>
              {find.preview}
            </code>
            <button
              type="button"
              onClick={() => applySteps(find.steps)}
              title={t.detection.embeddedApplyHint}
              className={cx(
                'shrink-0 rounded-control border border-accent-line px-2 py-0.5',
                'text-micro font-medium text-text transition-colors duration-150 ease-smooth',
                'hover:border-accent hover:bg-accent-soft',
              )}
            >
              {t.detection.embeddedApply}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DetectionStrip() {
  const root = useStore((s) => s.root);
  const chain = useStore((s) => s.chain);
  const steps = useStore((s) => s.steps);
  const whyOpen = useStore((s) => s.whyOpen);
  const dismissed = useStore((s) => s.suggestionDismissed);
  const analysing = useStore((s) => s.analysing);
  const analysis = useStore((s) => s.analysis);
  const toggleWhy = useStore((s) => s.toggleWhy);
  const applySuggestion = useStore((s) => s.applySuggestion);
  const dismissSuggestion = useStore((s) => s.dismissSuggestion);

  const [layersOpen, setLayersOpen] = useState(false);

  const decoded = chain.slice(1);
  const evidenceLayer = decoded[decoded.length - 1];
  const terminus = chain[chain.length - 1]?.terminus;
  const embedded = root?.embedded ?? [];

  if (analysing && decoded.length === 0) {
    return (
      <div
        role="status"
        className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2"
      >
        <ScanSearch size={13} aria-hidden="true" className="animate-pulse text-faint" />
        <span className="text-micro text-muted">{t.detection.analysing}</span>
      </div>
    );
  }

  if (!root || dismissed) return null;
  if (decoded.length === 0 && embedded.length === 0) return null;

  const runs = summariseChain(root);
  const summary = explain(root, analysis);
  const confidence = chainConfidence(root);
  const ending = terminus?.identification?.matches[0]?.name ?? null;
  const alreadyApplied = steps.length > 0;
  const incomplete = terminus !== undefined && !terminus.complete;

  return (
    <section
      aria-label={t.detection.region}
      className="shrink-0 border-b border-line bg-surface"
      style={{ boxShadow: 'inset 3px 0 0 0 var(--accent)' }}
    >
      {summary && (
        <p
          className={cx(
            'border-b border-line px-3 py-2 text-xs2 leading-relaxed text-text',
            analysing && 'opacity-50',
          )}
        >
          <span className="font-medium">{summary.headline}</span>
          {summary.details.length > 0 && (
            <span className="text-muted"> {summary.details.join(' ')}</span>
          )}
          {summary.warning && (
            <span className="ms-1.5 whitespace-nowrap">
              <span
                className="rounded-chip px-1.5 py-px font-mono text-[10px] uppercase tracking-wider"
                style={{
                  backgroundColor: 'var(--amber-wash)',
                  color: summary.warning.severity === 'critical' ? 'var(--red)' : 'var(--amber)',
                }}
              >
                {summary.warning.severity}
              </span>{' '}
              <span className="text-muted">{summary.warning.title}</span>
            </span>
          )}
        </p>
      )}

      {decoded.length > 0 && (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <ScanSearch
          size={14}
          aria-hidden="true"
          style={{ color: 'var(--accent-text)' }}
          className={cx('shrink-0', analysing && 'animate-pulse')}
        />

        <div className="min-w-0 flex-1 basis-64">
          <Headline runs={runs} ending={ending} />
        </div>

        {/*
          * While a new input is being worked out, everything above is still
          * the answer to the last one. On a five-megabyte paste that lasts
          * several seconds, which is long enough to read a stale answer and
          * believe it.
          */}
        {analysing && (
          <span
            role="status"
            className="shrink-0 rounded-chip px-1.5 py-px font-mono text-[10px] uppercase tracking-wider"
            style={{ backgroundColor: 'var(--amber-wash)', color: 'var(--amber)' }}
          >
            {t.detection.recomputing}
          </span>
        )}

        <ConfidenceMeter value={confidence} />

        <div className="flex shrink-0 items-center gap-1">
          {!alreadyApplied && (
            <button
              type="button"
              onClick={applySuggestion}
              title={t.detection.applyHint}
              className={cx(
                'rounded-control border border-accent-line bg-accent-soft px-2.5 py-1',
                'text-micro font-medium text-text transition-colors duration-150 ease-smooth',
                'hover:border-accent',
              )}
            >
              {t.detection.apply}
            </button>
          )}

          <button
            type="button"
            onClick={() => setLayersOpen((open) => !open)}
            aria-expanded={layersOpen}
            title={describeRuns(runs)}
            className="flex items-center gap-1.5 rounded-control px-2 py-1 text-micro text-muted transition-colors duration-150 ease-smooth hover:bg-surface-3 hover:text-text"
          >
            <Layers size={11} aria-hidden="true" />
            {t.detection.layers(decoded.length)}
            <ChevronDown
              size={11}
              aria-hidden="true"
              className={cx('transition-transform duration-200 ease-smooth', layersOpen && 'rotate-180')}
            />
          </button>

          <button
            type="button"
            onClick={toggleWhy}
            aria-expanded={whyOpen}
            title={t.detection.whyHint}
            className="flex items-center gap-1 rounded-control px-2 py-1 text-micro text-muted transition-colors duration-150 ease-smooth hover:bg-surface-3 hover:text-text"
          >
            {t.detection.why}
            <ChevronDown
              size={11}
              aria-hidden="true"
              className={cx('transition-transform duration-200 ease-smooth', whyOpen && 'rotate-180')}
            />
          </button>

          <button
            type="button"
            onClick={dismissSuggestion}
            aria-label={t.detection.dismiss}
            title={t.detection.dismiss}
            className="rounded-control p-1.5 text-faint transition-colors duration-150 ease-smooth hover:bg-surface-3 hover:text-text"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      </div>
      )}

      {embedded.length > 0 && <Embedded finds={embedded} />}

      {incomplete && terminus && <Incomplete note={terminus.note} reason={terminus.reason} />}

      {layersOpen && decoded.length > 0 && (
        <div className="border-t border-line px-3 py-2">
          <div className="overflow-x-auto">
            <LayerChain />
          </div>
          {terminus && terminus.complete && terminus.reason !== 'plain' && (
            <p className="mt-1 text-micro text-muted">{terminus.note}</p>
          )}
        </div>
      )}

      {whyOpen && evidenceLayer && (
        <div className="border-t border-line p-3">
          <WhyPanel format={evidenceLayer.format} evidence={evidenceLayer.evidence} />
        </div>
      )}
    </section>
  );
}
