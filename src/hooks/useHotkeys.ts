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
    // A hotkey is ours once we act on it: suppress the browser default and stop
    // it reaching other listeners. Running in the capture phase means this wins
    // before a bubble-phase listener on a descendent (or the window itself) can
    // claim the same chord — Cmd/Ctrl+K must not be stolen by the address bar.
    const claim = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handler = (event: KeyboardEvent) => {
      const state = useStore.getState();
      const mod = event.ctrlKey || event.metaKey;

      if (event.key === 'Escape') {
        if (state.dialog !== null) return;
        if (state.whyOpen) {
          claim(event);
          state.toggleWhy();
          return;
        }
        if (state.outputMaximised) {
          claim(event);
          state.setOutputMaximised(false);
        }
        return;
      }

      if (event.altKey && !mod && event.key.toLowerCase() === 'c') {
        claim(event);
        copyOutput(state);
        return;
      }

      if (!mod) return;

      switch (event.key.toLowerCase()) {
        case 'enter': {
          claim(event);
          void state.runRecipe();
          return;
        }
        case 'c': {
          if (!event.shiftKey) return;
          claim(event);
          copyOutput(state);
          return;
        }
        case 'b': {
          claim(event);
          state.setSidebarOpen(!state.sidebarOpen);
          return;
        }
        case 'k': {
          claim(event);
          state.setActivity('operations');
          state.setSidebarOpen(true);
          focusWhenReady('input[type="search"]');
          return;
        }
        case 's': {
          claim(event);
          state.setDialog('library');
          return;
        }
        case 'l': {
          claim(event);
          state.setDialog('share');
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);
}

function copyOutput(state: ReturnType<typeof useStore.getState>) {
  const active = state.chain.find((l) => l.id === state.activeLayerId);
  const output =
    state.steps.length > 0 ? (state.bakeResult?.output ?? '') : (active?.output ?? '');
  if (!output) return;
  void navigator.clipboard.writeText(output).catch(() => undefined);
}
