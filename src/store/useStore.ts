import { create } from 'zustand';
import {
  bake,
  encodeInput,
  hints,
  identify,
  INPUT_ENCODINGS,
  inspect,
  listOperations,
  MAX_AUTO_DEPTH,
  rewrap,
  toChain,
  type BakeResult,
  type Analysis,
  type CtfReport,
  type HashIdentification,
  type Hint,
  type Layer,
  type OperationArg,
  type OperationDef,
  type RecipeStep,
  type RewrapBlocker,
} from '../engine';
import { decodeShare } from '../lib/share';
import {
  deleteRecipe,
  instantiate,
  loadRecipes,
  saveRecipe,
  type SavedRecipe,
} from '../lib/recipes';

type Theme = 'light' | 'dark' | 'system';
export type Activity = 'operations' | 'detection' | 'search';

export type MobilePane = 'operations' | 'recipe' | 'input' | 'output';
export type View = 'workspace' | 'ctf';
export type Dialog = 'help' | 'share' | 'library' | 'download' | null;

interface State {
  input: string;
  inputEncoding: string;
  steps: RecipeStep[];
  operations: OperationDef[];
  favourites: string[];
  recent: string[];
  savedRecipes: SavedRecipe[];

  selectedStepUid: string | null;
  breakpoints: string[];
  pausedAt: number | null;

  bakeResult: BakeResult | null;
  autoBake: boolean;
  baking: boolean;
  stale: boolean;

  analysing: boolean;
  root: Layer | null;
  chain: Layer[];
  activeLayerId: string | null;
  identification: HashIdentification | null;
  analysis: Analysis | null;
  decodeDepth: number;
  whyOpen: boolean;
  suggestionDismissed: boolean;

  ctf: CtfReport | null;
  searchTerm: string;
  ctfRunning: boolean;

  paneWidths: { operations: number; recipe: number };
  paneHeights: { input: number; recipe: number };
  mobilePane: MobilePane;
  outputMaximised: boolean;
  view: View;
  activity: Activity;
  sidebarOpen: boolean;
  recipeView: 'visual' | 'text';
  theme: Theme;
  dialog: Dialog;

  setInput: (value: string, encoding?: string) => void;
  setInputEncoding: (encoding: string) => void;
  moveOutputToInput: (payload: string) => void;
  clearInput: () => void;

  loadOperations: () => Promise<void>;
  restoreFromUrl: () => Promise<void>;

  addStep: (opId: string, atIndex?: number) => void;
  removeStep: (uid: string) => void;
  moveStep: (uid: string, direction: -1 | 1) => void;
  reorderStep: (uid: string, toIndex: number) => void;
  toggleStep: (uid: string) => void;
  toggleBreakpoint: (uid: string) => void;
  selectStep: (uid: string | null) => void;
  focusSearch: () => void;
  updateArg: (uid: string, argName: string, patch: Partial<OperationArg>) => void;
  setSteps: (steps: RecipeStep[]) => void;
  clearRecipe: () => void;
  rewrapRecipe: () => void;
  rewrapBlockers: RewrapBlocker[] | null;
  dismissRewrapBlockers: () => void;
  toggleFavourite: (opId: string) => void;

  runRecipe: () => Promise<void>;
  stepOnce: () => Promise<void>;
  setAutoBake: (on: boolean) => void;

  analyse: () => Promise<void>;
  applySuggestion: () => void;
  applySteps: (steps: RecipeStep[]) => void;
  dismissSuggestion: () => void;
  setActiveLayer: (id: string) => void;
  toggleWhy: () => void;

  runCtf: () => Promise<void>;
  setSearchTerm: (term: string) => void;
  applyHint: (hint: Hint) => void;
  openLayer: (steps: RecipeStep[]) => void;

  analyseDeeper: () => void;
  saveCurrentRecipe: (name: string, steps?: RecipeStep[]) => void;
  loadSavedRecipe: (id: string) => void;
  removeSavedRecipe: (id: string) => void;

