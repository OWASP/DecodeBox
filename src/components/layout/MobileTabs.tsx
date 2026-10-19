import { FileInput, FileOutput, ListOrdered, Wrench } from 'lucide-react';
import { useStore, type MobilePane } from '../../store/useStore';
import { t } from '../../i18n/en';
import { cx } from '../ui/helpers';

const TABS: Array<{ id: MobilePane; label: string; Icon: typeof Wrench }> = [
  { id: 'input', label: t.input.title, Icon: FileInput },
  { id: 'recipe', label: t.recipe.title, Icon: ListOrdered },
  { id: 'output', label: t.output.title, Icon: FileOutput },
  { id: 'operations', label: t.operations.title, Icon: Wrench },
];

export function MobileTabs() {
  const mobilePane = useStore((s) => s.mobilePane);
  const setMobilePane = useStore((s) => s.setMobilePane);
  const steps = useStore((s) => s.steps);
  const chain = useStore((s) => s.chain);

  const badge: Partial<Record<MobilePane, number>> = {
    recipe: steps.length,
    output: chain.length > 1 ? chain.length - 1 : 0,
  };

  return (
    <nav
      aria-label={t.layout.panes}
      className="flex shrink-0 border-t border-line bg-surface"
    >
      {TABS.map(({ id, label, Icon }) => {
        const active = mobilePane === id;
        const count = badge[id] ?? 0;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setMobilePane(id)}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors duration-150 ease-smooth',
              active ? 'text-text' : 'text-faint hover:text-muted',
            )}
          >
            <span className="relative">
              <Icon size={16} aria-hidden="true" />
              {count > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -inset-e-1.5 -top-1 grid h-3 min-w-3 place-items-center rounded-full px-0.5 font-mono text-[9px] text-bg"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  {count}
                </span>
              )}
            </span>
            <span className="text-[10px] uppercase tracking-wider">{label}</span>
            <span
              aria-hidden="true"
              className={cx('h-px w-6 rounded-full', active ? 'bg-accent' : 'bg-transparent')}
            />
          </button>
        );
      })}
    </nav>
  );
}
