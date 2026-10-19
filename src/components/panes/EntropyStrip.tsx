import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import {
  asBytes,
  bandOf,
  encodeInput,
  entropyProfile,
  formatBytes,
  standoutRegions,
} from '../../engine';
import type { EntropyBand, EntropyBucket } from '../../engine';
import { t } from '../../i18n/en';


const BAND_COLOUR: Record<EntropyBand, string> = {
  sparse: 'var(--text-faint)',
  text: 'var(--blue)',
  encoded: 'var(--accent)',
  dense: 'var(--amber)',
};

function Bar({
  bucket,
  onHover,
}: {
  bucket: EntropyBucket;
  onHover: (bucket: EntropyBucket | null) => void;
}) {
  const band = bandOf(bucket.entropy);
  return (
    <span
      onMouseEnter={() => onHover(bucket)}
      onMouseLeave={() => onHover(null)}
      className="flex h-full flex-1 items-end"
      style={{ minWidth: '2px' }}
    >
      <span
        aria-hidden="true"
        className="w-full rounded-t-[1px]"
        style={{
          height: `${Math.max(4, (bucket.entropy / 8) * 100)}%`,
          backgroundColor: BAND_COLOUR[band],
          opacity: band === 'sparse' ? 0.45 : 0.85,
        }}
      />
    </span>
  );
}

export function EntropyStrip() {
  const input = useStore((s) => s.input);
  const encoding = useStore((s) => s.inputEncoding);
  const [hovered, setHovered] = useState<EntropyBucket | null>(null);

  const { profile, standout } = useMemo(() => {
    const bytes = asBytes(encodeInput(input, encoding));
    const found = entropyProfile(bytes);
    return { profile: found, standout: standoutRegions(found) };
  }, [input, encoding]);

  if (profile.length === 0) return null;

  const shown = hovered ?? null;
  const band = shown ? bandOf(shown.entropy) : null;

  return (
    <div className="shrink-0 border-t border-line px-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-faint">
          {t.entropy.label}
        </span>

        <span
          role="img"
          aria-label={t.entropy.aria(profile.length, standout.length)}
          className="flex h-6 min-w-0 flex-1 items-end gap-px"
        >
          {profile.map((bucket) => (
            <Bar key={bucket.start} bucket={bucket} onHover={setHovered} />
          ))}
        </span>

        <span className="w-52 shrink-0 text-end font-mono text-[10px] tabular-nums">
          {shown && band ? (
            <>
              <span className="text-faint">
                {shown.start}–{shown.end}
              </span>{' '}
              <span style={{ color: BAND_COLOUR[band] }}>{shown.entropy.toFixed(2)}</span>{' '}
              <span className="text-muted">{t.entropy.bands[band]}</span>
            </>
          ) : standout.length > 0 ? (
            <span style={{ color: 'var(--amber)' }}>{t.entropy.standout(standout.length)}</span>
          ) : (
            <span className="text-faint">{t.entropy.hint}</span>
          )}
        </span>
      </div>

      {standout.length > 0 && (
        <p className="mt-1 text-[10px] text-muted">
          <span style={{ color: 'var(--amber)' }}>{t.entropy.buried}</span>{' '}
          {standout
            .map((region) => `${region.start}–${region.end} (${formatBytes(region.end - region.start)})`)
            .join(', ')}
        </p>
      )}
    </div>
  );
}