  setPaneWidth: (pane: 'operations' | 'recipe', width: number) => void;
  setPaneHeight: (pane: 'input' | 'recipe', height: number) => void;
  setMobilePane: (pane: MobilePane) => void;
  setOutputMaximised: (maximised: boolean) => void;
  setActivity: (activity: Activity) => void;
  setSidebarOpen: (open: boolean) => void;
  setRecipeView: (view: 'visual' | 'text') => void;
  setTheme: (theme: Theme) => void;
  setDialog: (dialog: Dialog) => void;
}

const THEME_KEY = 'decodebox-theme';
const PANES_KEY = 'decodebox-panes';
const HEIGHTS_KEY = 'decodebox-pane-heights';
const FAVOURITES_KEY = 'decodebox-favourites';
const RECENT_KEY = 'decodebox-recent';
const RECENT_LIMIT = 8;
const ENCODING_KEY = 'decodebox-input-encoding';
const SEARCH_TERM_KEY = 'decodebox-search-term';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
  }
  return 'system';
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
  }
}

export function viewFor(activity: Activity): View {
  return activity === 'search' ? 'ctf' : 'workspace';
}

function workspaceActivity(current: Activity): Activity {
  return current === 'search' ? 'operations' : current;
}

function encodingFor(payload: string, current: string): string {
  return encodeInput(payload, current) === payload ? current : 'Raw bytes';
}

