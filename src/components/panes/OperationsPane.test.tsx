// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATEGORY_ORDER } from '../../engine';

let root: Root;
let container: HTMLDivElement;

async function mount() {
  vi.resetModules();
  const { useStore } = await import('../../store/useStore');
  const { OperationsPane } = await import('./OperationsPane');
  await useStore.getState().loadOperations();
  root = createRoot(container);
  await act(() => root.render(<OperationsPane />));
  return useStore;
}

function folders() {
  return [...container.querySelectorAll<HTMLButtonElement>('h3 button')];
}

function folder(name: string) {
  return folders().find(button => button.querySelector('span')?.textContent === name);
}

function click(button: HTMLButtonElement | null | undefined) {
  expect(button).toBeTruthy();
  act(() => button!.click());
}

function search(query: string) {
  const input = container.querySelector('input')!;
  act(() => {
    // Use the browser setter so React sees the edit as a user input event.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
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

describe('operation folders', () => {
  it('mounts only the ordered category folders on a fresh profile, all collapsed', async () => {
    const store = await mount();
    const ops = store.getState().operations;
    expect(folders().map(button => button.querySelector('span')?.textContent))
      .toEqual(CATEGORY_ORDER.filter(name => ops.some(op => op.category === name)));
    for (const button of folders()) expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('ul')).toBeNull();
    expect(container.textContent).not.toMatch(/Favourites|Recent/);
  });

  it('shows favourites above recent, even when the same operation belongs to both', async () => {
    const store = await mount();
    click(folder('Data format'));
    click(container.querySelector<HTMLButtonElement>('[aria-label="Add To Base64 to favourites"]'));
    expect(folder('Favourites')?.getAttribute('aria-expanded')).toBe('false');
    expect(folder('Recent')).toBeUndefined();

    const input = search('btoa');
    act(() => {
      store.getState().setAutoBake(false);
      store.getState().setInput('hello');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(store.getState().steps.map(step => step.opId)).toEqual(['to-base64']);
    expect(folder('Recent')).toBeUndefined();
    await act(() => store.getState().runRecipe());
    expect(store.getState().bakeResult?.output).toBe('aGVsbG8=');
    expect(folder('Recent')?.getAttribute('aria-expanded')).toBe('false');
    expect(folders().slice(0, 2)).toEqual([folder('Favourites'), folder('Recent')]);
    expect(container.querySelector('h2')?.textContent).toBe(`Operations1 of ${store.getState().operations.length}`);

    search('');
    click(container.querySelector<HTMLButtonElement>('[aria-label="Remove To Base64 from favourites"]'));
    expect(folder('Favourites')).toBeUndefined();
    expect(folders()[0]).toBe(folder('Recent'));
    act(() => store.setState({ recent: [] }));
    expect(folder('Recent')).toBeUndefined();
  });

  it('remembers independent choices across search, hidden sections and a full reload', async () => {
    localStorage.setItem('decodebox-favourites', '["to-hex"]');
    localStorage.setItem('decodebox-recent', '["from-base64","to-hex"]');
    const store = await mount();
    click(folder('Favourites'));
    click(folder('Recent'));
    click(folder('Recent'));
    click(folder('Hashing'));
    expect(folder('Data format')?.getAttribute('aria-expanded')).toBe('false');
    act(() => store.getState().toggleFavourite('to-hex'));
    expect(folder('Favourites')).toBeUndefined();
    act(() => store.getState().toggleFavourite('to-hex'));
    expect(folder('Favourites')?.getAttribute('aria-expanded')).toBe('true');
    search('btoa');
    expect(folder('Data format')?.getAttribute('aria-expanded')).toBe('true');
    search('');
    expect(folder('Data format')?.getAttribute('aria-expanded')).toBe('false');

    act(() => root.unmount());
    const restored = await mount();
    expect(restored.getState().favourites).toEqual(['to-hex']);
    expect(restored.getState().recent).toEqual(['from-base64', 'to-hex']);
    expect(folder('Hashing')?.getAttribute('aria-expanded')).toBe('true');
    expect(folder('Favourites')?.getAttribute('aria-expanded')).toBe('true');
    expect(folder('Recent')?.getAttribute('aria-expanded')).toBe('false');
    act(() => restored.setState({ recent: [] }));
    expect(folder('Recent')).toBeUndefined();
    await act(async () => {
      restored.getState().setAutoBake(false);
      restored.getState().addStep('to-hex');
      await restored.getState().runRecipe();
    });
    expect(folder('Recent')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows Recent on the first successful auto-bake and leaves a saved collapsed choice intact', async () => {
    localStorage.setItem('decodebox-expanded-folders', '{"Recent":false,"Data format":false}');
    const store = await mount();
    const input = search('btoa');
    act(() => {
      store.getState().setInput('hello');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(() => vi.waitFor(() => expect(store.getState().baking).toBe(false)));
    expect(store.getState().bakeResult?.output).toBe('aGVsbG8=');
    search('');
    expect(folder('Recent')?.getAttribute('aria-expanded')).toBe('false');
    expect(folder('Data format')?.getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('decodebox-expanded-folders')).toBe('{"Recent":false,"Data format":false}');
  });

  it('records only successful operations, including before a later failure or early return', async () => {
    const store = await mount();
    const state = store.getState();
    act(() => {
      state.setAutoBake(false);
      state.addStep('jump'); // The target label is absent.
    });
    await act(state.runRecipe);
    expect(store.getState().bakeResult?.error).toBeDefined();
    expect(folder('Recent')).toBeUndefined();
    act(() => state.addStep('to-base64', 0));
    await act(state.runRecipe);
    expect(store.getState().recent).toEqual(['to-base64']);

    act(() => {
      state.clearRecipe();
      state.addStep('reverse');
      state.addStep('to-hex');
      state.addStep('return');
      state.addStep('from-hex');
      const [disabled, paused] = store.getState().steps;
      state.toggleStep(disabled!.uid);
      state.toggleBreakpoint(paused!.uid);
    });
    await act(state.runRecipe);
    expect(store.getState().recent).toEqual(['to-base64']);
    await act(state.stepOnce);
    expect(store.getState().recent).toEqual(['to-hex', 'to-base64']);
    await act(state.stepOnce);
    await act(state.stepOnce);
    expect(store.getState().recent).toEqual(['return', 'to-hex', 'to-base64']);
  });

  it('keeps the eight most recently executed distinct operations, newest first', async () => {
    const store = await mount();
    const ids = ['comment', 'reverse', 'to-base64', 'to-hex', 'to-base32',
      'to-base45', 'to-base85', 'to-upper-case', 'label', 'to-hex'];
    await act(async () => {
      store.getState().setAutoBake(false);
      for (const id of ids) store.getState().addStep(id);
      await store.getState().runRecipe();
    });
    const expected = ['to-hex', 'label', 'to-upper-case', 'to-base85',
      'to-base45', 'to-base32', 'to-base64', 'reverse'];
    expect(store.getState().recent).toEqual(expected);
    expect(JSON.parse(localStorage.getItem('decodebox-recent')!)).toEqual(expected);
  });
});
