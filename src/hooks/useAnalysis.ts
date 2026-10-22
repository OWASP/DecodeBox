import { useEffect } from 'react';
import { useStore } from '../store/useStore';

const DEBOUNCE_MS = 220;

/*
 * Re-runs everything once the input stops changing.
 *
 * Switching views is not a change. It used to be, and opening the Search view
 * then started a second deeper pass 220 ms after the one the view starts for
 * itself — reading the search box at whatever point the typing had reached. A
 * screen recording caught it answering for "f" while the box said "flag{".
 * The view is read when the input changes, not when the timer fires, so opening
 * the view inside those 220 ms does not bring the second pass back.
 */
export function watchInput(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.input === previous.input && state.autoBake === previous.autoBake) return;

    clearTimeout(timer);
    if (state.input.trim().length === 0) return;

    const { autoBake, view, analyse, runRecipe, runCtf } = state;
    timer = setTimeout(() => {
      void analyse();
      if (autoBake) void runRecipe();
      if (view === 'ctf') void runCtf();
    }, DEBOUNCE_MS);
  });

  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}

export function useAnalysis() {
  useEffect(() => watchInput(), []);
}
