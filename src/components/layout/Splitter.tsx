import { useCallback, useRef } from 'react';
import { cx } from '../ui/helpers';

interface Props {
  value: number;
  min: number;
  max: number;
  label: string;
  axis?: 'horizontal' | 'vertical';
  onChange: (size: number) => void;
}

export function Splitter({ value, min, max, label, axis = 'horizontal', onChange }: Props) {
  const dragging = useRef(false);
  const vertical = axis === 'vertical';

  const clamp = useCallback((size: number) => Math.min(max, Math.max(min, size)), [min, max]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    const start = vertical ? event.clientY : event.clientX;
    const startSize = value;
    event.currentTarget.setPointerCapture(event.pointerId);

    const onMove = (move: PointerEvent) => {
      if (!dragging.current) return;
      if (vertical) {
        onChange(clamp(startSize + (move.clientY - start)));
        return;
      }
      const rtl = document.documentElement.dir === 'rtl';
      onChange(clamp(startSize + (move.clientX - start) * (rtl ? -1 : 1)));
    };

    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16;
    const less = vertical ? 'ArrowUp' : 'ArrowLeft';
    const more = vertical ? 'ArrowDown' : 'ArrowRight';

    if (event.key === less) {
      event.preventDefault();
      onChange(clamp(value - step));
    } else if (event.key === more) {
      event.preventDefault();
      onChange(clamp(value + step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onChange(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      onChange(max);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cx(
        'group relative z-10 shrink-0 bg-line',
        'transition-colors duration-150 ease-smooth hover:bg-accent-line focus-visible:bg-accent',
        vertical ? 'h-px w-full cursor-row-resize' : 'w-px cursor-col-resize',
      )}
    >
      <span
        aria-hidden="true"
        className={cx('absolute', vertical ? 'inset-x-0 -inset-y-1.5' : 'inset-y-0 -inset-x-1.5')}
      />
    </div>
  );
}
