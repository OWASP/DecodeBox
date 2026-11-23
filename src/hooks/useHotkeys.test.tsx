// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let root: Root;
let container: HTMLDivElement;

async function mount() {
  vi.resetModules();
  const { useStore } = await import('../store/useStore');
  const { useHotkeys } = await import('./useHotkeys');
  const { OperationsPane } = await import('../components/panes/OperationsPane');
  await useStore.getState().loadOperations();
  function App() {
    useHotkeys();
    return <OperationsPane />;
  }
  root = createRoot(container);
  await act(() => root.render(<App />));
  return useStore;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useHotkeys', () => {
  it('opens the operations sidebar and focuses search on Ctrl+K', async () => {
    const store = await mount();
    act(() => {
      store.setState({ sidebarOpen: false, activity: 'detection' });
    });

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(event));

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(event.defaultPrevented).toBe(true);
    expect(store.getState().sidebarOpen).toBe(true);
    expect(store.getState().activity).toBe('operations');
    expect(document.activeElement).toBe(container.querySelector('input[type="search"]'));
  });

  it('opens the operations sidebar and focuses search on Cmd+K', async () => {
    const store = await mount();
    act(() => {
      store.setState({ sidebarOpen: false, activity: 'detection' });
    });

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(event));

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(event.defaultPrevented).toBe(true);
    expect(store.getState().sidebarOpen).toBe(true);
    expect(store.getState().activity).toBe('operations');
    expect(document.activeElement).toBe(container.querySelector('input[type="search"]'));
  });

  it('toggles the sidebar on Ctrl/Cmd+B', async () => {
    const store = await mount();
    act(() => store.setState({ sidebarOpen: true }));

    const event = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(event));

    expect(store.getState().sidebarOpen).toBe(false);
  });
});