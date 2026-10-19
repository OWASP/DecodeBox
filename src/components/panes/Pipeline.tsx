import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  GripVertical,
  Play,
  Plus,
  SkipForward,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { t } from '../../i18n/en';
import { cx } from '../ui/helpers';
import { ArgControl } from './ArgControls';
import { dropTarget } from './reorder';


const OP_MIME = 'application/x-decodebox-op';

const DRAG_THRESHOLD = 4;

const SCROLL_EDGE = 48;
const SCROLL_SPEED = 12;

type Drag = {
  uid: string;
  from: number;
  to: number;
  x: number;
  y: number;
  outside: boolean;
  name: string;
};

function carriesOperation(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(OP_MIME);
}

function DropSlot({
  index,
  active,
  onEnter,
  onDrop,
}: {
  index: number;
  active: boolean;
  onEnter: (index: number) => void;
  onDrop: (event: React.DragEvent, index: number) => void;
}) {
  return (
    <div
      onDragOver={(event) => {
        if (!carriesOperation(event)) return;
        event.preventDefault();
        onEnter(index);
      }}
      onDrop={(event) => onDrop(event, index)}
      className="relative h-2 shrink-0"
    >
      <span
        aria-hidden="true"
        className={cx(
          'absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full transition-colors duration-100',
          active ? 'bg-accent' : 'bg-transparent',
        )}
      />
    </div>
  );
}

