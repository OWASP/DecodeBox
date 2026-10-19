import { useEffect } from 'react';
import { useStore } from '../store/useStore';


function focusWhenReady(selector: string, attempts = 20) {
  const tick = (left: number) => {
    const found = document.querySelector<HTMLInputElement>(selector);
    if (found) {
      found.focus();
      found.select();
      return;
    }
    if (left > 0) window.setTimeout(() => tick(left - 1), 25);
  };
  tick(attempts);
}

export function useHotkeys() {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const state = useStore.getState();
      const mod = event.ctrlKey || event.metaKey;

      if (event.key === 'Escape') {
        if (state.dialog !== null) return;
        if (state.whyOpen) {
          state.toggleWhy();
          return;
        }
        if (state.outputMaximised) state.setOutputMaximised(false);
        return;
      }

      if (event.altKey && !mod && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copyOutput(state);
        return;
      }

      if (!mod) return;

      switch (event.key.toLowerCase()) {
        case 'enter': {
          event.preventDefault();
          void state.runRecipe();
          return;
        }
        case 'c': {
          if (!event.shiftKey) return;
          event.preventDefault();
          copyOutput(state);
          return;
        }
        case 'b': {
          event.preventDefault();
          state.setSidebarOpen(!state.sidebarOpen);
          return;
        }
        case 'k': {
          event.preventDefault();
          state.setActivity('operations');
          state.setSidebarOpen(true);
          focusWhenReady('input[type="search"]');
          return;
        }
        case 's': {
          event.preventDefault();
          state.setDialog('library');
          return;
        }
        case 'l': {
          event.preventDefault();
          state.setDialog('share');
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

function copyOutput(state: ReturnType<typeof useStore.getState>) {
  const active = state.chain.find((l) => l.id === state.activeLayerId);
  const output =
    state.steps.length > 0 ? (state.bakeResult?.output ?? '') : (active?.output ?? '');
  if (!output) return;
  void navigator.clipboard.writeText(output).catch(() => undefined);
}
