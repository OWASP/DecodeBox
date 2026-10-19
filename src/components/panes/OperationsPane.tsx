import { Fragment, useMemo, useState } from 'react';
import { ChevronRight, FileCode2, Folder, FolderOpen, Search, Star, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { CATEGORY_ORDER, type OperationDef } from '../../engine';
import { t } from '../../i18n/en';
import { cx } from '../ui/helpers';

const FAVOURITES = 'Favourites';
const RECENT = 'Recent';

const PERSONAL = [FAVOURITES, RECENT];

function score(op: OperationDef, query: string): number {
  const q = query.toLowerCase();
  const name = op.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (op.aliases.some((a) => a.toLowerCase().startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  if (op.aliases.some((a) => a.toLowerCase().includes(q))) return 4;
  if (op.description.toLowerCase().includes(q)) return 5;
  return -1;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent font-semibold" style={{ color: 'var(--accent-text)' }}>
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}

function Row({ op, query }: { op: OperationDef; query: string }) {
  const addStep = useStore((s) => s.addStep);
  const favourites = useStore((s) => s.favourites);
  const toggleFavourite = useStore((s) => s.toggleFavourite);
  const starred = favourites.includes(op.id);

  const alias =
    query && !op.name.toLowerCase().includes(query.toLowerCase())
      ? op.aliases.find((a) => a.toLowerCase().includes(query.toLowerCase()))
      : undefined;

  return (
    <li>
      <div
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-decodebox-op', op.id);
          event.dataTransfer.effectAllowed = 'copy';
        }}
        className="db-row group relative flex cursor-pointer items-center gap-1 pe-1 ps-[22px]"
        title={op.description}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 inset-s-[11px] w-px"
          style={{ backgroundColor: 'var(--indent-guide)' }}
        />

        <FileCode2
          size={13}
          aria-hidden="true"
          className="shrink-0"
          style={{ color: op.isFlowControl ? 'var(--amber)' : 'var(--blue)' }}
        />

        <button
          type="button"
          onClick={() => addStep(op.id)}
          className="flex min-w-0 flex-1 items-baseline gap-2 py-[3px] text-start"
        >
          <span
            className={cx(
              'truncate text-[13px] font-medium leading-[18px] group-hover:text-text',
              op.isFlowControl ? 'italic text-muted' : 'text-text',
            )}
          >
            <Highlight text={op.name} query={query} />
          </span>
          {alias && (
            <span className="shrink-0 truncate font-mono text-[10px] text-faint">
              <Highlight text={alias} query={query} />
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label={starred ? t.operations.unstar(op.name) : t.operations.star(op.name)}
          aria-pressed={starred}
          onClick={() => toggleFavourite(op.id)}
          className={cx(
            'shrink-0 rounded-xs p-0.5 transition-opacity',
            starred ? 'opacity-100' : 'opacity-0 group-hover:opacity-70 hover:opacity-100!',
          )}
        >
          <Star
            size={11}
            aria-hidden="true"
            style={starred ? { fill: 'var(--amber)', color: 'var(--amber)' } : undefined}
            className={starred ? undefined : 'text-faint'}
          />
        </button>
      </div>
    </li>
  );
}

function CategoryFolder({
  name,
  count,
  open,
  onToggle,
}: {
  name: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <h3>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="db-row flex w-full items-center gap-1 py-[3px] pe-1.5 ps-0.5 text-start"
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={cx('shrink-0 text-muted transition-transform duration-100', open && 'rotate-90')}
        />
        {open ? (
          <FolderOpen size={13} aria-hidden="true" className="shrink-0" style={{ color: 'var(--amber)' }} />
        ) : (
          <Folder size={13} aria-hidden="true" className="shrink-0" style={{ color: 'var(--amber)' }} />
        )}
        <span className="flex-1 truncate text-[13px] font-semibold leading-[18px] text-muted">{name}</span>
        <span className="font-mono text-[10px] tabular-nums text-faint">{count}</span>
      </button>
    </h3>
  );
}

export function OperationsPane() {
  const operations = useStore((s) => s.operations);
  const favourites = useStore((s) => s.favourites);
  const recent = useStore((s) => s.recent);
  const addStep = useStore((s) => s.addStep);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<string[]>([]);
  const grouped = useMemo(() => {
    const q = query.trim();
    const matched = q
      ? operations
          .map((op) => ({ op, rank: score(op, q) }))
          .filter((entry) => entry.rank >= 0)
          .sort((a, b) => a.rank - b.rank || a.op.name.localeCompare(b.op.name))
          .map((entry) => entry.op)
      : operations;

    const byCategory = new Map<string, OperationDef[]>();
    const starred = matched.filter((op) => favourites.includes(op.id));
    if (starred.length > 0) byCategory.set(FAVOURITES, starred);

    const lately = recent
      .filter((id) => !favourites.includes(id))
      .map((id) => matched.find((op) => op.id === id))
      .filter((op): op is OperationDef => op !== undefined);
    if (lately.length > 0) byCategory.set(RECENT, lately);

    for (const op of matched) {
      const list = byCategory.get(op.category) ?? [];
      list.push(op);
      byCategory.set(op.category, list);
    }

    return [...byCategory.entries()].sort((a, b) => {
      const ai = PERSONAL.indexOf(a[0]);
      const bi = PERSONAL.indexOf(b[0]);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return (CATEGORY_ORDER.indexOf(a[0]) + 1 || 99) - (CATEGORY_ORDER.indexOf(b[0]) + 1 || 99);
    });
  }, [operations, favourites, recent, query]);

  const topMatch = useMemo(() => {
    const q = query.trim();
    if (!q) return undefined;
    return grouped.find(([name]) => !PERSONAL.includes(name))?.[1][0];
  }, [grouped, query]);

  const total = grouped.reduce((n, [name, ops]) => n + (name === FAVOURITES ? 0 : ops.length), 0);
  const searching = query.trim().length > 0;

  return (
    <section aria-label={t.operations.title} className="flex min-h-0 flex-1 flex-col bg-surface">
      <h2 className="flex h-9 shrink-0 items-center gap-2 px-4 text-[11px] font-normal uppercase tracking-[0.08em] text-muted">
        <span className="flex-1 truncate">{t.operations.title}</span>
        <span className="font-mono text-[10px] tabular-nums text-faint">
          {searching ? t.operations.matches(total, operations.length) : operations.length}
        </span>
      </h2>

      <div className="shrink-0 px-2 pb-1.5">
        <div className="relative">
          <Search
            size={12}
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 inset-s-2 my-auto text-faint"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && topMatch) {
                event.preventDefault();
                addStep(topMatch.id);
              }
            }}
            placeholder={t.operations.search}
            aria-label={t.operations.search}
            aria-describedby="operation-search-hint"
            spellCheck={false}
            className="w-full rounded-xs border border-line bg-surface-2 py-1 pe-14 ps-6 text-[12px] outline-hidden transition-colors duration-150 placeholder:text-faint focus:border-accent-line"
          />

          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={t.operations.clear}
              title={t.operations.clear}
              className="absolute inset-y-0 inset-e-1 my-auto grid h-5 w-5 place-items-center rounded-xs text-faint transition-colors hover:bg-surface-3 hover:text-text"
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : (
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 inset-e-1.5 my-auto flex h-[16px] items-center rounded-xs border border-line px-1 font-mono text-[10px] text-faint"
            >
              {t.operations.shortcut}
            </kbd>
          )}
        </div>

        <p id="operation-search-hint" className="sr-only">
          {t.operations.searchHint}
        </p>

        {topMatch && (
          <p className="mt-1 truncate text-[10px] text-faint">
            {t.operations.enterAdds(topMatch.name)}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-faint">
            {operations.length === 0 ? t.operations.loading : t.operations.noResults}
          </p>
        ) : (
          grouped.map(([name, ops]) => {
            const open = searching || !closed.includes(name);
            return (
              <Fragment key={name}>
                <CategoryFolder
                  name={name}
                  count={ops.length}
                  open={open}
                  onToggle={() =>
                    setClosed((c) => (c.includes(name) ? c.filter((n) => n !== name) : [...c, name]))
                  }
                />
                {open && (
                  <ul>
                    {ops.map((op) => (
                      <Row key={op.id} op={op} query={searching ? query.trim() : ''} />
                    ))}
                  </ul>
                )}
              </Fragment>
            );
          })
        )}
      </div>
    </section>
  );
}
