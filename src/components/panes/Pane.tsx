import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cx } from '../ui/helpers';

interface Props {
  title: string;
  step?: number;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Pane({ title, step, meta, actions, children, className }: Props) {
  return (
    <section
      aria-label={title}
      className={cx('flex min-h-0 min-w-0 flex-1 flex-col bg-bg', className)}
    >
      <div className="flex h-[24px] shrink-0 items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="flex items-center gap-1.5 text-[11px] leading-none text-faint">
            {step !== undefined && (
              <>
                <span className="tabular-nums">{step}</span>
                <ChevronRight size={11} aria-hidden="true" className="opacity-60" />
              </>
            )}
            <span className="truncate">{title}</span>
          </h2>
          {meta}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </section>
  );
}