function Block({
  index,
  drag,
  onGrab,
  register,
}: {
  index: number;
  drag: Drag | null;
  onGrab: (event: React.PointerEvent, uid: string, index: number, name: string) => void;
  register: (uid: string, el: HTMLElement | null) => void;
}) {
  const step = useStore((s) => s.steps[index]);
  const stepCount = useStore((s) => s.steps.length);
  const operations = useStore((s) => s.operations);
  const breakpoints = useStore((s) => s.breakpoints);
  const pausedAt = useStore((s) => s.pausedAt);
  const error = useStore((s) => s.bakeResult?.error);
  const removeStep = useStore((s) => s.removeStep);
  const moveStep = useStore((s) => s.moveStep);
  const toggleStep = useStore((s) => s.toggleStep);
  const toggleBreakpoint = useStore((s) => s.toggleBreakpoint);
  const updateArg = useStore((s) => s.updateArg);

  const [open, setOpen] = useState(true);

  if (!step) return null;
  const op = operations.find((o) => o.id === step.opId);
  const name = op?.name ?? step.opId;
  const hasBreak = breakpoints.includes(step.uid);
  const failed = error?.stepIndex === index;
  const paused = pausedAt === index;
  const dragging = drag?.uid === step.uid;
  const doomed = dragging && drag.outside;

  return (
    <section
      ref={(el) => register(step.uid, el)}
      aria-label={name}
      className={cx(
        'shrink-0 rounded-control border bg-surface transition-[opacity,border-color] duration-100',
        dragging && 'opacity-40',
        step.disabled && !dragging && 'opacity-50',
        doomed
          ? 'border-danger'
          : failed
            ? 'border-danger'
            : paused
              ? 'border-accent-line'
              : 'border-line',
      )}
    >
      <header
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('[data-no-drag]')) return;
          onGrab(event, step.uid, index, name);
        }}
        className={cx(
          'flex select-none items-center gap-1 py-0.5 pe-1 ps-0.5',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <button
          type="button"
          data-grip
          aria-label={t.recipe.dragOrKeys(name, index + 1, stepCount)}
          title={t.recipe.drag}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              moveStep(step.uid, event.key === 'ArrowUp' ? -1 : 1);
            } else if (event.key === 'Delete' || event.key === 'Backspace') {
              event.preventDefault();
              removeStep(step.uid);
            }
          }}
          className="grid h-6 w-5 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-faint transition-colors hover:bg-surface-3 hover:text-muted active:cursor-grabbing"
        >
          <GripVertical size={12} aria-hidden="true" />
        </button>

        <button
          type="button"
          data-no-drag
          onClick={() => toggleBreakpoint(step.uid)}
          aria-label={hasBreak ? t.recipe.clearBreakpoint : t.recipe.setBreakpoint}
          aria-pressed={hasBreak}
          title={hasBreak ? t.recipe.clearBreakpoint : t.recipe.setBreakpoint}
          className="grid h-6 w-5 shrink-0 place-items-center rounded-sm"
        >
          <Circle
            size={8}
            aria-hidden="true"
            style={
              hasBreak
                ? { fill: 'var(--amber)', color: 'var(--amber)' }
                : paused
                  ? { fill: 'var(--accent)', color: 'var(--accent-text)' }
                  : { color: 'var(--text-faint)' }
            }
          />
        </button>

        <span className="w-4 shrink-0 text-end font-mono text-[10px] tabular-nums text-faint">
          {index + 1}
        </span>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title={op?.description}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1 py-0.5 text-start"
        >
          <span
            className={cx(
              'truncate font-mono text-xs2',
              step.disabled ? 'text-faint line-through' : 'text-text',
            )}
          >
            {name}
          </span>
          {step.args.length > 0 && (
            <ChevronDown
              size={11}
              aria-hidden="true"
              className={cx(
                'shrink-0 text-faint transition-transform duration-150',
                open && 'rotate-180',
              )}
            />
          )}
        </button>

        <button
          type="button"
          data-no-drag
          onClick={() => toggleStep(step.uid)}
          aria-label={step.disabled ? t.recipe.enable : t.recipe.disable}
          title={step.disabled ? t.recipe.enable : t.recipe.disable}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-faint transition-colors hover:bg-surface-3 hover:text-text"
        >
          {step.disabled ? (
            <EyeOff size={12} aria-hidden="true" />
          ) : (
            <Eye size={12} aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          data-no-drag
          onClick={() => removeStep(step.uid)}
          aria-label={t.recipe.remove}
          title={t.recipe.remove}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-faint transition-colors hover:bg-surface-3 hover:text-danger"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </header>

      {open && step.args.length > 0 && (
        <div className="grid gap-1.5 border-t border-line px-2 py-1.5">
          {step.args.map((arg) => (
            <ArgControl
              key={arg.name}
              stepUid={step.uid}
              arg={arg}
              onChange={(patch) => updateArg(step.uid, arg.name, patch)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function Pipeline() {
  const steps = useStore((s) => s.steps);
  const removeStep = useStore((s) => s.removeStep);
  const result = useStore((s) => s.bakeResult);
  const autoBake = useStore((s) => s.autoBake);
  const baking = useStore((s) => s.baking);
  const pausedAt = useStore((s) => s.pausedAt);
  const addStep = useStore((s) => s.addStep);
  const reorderStep = useStore((s) => s.reorderStep);
  const setAutoBake = useStore((s) => s.setAutoBake);
  const runRecipe = useStore((s) => s.runRecipe);
  const stepOnce = useStore((s) => s.stepOnce);
  const clearRecipe = useStore((s) => s.clearRecipe);
  const focusSearch = useStore((s) => s.focusSearch);
  const rewrapRecipe = useStore((s) => s.rewrapRecipe);
  const rewrapBlockers = useStore((s) => s.rewrapBlockers);
  const dismissRewrapBlockers = useStore((s) => s.dismissRewrapBlockers);

  const [drag, setDrag] = useState<Drag | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);

  const paneRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const blocks = useRef(new Map<string, HTMLElement>());

  const live = useRef<{
    uid: string;
    from: number;
    to: number;
    started: boolean;
    outside: boolean;
    x0: number;
    y0: number;
  } | null>(null);
  const justDragged = useRef(false);
  const scrolling = useRef(0);

  const register = useCallback((uid: string, el: HTMLElement | null) => {
    if (el) blocks.current.set(uid, el);
    else blocks.current.delete(uid);
  }, []);

  const paused = pausedAt !== null;
  const empty = steps.length === 0;

  const targetFor = useCallback((y: number, from: number): number => {
    const spans = useStore
      .getState()
      .steps.map((step) => blocks.current.get(step.uid)?.getBoundingClientRect())
      .map((r) => ({ top: r?.top ?? Infinity, height: r?.height ?? 0 }));
    return dropTarget(y, spans, from);
  }, []);

  const autoScroll = useCallback((y: number) => {
    const list = listRef.current;
    if (!list) return;
    const r = list.getBoundingClientRect();
    if (y < r.top + SCROLL_EDGE) scrolling.current = -SCROLL_SPEED;
    else if (y > r.bottom - SCROLL_EDGE) scrolling.current = SCROLL_SPEED;
    else scrolling.current = 0;
  }, []);

  useEffect(() => {
    if (!drag) return;
    let frame = 0;
    const tick = () => {
      if (scrolling.current !== 0) listRef.current?.scrollBy(0, scrolling.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drag]);

  const onGrab = useCallback(
    (event: React.PointerEvent, uid: string, from: number, name: string) => {
      if (event.button !== 0) return;
      live.current = {
        uid,
        from,
        to: from,
        started: false,
        outside: false,
        x0: event.clientX,
        y0: event.clientY,
      };
      let inside = true;

      const move = (e: PointerEvent) => {
        const state = live.current;
        if (!state) return;

        if (!state.started) {
          if (Math.hypot(e.clientX - state.x0, e.clientY - state.y0) < DRAG_THRESHOLD) return;
          state.started = true;
          document.body.style.cursor = 'grabbing';
        }

        e.preventDefault();
        const to = targetFor(e.clientY, state.from);
        state.to = to;
        autoScroll(e.clientY);

        const box = paneRef.current?.getBoundingClientRect();
        const outside = box
          ? e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          : false;
        state.outside = outside;

        setDrag({ uid, from: state.from, to, x: e.clientX, y: e.clientY, outside, name });
        setSlot(outside ? null : to);
      };

      const finish = (commit: boolean) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', onKey);
        document.body.style.cursor = '';
        scrolling.current = 0;

        const state = live.current;
        live.current = null;

        if (commit && state?.started) {
          if (state.outside) removeStep(state.uid);
          else if (state.to !== state.from) reorderStep(state.uid, state.to);
        }

        setDrag(null);
        setSlot(null);

        justDragged.current = state?.started === true && inside;
      };

      const up = (e: PointerEvent) => {
        const box = paneRef.current?.getBoundingClientRect();
        inside = box
          ? e.clientX >= box.left &&
            e.clientX <= box.right &&
            e.clientY >= box.top &&
            e.clientY <= box.bottom
          : true;
        finish(true);
      };
      const cancel = () => finish(false);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') finish(false);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', onKey);
    },
    [autoScroll, removeStep, reorderStep, targetFor],
  );

  const onOperationDrop = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    const opId = event.dataTransfer.getData(OP_MIME);
    if (opId) addStep(opId, index);
    setSlot(null);
    setDropping(false);
  };

  return (
    <section
      ref={paneRef}
      aria-label={t.recipe.title}
      onDragOver={(event) => {
        if (!carriesOperation(event)) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropping(false);
        setSlot(null);
      }}
      onDrop={(event) => onOperationDrop(event, steps.length)}
      onPointerDownCapture={() => {
        if (!live.current) justDragged.current = false;
      }}
      onClickCapture={(event) => {
        if (!justDragged.current) return;
        justDragged.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      className={cx(
        'relative flex min-h-0 min-w-0 flex-1 flex-col bg-bg transition-colors duration-150',
        dropping && 'bg-accent-wash',
      )}
    >
      <header className="flex h-[24px] shrink-0 items-center gap-1.5 px-2 text-[11px] leading-none text-faint">
        <span className="tabular-nums">2</span>
        <ChevronRight size={11} aria-hidden="true" className="opacity-60" />
        <span>{t.recipe.title}</span>
        <span className="font-mono tabular-nums">{steps.length}</span>
        {paused && (
          <span className="font-mono text-micro" style={{ color: 'var(--amber)' }}>
            {t.recipe.pausedAt(pausedAt + 1)}
          </span>
        )}

        <span className="ms-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void stepOnce()}
            disabled={!paused}
            aria-label={t.recipe.step}
            title={t.recipe.step}
            className="grid h-6 w-6 place-items-center rounded-sm text-faint transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-30"
          >
            <SkipForward size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={rewrapRecipe}
            disabled={empty}
            aria-label={t.recipe.rewrap}
            title={t.recipe.rewrapHint}
            className="grid h-6 w-6 place-items-center rounded-xs text-faint transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-30"
          >
            <Undo2 size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={clearRecipe}
            disabled={empty}
            aria-label={t.recipe.clear}
            title={t.recipe.clear}
            className="grid h-6 w-6 place-items-center rounded-sm text-faint transition-colors hover:bg-surface-3 hover:text-danger disabled:opacity-30"
          >
            <Trash2 size={12} aria-hidden="true" />
          </button>
        </span>
      </header>

      {rewrapBlockers && (
        <div
          role="alert"
          className="shrink-0 border-b border-line px-2 py-1.5"
          style={{ backgroundColor: 'var(--amber-wash)' }}
        >
          <div className="flex items-start gap-1.5">
            <Undo2 size={11} aria-hidden="true" className="mt-[3px] shrink-0" style={{ color: 'var(--amber)' }} />
            <div className="min-w-0 flex-1">
              <p className="text-micro font-medium text-text">{t.recipe.rewrapBlocked}</p>
              <ul className="mt-1 grid gap-0.5">
                {rewrapBlockers.map((blocker) => (
                  <li key={`${blocker.position}-${blocker.opId}`} className="text-micro text-muted">
                    <span className="font-mono tabular-nums text-faint">{blocker.position}.</span>{' '}
                    {blocker.reason}
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={dismissRewrapBlockers}
              aria-label={t.recipe.dismiss}
              title={t.recipe.dismiss}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-xs text-faint hover:bg-surface-3 hover:text-text"
            >
              <X size={11} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {drag?.outside && (
        <p
          role="status"
          className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1 text-micro font-medium"
          style={{ color: 'var(--red)', backgroundColor: 'var(--amber-wash)' }}
        >
          <Trash2 size={11} aria-hidden="true" />
          {t.recipe.dropToRemove}
        </p>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        <DropSlot index={0} active={slot === 0} onEnter={setSlot} onDrop={onOperationDrop} />

        {steps.map((step, index) => (
          <div key={step.uid}>
            <Block index={index} drag={drag} onGrab={onGrab} register={register} />
            <DropSlot
              index={index + 1}
              active={slot === index + 1}
              onEnter={setSlot}
              onDrop={onOperationDrop}
            />
          </div>
        ))}

        <button
          type="button"
          onClick={focusSearch}
          onDragOver={(event) => {
            if (!carriesOperation(event)) return;
            event.preventDefault();
            setSlot(steps.length);
          }}
          onDrop={(event) => onOperationDrop(event, steps.length)}
          className={cx(
            'flex w-full items-center justify-center gap-1.5 rounded-control border border-dashed py-2',
            'text-micro transition-colors duration-150 ease-smooth',
            slot === steps.length
              ? 'border-accent bg-accent-soft text-text'
              : 'border-line text-faint hover:border-accent-line hover:text-text',
          )}
        >
          <Plus size={11} aria-hidden="true" />
          {empty ? t.recipe.addFirst : t.recipe.add}
        </button>
      </div>

      {drag && (
        <div
          aria-hidden="true"
          style={{ left: drag.x + 12, top: drag.y + 8 }}
          className={cx(
            'pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-control border px-2 py-1 font-mono text-xs2 shadow-lg',
            drag.outside ? 'border-danger bg-surface' : 'border-accent bg-surface',
          )}
        >
          {drag.outside ? (
            <Trash2 size={11} style={{ color: 'var(--red)' }} />
          ) : (
            <GripVertical size={11} className="text-faint" />
          )}
          <span className={drag.outside ? 'line-through' : undefined} style={{ color: 'var(--text)' }}>
            {drag.name}
          </span>
        </div>
      )}

      <footer className="flex h-10 shrink-0 items-center gap-2 border-t border-line bg-surface px-2">
        <label
          className="flex cursor-pointer items-center gap-1.5 rounded-control py-1 text-micro text-faint transition-colors hover:text-muted"
          title={t.recipe.autoBakeHint}
        >
          <input
            type="checkbox"
            checked={autoBake}
            onChange={(e) => setAutoBake(e.target.checked)}
            className="h-3 w-3 accent-(--accent)"
          />
          {autoBake ? t.recipe.autoBaking : t.recipe.autoBake}
        </label>

        {result && !result.error && (
          <span className="font-mono text-micro tabular-nums text-faint">
            {result.durationMs.toFixed(1)} ms
          </span>
        )}

        <button
          type="button"
          onClick={() => void runRecipe()}
          disabled={empty}
          className={cx(
            'ms-auto flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs2 font-semibold',
            'transition-colors duration-150 ease-smooth',
            empty
              ? 'border border-line text-muted'
              : autoBake
                ? 'border border-accent-line bg-accent-wash text-accent-text hover:bg-accent-soft'
                : 'bg-accent text-white hover:brightness-110',
          )}
        >
          <Play size={12} aria-hidden="true" />
          {baking ? t.recipe.baking : autoBake && !empty ? t.recipe.rerun : t.recipe.bake}
        </button>
      </footer>
    </section>
  );
}
