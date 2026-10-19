import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { confidenceColor, cx } from './helpers';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'primary';
  children: ReactNode;
}

export function Button({ variant = 'default', className, children, ...rest }: ButtonProps) {
  const base =
    'inline-flex items-center gap-2 rounded-control px-3 py-1.5 text-xs2 font-medium ' +
    'transition-colors duration-150 ease-smooth disabled:opacity-40 disabled:pointer-events-none';
  const variants = {
    default: 'border border-line text-text hover:border-line-strong hover:bg-surface-3',
    ghost: 'text-muted hover:text-text hover:bg-surface-3',
    primary: 'border border-accent-line bg-accent-soft text-text hover:border-accent',
  };
  return (
    <button type="button" className={cx(base, variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function IconButton({ label, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-grid h-8 w-8 place-items-center rounded-control text-muted',
        'transition-colors duration-150 ease-smooth hover:bg-surface-3 hover:text-text',
        'disabled:opacity-40 disabled:pointer-events-none',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx('rounded-card border border-line bg-surface', className)}>{children}</div>
  );
}

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border border-line px-2 py-0.5',
        'font-mono text-[10px] uppercase tracking-wider text-faint',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span
      role="img"
      aria-label={`${pct} percent confident`}
      className="inline-block h-1 w-10 overflow-hidden rounded-full bg-surface-3 align-middle"
    >
      <span
        className="block h-full rounded-full transition-[width] duration-300 ease-smooth"
        style={{ width: `${pct}%`, backgroundColor: confidenceColor(value) }}
      />
    </span>
  );
}
