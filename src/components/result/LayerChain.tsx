import { CircleSlash2, Fingerprint, MoreHorizontal } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { formatBytes, type Layer, type Terminus } from '../../engine';
import { t } from '../../i18n/en';
import { confidenceColor, cx } from '../ui/helpers';

function Node({ layer, active }: { layer: Layer; active: boolean }) {
  const setActiveLayer = useStore((s) => s.setActiveLayer);
  const isRoot = layer.depth === 0;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => setActiveLayer(layer.id)}
      title={`${layer.format} — ${formatBytes(layer.byteLength)}`}
      className={cx(
        'flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5',
        'transition-colors duration-150 ease-smooth',
        active
          ? 'border-accent-line bg-accent-soft text-text'
          : 'border-line bg-surface text-muted hover:border-line-strong hover:text-text',
      )}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: isRoot ? 'var(--text-faint)' : confidenceColor(layer.confidence) }}
      />
      <span className="font-mono text-xs2">{layer.format}</span>
      {!isRoot && (
        <span className="font-mono text-micro text-faint">
          {Math.round(layer.confidence * 100)}%
        </span>
      )}
    </button>
  );
}

function Ending({ terminus }: { terminus: Terminus }) {
  const named = terminus.identification?.matches[0];

  if (!terminus.complete) {
    return (
      <span
        title={`${t.detection.incompleteTitle}. ${terminus.note}`}
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5"
        style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}
      >
        <MoreHorizontal size={12} aria-hidden="true" />
        <span className="font-mono text-xs2">{t.detection.incomplete}</span>
      </span>
    );
  }

  if (!named) return null;

  return (
    <span
      title={terminus.note}
      className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface-3 px-3 py-1.5 text-muted"
    >
      {terminus.identification?.oneWay ? (
        <CircleSlash2 size={12} aria-hidden="true" className="text-faint" />
      ) : (
        <Fingerprint size={12} aria-hidden="true" className="text-faint" />
      )}
      <span className="font-mono text-xs2">{named.name}</span>
      <span className="font-mono text-micro text-faint">
        {Math.round(named.confidence * 100)}%
      </span>
    </span>
  );
}

function Link() {
  return (
    <span
      aria-hidden="true"
      className="h-px w-6 shrink-0 bg-line max-sm:ms-4 max-sm:h-4 max-sm:w-px"
    />
  );
}

export function LayerChain() {
  const chain = useStore((s) => s.chain);
  const activeLayerId = useStore((s) => s.activeLayerId);

  const terminus = chain[chain.length - 1]?.terminus;
  const showEnding = terminus !== undefined && (!terminus.complete || !!terminus.identification);
  if (chain.length < 2 && !showEnding) return null;

  return (
    <div
      role="tablist"
      aria-label="Decoding layers"
      className={cx(
        'flex items-center gap-2 overflow-x-auto py-1',
        'max-sm:flex-col max-sm:items-start max-sm:gap-0 max-sm:overflow-visible',
      )}
    >
      {chain.map((layer, index) => (
        <div
          key={layer.id}
          className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-start max-sm:gap-0"
        >
          {index > 0 && <Link />}
          <Node layer={layer} active={layer.id === activeLayerId} />
        </div>
      ))}

      {showEnding && terminus && (
        <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-start max-sm:gap-0">
          <Link />
          <Ending terminus={terminus} />
        </div>
      )}
    </div>
  );
}
