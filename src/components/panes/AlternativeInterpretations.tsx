import type { Layer } from '../../engine';
import { useStore } from '../../store/useStore';
import { t } from '../../i18n/en';
import { WhyPanel } from '../result/WhyPanel';
import { confidenceColor } from '../ui/helpers';

export function AlternativeInterpretations({ layers, disabled }: { layers: Layer[]; disabled: boolean }) {
  const applySteps = useStore((s) => s.applySteps);

  return (
    <section aria-label={t.detection.alternativesTitle} className="border-t border-line px-3 py-2">
      <h3 className="text-xs2 font-medium text-text">{t.detection.alternativesTitle}</h3>
      <p className="mt-0.5 text-micro text-muted">{t.detection.alternativesHint}</p>
      <ul className="mt-2 space-y-2">
        {layers.flatMap((layer) => (layer.alternatives ?? []).map((candidate) => (
          <li key={`${layer.id}-${candidate.id}`}>
            {candidate.steps.length === 0 ? (
              <details className="text-micro text-muted">
                <summary className="cursor-pointer">
                  <span className="font-mono text-text">{candidate.format}</span>{' '}
                  <span style={{ color: confidenceColor(candidate.confidence) }}>
                    {Math.round(candidate.confidence * 100)}%
                  </span>
                </summary>
                <div className="mt-1">
                  <WhyPanel format={candidate.format} evidence={candidate.evidence} />
                </div>
              </details>
            ) : (
              <div className="rounded-control border border-line bg-surface-2 p-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-xs2 font-medium text-text">{candidate.format}</span>
                  <span className="font-mono text-micro" style={{ color: confidenceColor(candidate.confidence) }}>
                    {Math.round(candidate.confidence * 100)}%
                  </span>
                  <span aria-hidden="true" className="text-faint">→</span>
                  <code className="min-w-0 break-all font-mono text-xs2 text-text">{candidate.preview}</code>
                  <button
                    type="button"
                    onClick={() => applySteps(candidate.steps)}
                    disabled={disabled}
                    aria-label={t.detection.useAlternative(candidate.format)}
                    className="rounded-control border border-accent-line px-2 py-1 text-micro text-text hover:bg-accent-soft disabled:opacity-50"
                  >
                    {t.detection.apply}
                  </button>
                </div>
                {layer.depth > 0 && (
                  <p className="mt-1 text-micro text-faint">{t.detection.alternativeLayer(layer.depth, layer.format)}</p>
                )}
                <details className="mt-1 text-micro text-muted">
                  <summary className="cursor-pointer">{t.detection.why}</summary>
                  <div className="mt-1">
                    <WhyPanel format={candidate.format} evidence={candidate.evidence} />
                  </div>
                </details>
              </div>
            )}
          </li>
        )))}
      </ul>
    </section>
  );
}
