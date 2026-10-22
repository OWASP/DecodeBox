import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CtfReport } from '../engine';

vi.hoisted(() => {
  // The store puts the saved theme on <html> as it loads, and there is no DOM here.
  Object.assign(globalThis, { document: { documentElement: { dataset: {} } } });
});

vi.mock('../engine', async (importOriginal) => {
  const engine = await importOriginal<typeof import('../engine')>();
  return { ...engine, hints: vi.fn(engine.hints) };
});

import { hints } from '../engine';
import { useStore } from '../store/useStore';
import { watchInput } from './useAnalysis';


const PLAIN =
  'Well done, you found it. The flag is flag{x0r_is_not_encryption} and the next stage is open.';
const HEX = Buffer.from(Buffer.from(PLAIN, 'latin1').map((b) => b ^ 0x5a)).toString('hex');

const passes = vi.mocked(hints);
let stop: () => void;

function settled(): Promise<void> {
  return vi.waitFor(() => expect(useStore.getState().ctfRunning).toBe(false));
}

describe('when the deeper search pass runs', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    useStore.setState({
      input: '',
      searchTerm: '',
      view: 'workspace',
      activity: 'operations',
      ctf: null,
      ctfRunning: false,
    });
    stop = watchInput();
    passes.mockClear();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  /*
   * What a screen recording caught: open the Search view, type "flag{" a key
   * at a time, and sometimes the report answered for "f" instead — with the
   * hex input itself listed as a second flag.
   */
  it('starts no pass of its own while a query is typed after the view opens', async () => {
    useStore.getState().setInput(HEX);
    await vi.advanceTimersByTimeAsync(1000);

    useStore.getState().setActivity('search');
    await vi.advanceTimersByTimeAsync(160);
    for (const typed of ['f', 'fl', 'fla', 'flag', 'flag{']) {
      useStore.getState().setSearchTerm(typed);
      await vi.advanceTimersByTimeAsync(90);
    }
    await settled();

    expect(passes.mock.calls.map(([, options]) => options?.format)).toEqual(['']);
    expect(useStore.getState().ctf?.flags.map((f) => f.text)).toEqual([
      'flag{x0r_is_not_encryption}',
    ]);
  });

  it('still runs a pass once the input settles while the view is open', async () => {
    useStore.setState({ view: 'ctf', activity: 'search' });
    useStore.getState().setInput(HEX);

    await vi.advanceTimersByTimeAsync(219);
    expect(passes).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(passes).toHaveBeenCalledTimes(1);
    await settled();
  });

  it('does not let a pass over an older input answer for the new one', async () => {
    let release: (report: CtfReport) => void = () => {};
    passes.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    useStore.setState({ view: 'ctf', activity: 'search' });
    useStore.getState().setInput('aGVsbG8gd29ybGQ=');
    await vi.advanceTimersByTimeAsync(220);

    useStore.getState().setActivity('operations');
    useStore.getState().setInput(HEX);
    await vi.advanceTimersByTimeAsync(220);
    useStore.getState().setActivity('search');
    await vi.advanceTimersByTimeAsync(220);

    release({
      flags: [{ text: 'flag{from_the_old_input}', depth: 0, path: '', known: true }],
      hints: [],
      layers: 1,
      truncated: false,
      durationMs: 0,
    });
    await settled();

    expect(useStore.getState().ctf?.flags.map((f) => f.text)).toEqual([
      'flag{x0r_is_not_encryption}',
    ]);
  });

  it('drops a pass that finishes after its input was replaced', async () => {
    let release: (report: CtfReport) => void = () => {};
    passes.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    useStore.setState({ view: 'ctf', activity: 'search' });
    useStore.getState().setInput('aGVsbG8gd29ybGQ=');
    await vi.advanceTimersByTimeAsync(220);

    useStore.getState().setActivity('operations');
    useStore.getState().setInput(HEX);
    release({
      flags: [{ text: 'flag{from_the_old_input}', depth: 0, path: '', known: true }],
      hints: [],
      layers: 1,
      truncated: false,
      durationMs: 0,
    });
    await settled();

    expect(useStore.getState().ctf).toBeNull();
  });
});
