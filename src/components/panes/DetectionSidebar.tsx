import { useState } from 'react';
import { AlertTriangle, ChevronRight, FileCode2, Info, Target } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { AnalysisNode, Finding, Indicator, Severity } from '../../engine';
import { t } from '../../i18n/en';
import { cx } from '../ui/helpers';
import { formatBytes, renderText } from '../../engine';


const SEVERITY_COLOUR: Record<Severity, string> = {
  critical: 'var(--red)',
  high: 'var(--red)',
  medium: 'var(--amber)',
  low: 'var(--blue)',
  info: 'var(--text-faint)',
};

const PREVIEW_LIMIT = 600;

function Section({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 bg-surface-2 px-1 py-1 text-start hover:bg-surface-3"
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={cx('shrink-0 text-muted transition-transform duration-100', open && 'rotate-90')}
        />
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">
          {title}
        </span>
        <span className="pe-1.5 font-mono text-[10px] tabular-nums text-faint">{count}</span>
      </button>
      {open && children}
    </div>
  );
}

/** As far as the indent is allowed to go before it stops growing. */
const MAX_INDENT = 8;

const INDENT_STEP = 12;

/*
 * Indented by branching, not by depth.
 *
 * Forty-four layers of Base64 is a list, not a tree: every layer has exactly
 * one child. Indenting each one ten pixels further put layer forty-four four
 * hundred pixels inside a pane two hundred and sixty wide, which left the row
 * with less than no space and drew the size on top of the name.
 *
 * So a run with nothing to choose between stays at one indent and reads as the
 * list it is, and the indent is spent where it means something — a layer that
 * really does split into more than one. The depth is still on every row, as a
 * number, which is what the indent was being asked to convey.
 */