function newStep(op: OperationDef): RecipeStep {
  return {
    uid: `${op.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    opId: op.id,
    args: op.args.map((a) => ({ ...a })),
    disabled: false,
  };
}

let bakeToken = 0;

/*
 * Deep enough that ordinary data ends because it has run out rather than
 * because the tool has. The engine caps the whole thing at MAX_AUTO_DEPTH, and
 * "look deeper" walks the rest of the way for the pathological cases.
 */
const DEFAULT_DECODE_DEPTH = 64;

const DEPTH_INCREMENT = 64;

const MAX_DECODE_DEPTH = MAX_AUTO_DEPTH;

let analysisToken = 0;
let ctfToken = 0;

export const useStore = create<State>((set, get) => ({
  input: '',
  inputEncoding: read(ENCODING_KEY, 'UTF-8'),
  steps: [],
  operations: [],
  favourites: read<string[]>(FAVOURITES_KEY, []),
  recent: read<string[]>(RECENT_KEY, []),
  savedRecipes: loadRecipes(),

  selectedStepUid: null,
  breakpoints: [],
  pausedAt: null,

  bakeResult: null,
  autoBake: true,
  stale: false,
  baking: false,

  analysing: false,
  root: null,
  chain: [],
  activeLayerId: null,
  identification: null,
  analysis: null,
  decodeDepth: DEFAULT_DECODE_DEPTH,
  whyOpen: false,
  suggestionDismissed: false,
  rewrapBlockers: null,

  ctf: null,
  searchTerm: read(SEARCH_TERM_KEY, ''),
  ctfRunning: false,

  paneWidths: read(PANES_KEY, { operations: 264, recipe: 380 }),
  paneHeights: read(HEIGHTS_KEY, { input: 200, recipe: 116 }),
  mobilePane: 'input',
  outputMaximised: false,
  activity: read('decodebox-activity', 'operations' as Activity),
  view: viewFor(read('decodebox-activity', 'operations' as Activity)),
  sidebarOpen: read('decodebox-sidebar-open', true),
  recipeView: 'visual',
  theme: readTheme(),
  dialog: null,

  setInput: (value, encoding) => {
    if (encoding !== undefined && encoding !== get().inputEncoding) {
      set({ inputEncoding: encoding });
      write(ENCODING_KEY, encoding);
    }
    set({ input: value, suggestionDismissed: false, decodeDepth: DEFAULT_DECODE_DEPTH });
    if (!get().autoBake && get().steps.length > 0) set({ stale: true });
    if (value.trim().length === 0) {
      set({
        root: null,
        chain: [],
        activeLayerId: null,
              identification: null,
        analysis: null,
        ctf: null,
        bakeResult: null,
      });
    }
  },

  moveOutputToInput: (payload) => {
    get().setInput(payload, encodingFor(payload, get().inputEncoding));
  },

  setInputEncoding: (encoding) => {
    if (!INPUT_ENCODINGS.includes(encoding)) return;
    set({ inputEncoding: encoding });
    write(ENCODING_KEY, encoding);
    void get().analyse();
    if (get().autoBake) void get().runRecipe();
    else set({ stale: true });
  },

  clearInput: () =>
    set({
      input: '',
      decodeDepth: DEFAULT_DECODE_DEPTH,
      root: null,
      chain: [],
      activeLayerId: null,
          identification: null,
      analysis: null,
      ctf: null,
      bakeResult: null,
      whyOpen: false,
      suggestionDismissed: false,
      stale: false,
    }),

  loadOperations: async () => {
    if (get().operations.length > 0) return;
    set({ operations: await listOperations() });
  },

  restoreFromUrl: async () => {
    const hash = location.hash;
    if (!hash.startsWith('#s=')) return;

    await get().loadOperations();
    const shared = await decodeShare(hash, get().operations);
    if (!shared) return;

    set({ steps: shared.steps });
    if (shared.input !== undefined) set({ input: shared.input });
    void get().runRecipe();
  },

  addStep: (opId, atIndex) => {
    const op = get().operations.find((o) => o.id === opId);
    if (!op) return;

    const recent = [opId, ...get().recent.filter((id) => id !== opId)].slice(0, RECENT_LIMIT);
    set({ recent });
    write(RECENT_KEY, recent);
    const steps = [...get().steps];
    const added = newStep(op);
    steps.splice(atIndex ?? steps.length, 0, added);
    set({ steps, pausedAt: null, selectedStepUid: added.uid });
    if (get().autoBake) void get().runRecipe();
    else set({ stale: true });
  },

  removeStep: (uid) => {
    set((s) => ({
      steps: s.steps.filter((step) => step.uid !== uid),
      breakpoints: s.breakpoints.filter((id) => id !== uid),
      selectedStepUid: s.selectedStepUid === uid ? null : s.selectedStepUid,
      pausedAt: null,
    }));
    if (get().autoBake) void get().runRecipe();
    else set({ stale: true });
  },

  moveStep: (uid, direction) => {
    const index = get().steps.findIndex((s) => s.uid === uid);
    if (index === -1) return;
    get().reorderStep(uid, index + direction);
  },

  reorderStep: (uid, toIndex) => {
    const steps = [...get().steps];
    const from = steps.findIndex((s) => s.uid === uid);
    if (from === -1) return;

    const target = Math.max(0, Math.min(steps.length - 1, toIndex));
    if (target === from) return;

    const [moved] = steps.splice(from, 1);
    steps.splice(target, 0, moved!);
    set({ steps, pausedAt: null });
    if (get().autoBake) void get().runRecipe();
    else set({ stale: true });
  },

  toggleStep: (uid) => {
    set((s) => ({
      steps: s.steps.map((step) =>
        step.uid === uid ? { ...step, disabled: !step.disabled } : step,
      ),
      pausedAt: null,
    }));
    if (get().autoBake) void get().runRecipe();
    else set({ stale: true });
  },

  toggleBreakpoint: (uid) => {
    set((s) => ({
      breakpoints: s.breakpoints.includes(uid)
        ? s.breakpoints.filter((id) => id !== uid)
        : [...s.breakpoints, uid],
      pausedAt: null,
    }));
    if (get().autoBake) void get().runRecipe();
    else set({ stale: true });
  },

  selectStep: (uid) => set({ selectedStepUid: uid }),

  focusSearch: () => {
    const search = document.querySelector<HTMLInputElement>('input[type="search"]');
    search?.focus();
    search?.select();
  },

  updateArg: (uid, argName, patch) => {
    set((s) => ({
      steps: s.steps.map((step) =>
        step.uid === uid
          ? { ...step, args: step.args.map((a) => (a.name === argName ? { ...a, ...patch } : a)) }
          : step,
      ),
    }));
    if (get().autoBake) void get().runRecipe();
    else set({ stale: true });
  },

  setSteps: (steps) => {
    set({ steps, pausedAt: null });
    if (get().autoBake) void get().runRecipe();
    else set({ stale: true });
  },

  clearRecipe: () => {
    set({
      steps: [],
      bakeResult: null,
      stale: false,
      breakpoints: [],
      selectedStepUid: null,
      pausedAt: null,
      suggestionDismissed: false,
    });
  },

  rewrapRecipe: () => {
    const { steps, bakeResult, operations, input } = get();
    if (steps.length === 0) return;

    const result = rewrap(steps, operations, () =>
      `rewrap-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    );
    if (!result.ok) {
      set({ rewrapBlockers: result.blockers });
      return;
    }

    const payload = bakeResult && !bakeResult.error ? bakeResult.output : input;
    const encoding = encodingFor(payload, get().inputEncoding);
    if (encoding !== get().inputEncoding) {
      write(ENCODING_KEY, encoding);
    }

    set({
      input: payload,
      inputEncoding: encoding,
      steps: result.steps,
      rewrapBlockers: null,
      bakeResult: null,
      breakpoints: [],
      selectedStepUid: null,
      pausedAt: null,
      analysis: null,
      activeLayerId: null,
      suggestionDismissed: true,
    });
    if (get().autoBake) void get().runRecipe();
    else set({ stale: true });
  },

  dismissRewrapBlockers: () => set({ rewrapBlockers: null }),

  toggleFavourite: (opId) => {
    const favourites = get().favourites.includes(opId)
      ? get().favourites.filter((id) => id !== opId)
      : [...get().favourites, opId];
    set({ favourites });
    write(FAVOURITES_KEY, favourites);
  },

  runRecipe: async () => {
    const { input, inputEncoding, steps, breakpoints } = get();
    if (steps.length === 0) {
      set({ bakeResult: null, baking: false, stale: false, pausedAt: null });
      return;
    }

    const stop = steps.findIndex((s) => !s.disabled && breakpoints.includes(s.uid));
    const limit = stop === -1 ? steps.length : stop;

    const token = ++bakeToken;
    set({ baking: true });
    const result = await bake(encodeInput(input, inputEncoding), {
      id: 'workspace',
      name: 'Recipe',
      steps: steps.slice(0, limit),
    });
    if (token !== bakeToken) return;

    set({ bakeResult: result, baking: false, stale: false, pausedAt: stop === -1 ? null : stop });
  },

  stepOnce: async () => {
    const { input, inputEncoding, steps, pausedAt } = get();
    if (pausedAt === null || pausedAt >= steps.length) return;

    const next = pausedAt + 1;
    const token = ++bakeToken;
    set({ baking: true });
    const result = await bake(encodeInput(input, inputEncoding), {
      id: 'workspace',
      name: 'Recipe',
      steps: steps.slice(0, next),
    });
    if (token !== bakeToken) return;

    set({
      bakeResult: result,
      baking: false,
      stale: false,
      pausedAt: next >= steps.length ? null : next,
    });
  },

  setAutoBake: (on) => {
    set({ autoBake: on });
    if (on) void get().runRecipe();
  },

  analyse: async () => {
    const { input, inputEncoding } = get();
    if (input.trim().length === 0) return;
    const bytes = encodeInput(input, inputEncoding);

    const token = ++analysisToken;
    set({ analysing: true });

    /*
     * One call, not three. Unwrapping and mapping used to be started together
     * and derived the same chain twice from the same bytes, so on a large
     * deeply wrapped input each one's time budget was spent by the other and
     * both stopped a few layers in. The third call, `detect`, was answering a
     * question nothing on screen asked.
     */
    const { root, analysis: report } = await inspect(bytes, {
      decode: { maxDepth: get().decodeDepth },
    });
    if (token !== analysisToken) return;

    const identification = await identify(bytes);
    const chain = toChain(root);

    set({
      root,
      chain,
      identification,
      analysis: report,
      activeLayerId: chain[chain.length - 1]?.id ?? root.id,
      analysing: false,
    });
  },

  analyseDeeper: () => {
    const next = Math.min(get().decodeDepth + DEPTH_INCREMENT, MAX_DECODE_DEPTH);
    if (next === get().decodeDepth) return;
    set({ decodeDepth: next });
    void get().analyse();
  },

  applySuggestion: () => {
    const last = get().chain[get().chain.length - 1];
    if (last) get().applySteps(last.steps);
  },

  applySteps: (steps) => {
    if (steps.length === 0) return;

    set({
      steps: steps.map((s) => ({
        ...s,
        uid: `${s.opId}-${Math.random().toString(36).slice(2, 8)}`,
        args: s.args.map((a) => ({ ...a })),
      })),
      breakpoints: [],
      pausedAt: null,
    });
    void get().runRecipe();
  },

  runCtf: async () => {
    const { input, inputEncoding, searchTerm } = get();
    if (input.trim().length === 0) {
      set({ ctf: null, ctfRunning: false });
      return;
    }

    const token = ++ctfToken;
    set({ ctfRunning: true });
    const report = await hints(encodeInput(input, inputEncoding), { format: searchTerm });
    if (token !== ctfToken) return;

    set({ ctf: report, ctfRunning: false });
  },

  /*
   * Typing does not start a search of its own.
   *
   * It used to: every keystroke re-ran the whole pass, and that pass unwraps
   * the input from scratch. On a large file that meant a full decode of every
   * layer per character typed. The hits across already-decoded layers update
   * as you type because they are a scan of what is already in memory; the
   * deeper pass waits for the button.
   */
  setSearchTerm: (term) => {
    set({ searchTerm: term });
    write(SEARCH_TERM_KEY, term);
  },

  applyHint: (hint) => {
    if (hint.steps.length === 0) return;
    set({
      steps: hint.steps.map((s) => ({
        ...s,
        uid: `${s.opId}-${Math.random().toString(36).slice(2, 8)}`,
        args: s.args.map((a) => ({ ...a })),
      })),
      breakpoints: [],
      pausedAt: null,
      activity: workspaceActivity(get().activity),
      view: 'workspace',
    });
    void get().runRecipe();
  },

  openLayer: (steps) => {
    if (steps.length === 0) return;
    set({
      steps: steps.map((step) => ({
        ...step,
        uid: `${step.opId}-${Math.random().toString(36).slice(2, 8)}`,
        args: step.args.map((a) => ({ ...a })),
      })),
      breakpoints: [],
      pausedAt: null,
      activity: workspaceActivity(get().activity),
      view: 'workspace',
    });
    void get().runRecipe();
  },

  dismissSuggestion: () => set({ suggestionDismissed: true }),
  setActiveLayer: (id) => set({ activeLayerId: id }),
  toggleWhy: () => set((s) => ({ whyOpen: !s.whyOpen })),

  saveCurrentRecipe: (name, steps) => {
    set({ savedRecipes: saveRecipe(name, steps ?? get().steps) });
  },

  loadSavedRecipe: (id) => {
    const recipe = get().savedRecipes.find((r) => r.id === id);
    if (!recipe) return;
    set({ steps: instantiate(recipe), breakpoints: [], pausedAt: null, dialog: null });
    void get().runRecipe();
  },

  removeSavedRecipe: (id) => {
    set({ savedRecipes: deleteRecipe(id) });
  },

  setPaneHeight: (pane, height) => {
    const paneHeights = { ...get().paneHeights, [pane]: height };
    set({ paneHeights });
    write(HEIGHTS_KEY, paneHeights);
  },

  setPaneWidth: (pane, width) => {
    const paneWidths = { ...get().paneWidths, [pane]: width };
    set({ paneWidths });
    write(PANES_KEY, paneWidths);
  },

  setMobilePane: (pane) => set({ mobilePane: pane }),
  setOutputMaximised: (maximised) => set({ outputMaximised: maximised }),

  setActivity: (activity) => {
    const view = viewFor(activity);
    set({ activity, view });
    write('decodebox-activity', activity);

    if (view === 'ctf' && !get().ctfRunning) void get().runCtf();
  },

  setSidebarOpen: (open) => {
    set({ sidebarOpen: open });
    write('decodebox-sidebar-open', open);
  },
  setRecipeView: (view) => set({ recipeView: view }),

  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },

  setDialog: (dialog) => set({ dialog }),
}));

applyTheme(readTheme());
