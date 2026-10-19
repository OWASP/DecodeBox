import { useDeferredValue, useMemo, useState } from 'react';
import { CornerDownRight, Regex, RefreshCw, Search, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { findInLayers, isValidQuery } from '../../engine';
import type { LayerMatch } from '../../engine';
import { t } from '../../i18n/en';
import { cx } from '../ui/helpers';


function Hit({ match }: { match: LayerMatch }) {
  const openLayer = useStore((s) => s.openLayer);
  const reachable = match.steps.length > 0;

  return (
    <li className="rounded-control border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line px-2.5 py-1.5">
        <span
          className="rounded-chip px-1.5 py-px font-mono text-[10px] font-semibold"
          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
        >
          {match.depth === 0 ? t.find.inInput : t.find.depth(match.depth)}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-micro text-faint">{match.path}</span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
          {t.find.at(match.offset)}
        </span>

        {reachable ? (
          <button
            type="button"
            onClick={() => openLayer(match.steps)}
            title={t.find.openHint}
            className="flex shrink-0 items-center gap-1 rounded-control border border-accent-line bg-accent-soft px-2 py-0.5 text-micro font-medium text-text transition-colors duration-150 ease-smooth hover:border-accent"
          >
            <CornerDownRight size={11} aria-hidden="true" />
            {t.find.open}
          </button>
        ) : (
          <span className="shrink-0 text-[10px] text-faint">{t.find.embedded}</span>
        )}
      </div>

      <p className="overflow-x-auto whitespace-pre px-2.5 py-2 font-mono text-micro text-muted">
        {match.before && <span className="text-faint">…{match.before}</span>}
        <mark
          className="rounded-chip px-0.5 font-semibold"
          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
        >
          {match.match}
        </mark>
        {match.after && <span className="text-faint">{match.after}…</span>}
      </p>
    </li>
  );
}

/*
 * One box, not two.
 *
 * There used to be this one and a second input called "Flag format" sitting
 * under it. They were the same question asked twice — what should I be looking
 * for — so they are now the same field. What is typed here scans the layers
 * already in memory as you type, and the deeper pass, which unwraps the input
 * again and ranks what to try next, uses it when you ask for it.
 */
export function LayerFind() {
  const analysis = useStore((s) => s.analysis);
  const query = useStore((s) => s.searchTerm);
  const setQuery = useStore((s) => s.setSearchTerm);
  const runCtf = useStore((s) => s.runCtf);
  const running = useStore((s) => s.ctfRunning);

  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  const deferred = useDeferredValue(query);
  const valid = isValidQuery(deferred, regex);

  const matches = useMemo(() => {
    if (!analysis || deferred.trim().length === 0 || !valid) return [];
    return findInLayers(analysis.root, deferred, { regex, caseSensitive });
  }, [analysis, deferred, regex, caseSensitive, valid]);

  const layers = new Set(matches.map((m) => m.nodeId)).size;
  const searching = deferred.trim().length > 0;

  return (
    <section aria-label={t.find.region} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search
            size={13}
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 inset-s-2.5 my-auto text-faint"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.find.placeholder}
            aria-label={t.find.placeholder}
            aria-invalid={!valid}
            spellCheck={false}
            className={cx(
              'w-full rounded-control border bg-surface-2 py-2 pe-8 ps-8 font-mono text-xs2',
              'outline-hidden transition-colors duration-150 ease-smooth placeholder:font-sans placeholder:text-faint',
              valid ? 'border-line focus:border-accent-line' : 'border-danger',
            )}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t.find.clear}
              title={t.find.clear}
              className="absolute inset-y-0 inset-e-1.5 my-auto grid h-6 w-6 place-items-center rounded-sm text-faint transition-colors hover:bg-surface-3 hover:text-text"
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Toggle on={regex} onChange={setRegex} label={t.find.regex} title={t.find.regexHint}>
            <Regex size={13} aria-hidden="true" />
          </Toggle>
          <Toggle
            on={caseSensitive}
            onChange={setCaseSensitive}
            label={t.find.caseSensitive}
            title={t.find.caseHint}
          >
            <span aria-hidden="true" className="font-mono text-micro font-semibold">
              Aa
            </span>
          </Toggle>

          <button
            type="button"
            onClick={() => void runCtf()}
            disabled={running}
            title={t.find.deeperHint}
            className={cx(
              'flex items-center gap-1.5 rounded-control border border-accent-line bg-accent-soft',
              'px-2.5 py-1.5 text-micro font-medium text-text',
              'transition-colors duration-150 ease-smooth hover:border-accent disabled:opacity-50',
            )}
          >
            <RefreshCw size={12} aria-hidden="true" className={cx(running && 'animate-spin')} />
            {running ? t.ctf.working : t.find.deeper}
          </button>
        </div>
      </div>

      <p className="text-micro leading-relaxed text-faint">{t.find.hint}</p>

      {searching && (
        <p
          role="status"
          className={cx('text-micro', valid ? 'text-muted' : 'text-danger')}
        >
          {!valid
            ? t.find.badPattern
            : matches.length === 0
              ? t.find.none
              : t.find.count(matches.length, layers)}
        </p>
      )}

      {matches.length > 0 && (
        <ul className="space-y-1.5">
          {matches.map((match, index) => (
            <Hit key={`${match.nodeId}-${match.offset}-${index}`} match={match} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Toggle({
  on,
  onChange,
  label,
  title,
  children,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      aria-label={label}
      title={title}
      className={cx(
        'grid h-8 w-8 place-items-center rounded-control border transition-colors duration-150 ease-smooth',
        on
          ? 'border-accent-line bg-accent-soft text-text'
          : 'border-line text-faint hover:border-line-strong hover:text-muted',
      )}
    >
      {children}
    </button>
  );
}