function Node({
  node,
  indent,
  selectedId,
  onSelect,
}: {
  node: AnalysisNode;
  indent: number;
  selectedId: string | null;
  onSelect: (node: AnalysisNode) => void;
}) {
  const [open, setOpen] = useState(true);
  const active = selectedId === node.id;
  const hasChildren = node.children.length > 0;
  const childIndent = node.children.length > 1 ? indent + 1 : indent;

  return (
    <>
      <div
        data-active={active}
        className="db-row group flex items-center gap-1 pe-1.5 text-[12px]"
        style={{ paddingInlineStart: 4 + Math.min(indent, MAX_INDENT) * INDENT_STEP }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? t.detectionTree.collapse(node.format) : t.detectionTree.expand(node.format)}
            className="grid h-5 w-4 shrink-0 place-items-center text-muted"
          >
            <ChevronRight
              size={13}
              aria-hidden="true"
              className={cx('transition-transform duration-100', open && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="h-5 w-4 shrink-0" aria-hidden="true" />
        )}

        <span
          aria-hidden="true"
          className="w-5 shrink-0 text-end font-mono text-[10px] tabular-nums text-faint"
        >
          {node.depth}
        </span>

        <button
          type="button"
          onClick={() => onSelect(node)}
          aria-current={active ? 'true' : undefined}
          title={t.detectionTree.nodeHint(node.format, node.preview)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-start"
        >
          <FileCode2
            size={13}
            aria-hidden="true"
            className="shrink-0"
            style={{ color: active ? 'var(--accent-text)' : 'var(--text-faint)' }}
          />
          <span className={cx('shrink-0 font-mono', active ? 'text-text' : 'text-muted')}>
            {node.format}
          </span>
          {node.origin && (
            <span className="shrink-0 font-mono text-[10px] text-faint">@{node.origin.offset}</span>
          )}
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-faint">
            {node.preview}
          </span>
        </button>

        <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
          {formatBytes(node.byteLength)}
        </span>
      </div>

      {open &&
        node.children.map((child) => (
          <Node
            key={child.id}
            node={child}
            indent={childIndent}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

/*
 * What the tree was missing.
 *
 * The rows named a format and a size and stopped there, and clicking one set a
 * layer id that only the decode chain knows about — so selecting a branch of
 * the analysis quietly did nothing at all. This panel is the answer to "what
 * was actually found": the content, where it came from, how sure the engine
 * is, and the steps that reach it.
 */
function Detail({ node }: { node: AnalysisNode }) {
  const applySteps = useStore((s) => s.applySteps);
  const text = renderText(node.output);

  return (
    <div className="border-b border-line bg-surface-2 px-2 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="rounded-chip px-1.5 py-px font-mono text-[10px] font-semibold"
          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
        >
          {node.format}
        </span>
        <span className="font-mono text-[10px] text-faint">
          {t.detectionTree.confidence(Math.round(node.confidence * 100))}
        </span>
        <span className="font-mono text-[10px] text-faint">{formatBytes(node.byteLength)}</span>
        {node.origin && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--amber)' }}>
            {t.detectionTree.at(node.origin.offset)}
          </span>
        )}
      </div>

      <p className="mt-1 wrap-break-word font-mono text-[10px] text-faint">{node.path}</p>

      <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-control bg-surface px-2 py-1.5 font-mono text-[11px] text-text">
        {text.slice(0, PREVIEW_LIMIT)}
        {text.length > PREVIEW_LIMIT ? '…' : ''}
      </pre>

      {node.steps.length > 0 && (
        <button
          type="button"
          onClick={() => applySteps(node.steps)}
          title={t.detectionTree.useAsRecipe}
          className={cx(
            'mt-1.5 rounded-control border border-accent-line bg-accent-soft px-2 py-0.5',
            'text-[11px] font-medium text-text transition-colors duration-150 ease-smooth',
            'hover:border-accent',
          )}
        >
          {t.detection.apply}
        </button>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="db-row flex w-full items-start gap-1.5 px-2 py-1 text-start text-[12px]"
      >
        <AlertTriangle
          size={12}
          aria-hidden="true"
          className="mt-[3px] shrink-0"
          style={{ color: SEVERITY_COLOUR[finding.severity] }}
        />
        <span className="min-w-0 flex-1">
          <span className="block wrap-break-word text-muted">{finding.title}</span>
          <span
            className="font-mono text-[10px] uppercase tracking-wider"
            style={{ color: SEVERITY_COLOUR[finding.severity] }}
          >
            {finding.severity}
          </span>
        </span>
        <ChevronRight
          size={12}
          aria-hidden="true"
          className={cx('mt-[3px] shrink-0 text-faint transition-transform duration-100', open && 'rotate-90')}
        />
      </button>

      {open && (
        <div className="px-2 pb-2 ps-[26px]">
          <p className="wrap-break-word text-[11px] leading-relaxed text-muted">{finding.detail}</p>
          {finding.evidence.length > 0 && (
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-control bg-surface px-2 py-1 font-mono text-[10px] text-text">
              {finding.evidence}
            </pre>
          )}
          <p className="mt-1 wrap-break-word font-mono text-[10px] text-faint">
            {t.detectionTree.where}: {finding.path}
          </p>
          {finding.reference !== undefined && (
            <p className="mt-0.5 wrap-break-word font-mono text-[10px] text-faint">{finding.reference}</p>
          )}
        </div>
      )}
    </div>
  );
}

function IndicatorRow({ indicator }: { indicator: Indicator }) {
  return (
    <div className="db-row flex items-start gap-1.5 px-2 py-1 text-[12px]">
      <Target size={12} aria-hidden="true" className="mt-[3px] shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <span className="me-1.5 font-mono text-[10px] uppercase text-faint">{indicator.kind}</span>
        <span className="break-all font-mono text-muted">{indicator.defanged}</span>
        <p className="wrap-break-word font-mono text-[10px] text-faint">{indicator.path}</p>
      </div>
    </div>
  );
}

export function DetectionSidebar() {
  const analysis = useStore((s) => s.analysis);
  const analysing = useStore((s) => s.analysing);
  const [selected, setSelected] = useState<AnalysisNode | null>(null);

  const current =
    analysis && selected
      ? (flattenTree(analysis.root).find((node) => node.id === selected.id) ?? null)
      : null;

  return (
    <section aria-label={t.detectionTree.title} className="flex min-h-0 flex-1 flex-col bg-surface">
      <h2 className="flex h-9 shrink-0 items-center gap-2 px-4 text-[11px] font-normal uppercase tracking-[0.08em] text-muted">
        {t.detectionTree.title}
      </h2>

      {!analysis ? (
        <p className="flex items-start gap-1.5 px-4 py-3 text-[12px] text-faint">
          <Info size={13} aria-hidden="true" className="mt-[2px] shrink-0" />
          {analysing ? t.detectionTree.working : t.detectionTree.empty}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section title={t.detectionTree.layers} count={analysis.nodes}>
            {/*
              * Scrolls sideways rather than letting a row run out of room. The
              * rows are laid out not to need it, but the pane can be dragged
              * narrower than any layout survives, and a row that scrolls is
              * readable where one that overflows is not.
              */}
            <div className="overflow-x-auto py-0.5">
              <Node
                node={analysis.root}
                indent={0}
                selectedId={current?.id ?? null}
                onSelect={setSelected}
              />
            </div>
            <p className="px-2 pb-1 font-mono text-[10px] text-faint">
              {t.detectionTree.summary(analysis.nodes, analysis.maxDepth)}
            </p>
          </Section>

          {current && <Detail node={current} />}

          <Section
            title={t.detectionTree.findings}
            count={analysis.findings.length}
            defaultOpen={analysis.findings.length > 0}
          >
            {analysis.findings.length === 0 ? (
              <p className="px-4 py-2 text-[12px] text-faint">{t.detectionTree.noFindings}</p>
            ) : (
              analysis.findings.map((f) => <FindingRow key={f.id} finding={f} />)
            )}
          </Section>

          <Section
            title={t.detectionTree.indicators}
            count={analysis.indicators.length}
            defaultOpen={analysis.indicators.length > 0}
          >
            {analysis.indicators.length === 0 ? (
              <p className="px-4 py-2 text-[12px] text-faint">{t.detectionTree.noIndicators}</p>
            ) : (
              analysis.indicators.map((i) => (
                <IndicatorRow key={`${i.kind}:${i.value}:${i.depth}`} indicator={i} />
              ))
            )}
          </Section>

          {analysis.truncated && (
            <p className="px-4 py-2 text-[11px]" style={{ color: 'var(--amber)' }}>
              {t.detectionTree.truncated}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/*
 * The selection is held as a node rather than an id so that it survives a
 * re-analysis with the same content, and looked up again on every render so
 * that a stale node from a previous input disappears instead of showing
 * content that is no longer on screen.
 */
function flattenTree(root: AnalysisNode): AnalysisNode[] {
  const all: AnalysisNode[] = [];
  const stack: AnalysisNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    all.push(node);
    stack.push(...node.children);
  }
  return all;
}
