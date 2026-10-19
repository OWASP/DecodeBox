import { useEffect } from 'react';
import { useStore } from '../store/useStore';

const DEBOUNCE_MS = 220;

export function useAnalysis() {
  const input = useStore((s) => s.input);
  const autoBake = useStore((s) => s.autoBake);
  const view = useStore((s) => s.view);
  const analyse = useStore((s) => s.analyse);
  const runRecipe = useStore((s) => s.runRecipe);
  const runCtf = useStore((s) => s.runCtf);

  useEffect(() => {
    if (input.trim().length === 0) return;

    const timer = setTimeout(() => {
      void analyse();
      if (autoBake) void runRecipe();
      if (view === 'ctf') void runCtf();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [input, autoBake, view, analyse, runRecipe, runCtf]);
}
