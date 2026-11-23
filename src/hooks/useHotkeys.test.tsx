// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store/useStore';
import { useHotkeys } from './useHotkeys';

// Mirror the store bootstrap done by the app: applyTheme reads document.documentElement.dataset.
// happy-dom provides a document, so no manual global shim is needed here.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  useHotkeys();
  return null;
}

let container: HTMLDivElement;
let root: Root;

async function mount() {
  root = createRoot(container);
  await act(() => root.render(<Harness />));
}

function keyInit(key: string, extra: KeyboardEventInit = {}): KeyboardEventInit {
  return { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra };
}

describe('useHotkeys Cmd/Ctrl+K', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    useStore.setState({
      activity: 'operations',
      view: 'workspace',
      sidebarOpen: false,
      dialog: null,
      whyOpen: false,
      outputMaximised: false,
    });
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('opens operations and focuses search on Ctrl+K', async () => {
    await mount();
    const search = document.createElement('input');
    search.type = 'search';
    container.appendChild(search);
    const focus = vi.spyOn(search, 'focus');
    const select = vi.spyOn(search, 'select');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', keyInit('k')));
    });

    expect(useStore.getState().activity).toBe('operations');
    expect(useStore.getState().sidebarOpen).toBe(true);
    expect(focus).toHaveBeenCalled();
    expect(select).toHaveBeenCalled();
  });

  it('registers the keydown handler in the capture phase so it wins over bubble listeners', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    await mount();
    const calls = add.mock.calls as unknown as [string, EventListener, boolean | AddEventListenerOptions][];
    const call = calls.find(([type]) => type === 'keydown');
    expect(call).toBeDefined();
    // Third argument must request capture.
    expect(call![2]).toMatchObject({ capture: true });
  });

  it('stops propagation so a competing bubble-phase handler never sees the hotkey', async () => {
    await mount();
    const bubble = vi.fn();
    window.addEventListener('keydown', bubble, false);

    const child = document.createElement('button');
    container.appendChild(child);
    const event = new KeyboardEvent('keydown', keyInit('k'));

    act(() => {
      child.dispatchEvent(event);
    });

    // Capture-phase handler calls stopPropagation, so the window bubble listener is skipped.
    expect(bubble).not.toHaveBeenCalled();
    window.removeEventListener('keydown', bubble, false);
  });

  it('calls preventDefault so the browser address/search bar does not steal Ctrl+K', async () => {
    await mount();
    const event = new KeyboardEvent('keydown', keyInit('k'));
    const preventDefault = vi.spyOn(event, 'preventDefault');

    act(() => {
      window.dispatchEvent(event);
    });

    expect(preventDefault).toHaveBeenCalled();
  });
});
