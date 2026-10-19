export const t = {
  app: {
    name: 'DecodeBox',
    org: 'OWASP',
    tagline: 'encode · decode · identify',
    affiliation: 'An OWASP Foundation Project',
    licence: 'Apache-2.0',
  },

  common: {
    close: 'Close',
  },

  header: {
    commandEmpty: 'DecodeBox — search operations',
    commandSteps: (n: number) => `recipe.yaml — ${n} step${n === 1 ? '' : 's'}`,
    download: 'Download DecodeBox',
    theme: 'Switch theme',
    github: 'Source on GitHub',
    recipeActions: 'Recipe actions',
    viewActions: 'View',
    helpActions: 'Help and source',
    help: 'Keyboard shortcuts',
    share: 'Share this recipe',
    library: 'Saved recipes',
    workspace: 'Workspace',
    ctf: 'Search — what to try next',
  },

  detectionTree: {
    title: 'Detection',
    layers: 'Decode layers',
    findings: 'Findings',
    indicators: 'Indicators',
    noFindings: 'Nothing flagged. No credentials, keys, dangerous commands or known bad patterns matched in any layer.',
    noIndicators: 'No addresses, hosts or hashes found in any layer.',
    empty: 'Paste something into input.txt and DecodeBox will map what is inside it.',
    working: 'Analysing…',
    truncated: 'The tree hit a bound and is not exhaustive.',
    expand: (name: string) => `Expand ${name}`,
    collapse: (name: string) => `Collapse ${name}`,
    input: 'What you pasted',
    at: (offset: number) => `found at byte ${offset}`,
    confidence: (percent: number) => `${percent}% confident`,
    useAsRecipe: 'Put the steps that reach this layer into the recipe',
    nodeHint: (format: string, preview: string) => `${format} — ${preview}`,
    summary: (nodes: number, depth: number) =>
      `${nodes} ${nodes === 1 ? 'layer' : 'layers'}, ${depth} deep`,
    severity: 'severity',
    evidence: 'Evidence',
    where: 'Where',
  },

  watermark: {
    find: 'Find an operation',
    run: 'Run the recipe',
    copy: 'Copy the output',
    sidebar: 'Show or hide the sidebar',
    hint: 'Paste something into input.txt, or pick an operation from the Explorer to start a recipe.',
  },

  activity: {
    title: 'Views',
    operations: 'Explorer',
    search: 'Search',
    detection: 'Detection',
    recipes: 'Saved recipes',
    ctf: 'CTF workspace',
    share: 'Share',
    help: 'Help',
  },

  layout: {
    panes: 'Workspace panes',
    skipToInput: 'Skip to input',
    maximiseOutput: 'Maximise the output group',
    restore: 'Restore the layout',
    resizeOperations: 'Resize the operations pane',
    resizeRecipe: 'Resize the recipe pane',
    resizeInput: 'Resize the input pane — drag, or use the arrow keys',
    resizeRecipeHeight: 'Resize the recipe pane — drag, or use the arrow keys',
    hideOperations: 'Hide the operations list',
    showOperations: 'Show the operations list',
  },

  operations: {
    title: 'Operations',
    search: 'Search operations',
    searchHint: 'Type to filter. Press Enter to add the first match to the recipe.',
    shortcut: 'Ctrl K',
    clear: 'Clear the search',
    matches: (shown: number, total: number) => `${shown} of ${total}`,
    enterAdds: (name: string) => `Enter adds ${name}`,
    noResults: 'Nothing matches that.',
    loading: 'Loading the engine…',
    hint: 'Click or drag an operation into the recipe',
    star: (name: string) => `Add ${name} to favourites`,
    unstar: (name: string) => `Remove ${name} from favourites`,
  },

  recipe: {
    title: 'Recipe',
    empty: 'No operations yet.',
    emptyHint: 'Drag one in from the left, or apply what detection found.',
    clear: 'Clear the recipe',
    rewrap: 'Re-wrap',
    rewrapHint:
      'Runs the recipe backwards: the output becomes the input and every step is replaced by the one that undoes it. Edit a decoded payload, then put it back inside the layers it came from.',
    rewrapBlocked: 'This recipe cannot be run backwards.',
    dismiss: 'Dismiss',
    clearShort: 'clear',
    add: 'Add',
    addFirst: 'Add an operation',
    noArguments: 'This operation takes no arguments.',
    mobileHint: 'Add operations from the Operations tab, then tap one here to change its settings.',
    save: 'Save or load a recipe',
    remove: 'Remove step',
    dropToRemove: 'Release outside the recipe to remove this step',
    moveUp: 'Move step up',
    moveDown: 'Move step down',
    drag: 'Drag to reorder, or drag out of the recipe to remove',
    dragOrKeys: (name: string, at: number, of: number) =>
      `${name}, step ${at} of ${of}. Drag to reorder, or use the arrow keys.`,
    disable: 'Disable step',
    enable: 'Enable step',
    setBreakpoint: 'Pause before this step',
    clearBreakpoint: 'Remove the pause',
    pausedAt: (n: number) => `paused before step ${n}`,
    step: 'Run one more step',
    bake: 'Run',
    rerun: 'Run again',
    baking: 'Running…',
    autoBaking: 'Runs automatically',
    autoBake: 'Run automatically',
    autoBakeHint:
      'Re-runs the recipe whenever the input or a step changes. Turn it off for a recipe that is slow or has side effects you would rather trigger yourself.',
    showText: 'Edit the recipe as text',
    showVisual: 'Back to the step list',
    textLabel: 'Recipe as JSON',
    textHint: 'Edit as JSON. Only arguments that differ from the default are shown.',
    stepFailed: (n: number) => `Step ${n} failed`,
  },

  input: {
    title: 'Input',
    placeholder: 'Paste anything — Base64, hex, a JWT, a URL-encoded payload, a hexdump…',
    clear: 'Clear the input',
    loadFile: 'Load a file',
    drop: 'Drop to load',
    encoding: 'Read typed input as',
    encodingHint:
      'How the text you type becomes bytes. A loaded file is already bytes, so it is read raw.',
  },

  output: {
    title: 'Output',
    views: 'How to read the output',
    viewNames: { raw: 'Raw', hexdump: 'Hexdump' },
    viewNote: 'a view, not a recipe step',
    fromDetection: 'auto-decoded',
    fromDetectionHint:
      'This is what detection unwrapped, not the recipe. Use as recipe to make it editable.',
    imageAlt: 'The decoded image',
    imageNote: 'Rendered locally. This image was never uploaded anywhere.',
    paused: 'paused',
    stale: 'stale',
    staleHint:
      'The input or the recipe changed after this ran. Auto-run is off, so press Run to refresh it.',
    copy: 'Copy the output',
    copyShort: 'Copy',
    copied: 'Copied',
    download: 'Download the output',
    wrap: 'Toggle word wrap',
    toInput: 'Move the output back to the input',
    maximise: 'Maximise the output',
    restore: 'Restore the input pane',
  },

  detection: {
    region: 'What DecodeBox detected',
    label: 'Detected',
    analysing: 'Identifying…',
    recomputing: 'working on the new input',
    apply: 'Use as recipe',
    applyHint: 'Put these steps in the recipe, where you can edit and re-run them',
    layers: (n: number) => `${n} ${n === 1 ? 'layer' : 'layers'}`,
    why: 'Evidence',
    whyHint: 'The measurements behind this identification',
    dismiss: 'Hide this detection',
    whyTitle: (format: string) => `Why we think this is ${format}`,
    endsIn: 'ends in',
    incomplete: 'more below',
    incompleteTitle: 'More layers may exist',
    deeper: (depth: number) => `Look deeper than ${depth}`,
    deepening: 'Looking…',
    embeddedTitle: 'Part of this decodes on its own',
    embeddedHint:
      'The input as a whole is not an encoding, but a run of it is. This is what that run ' +
      'decodes to, and where in the input it starts.',
    embeddedAt: (format: string, offset: number, length: number) =>
      `${format}, ${length} characters at offset ${offset}`,
    embeddedApply: 'Use as recipe',
    embeddedApplyHint: 'Cut that run out of the input and decode it, as editable steps',
  },

  confidence: {
    label: 'Confidence',
    explain: 'How sure the identification is — not how far it has got',
    aria: (percent: number, band: string) =>
      `Detection confidence ${percent} percent, ${band}`,
    high: 'near certain',
    good: 'strong',
    medium: 'reasonable',
    low: 'weak',
    weak: 'a guess',
  },

  report: {
    findings: 'Findings',
    indicators: 'Indicators',
    layers: 'Layers',
    foundAt: 'Found at',
    noIndicators: 'No addresses, hosts, paths or keys were found at any layer.',
    defangNote:
      'Indicators are shown defanged, so they can be pasted into a ticket without anything becoming a live link.',
  },

  ctf: {
    title: 'Search',
    tab: 'Search',
    subtitle: 'What to try next, ranked, with the reason for each.',
    emptyTitle: 'Nothing to work on yet',
    emptyDetail:
      'Paste something into the input. DecodeBox will peel what it can, search every layer for ' +
      'anything worth finding, and rank what is worth trying on what is left.',
    working: 'Searching…',
    run: 'Search again',
    flagsFound: (n: number) => `${n} ${n === 1 ? 'flag' : 'flags'} found`,
    noFlags: 'No flag found in any layer.',
    hints: 'Worth trying',
    noHints: 'Nothing here suggests a next move.',
    apply: 'Apply',
    applyHint: 'Load this as the recipe',
    copy: 'Copy',
    copied: 'Copied',
    copyReport: 'Copy as Markdown',
    atInput: 'in the input',
    atDepth: (n: number, path: string) => `${n} ${n === 1 ? 'layer' : 'layers'} down · ${path}`,
    layers: (n: number) => `${n} ${n === 1 ? 'layer' : 'layers'} searched`,
    truncated: 'A limit was reached, so this list is not exhaustive.',
    noSteps: 'Nothing to click — this one is a statement, not a move.',
    kinds: {
      flag: 'flag',
      decode: 'decode',
      crack: 'cracked',
      shape: 'shape',
      identify: 'identity',
      inspect: 'inspect',
    },
    privacy: 'Every layer was decoded in this browser. Nothing was uploaded.',
  },

  entropy: {
    label: 'Shape',
    hint: 'hover a block',
    aria: (blocks: number, standout: number) =>
      standout > 0
        ? `Entropy profile, ${blocks} blocks, ${standout} dense ${standout === 1 ? 'region' : 'regions'} that stand out`
        : `Entropy profile, ${blocks} blocks, nothing standing out`,
    bands: {
      sparse: 'padding or repetition',
      text: 'consistent with text',
      encoded: 'consistent with encoded data',
      dense: 'consistent with compression or encryption',
    },
    standout: (n: number) => `${n} dense ${n === 1 ? 'region' : 'regions'}`,
    buried: 'Dense inside ordinary content:',
  },

  find: {
    region: 'Search every layer',
    placeholder: 'Search every layer — a word, a prefix like picoCTF, or a pattern',
    hint:
      'Hits in the layers already unwrapped appear as you type. The deeper search unwraps the ' +
      'input again, looks through every layer for anything worth finding, and ranks what to try ' +
      'next — so it waits until you ask.',
    deeper: 'Search deeper',
    deeperHint:
      'Unwrap the input again and rank what is worth trying, promoting anything matching what ' +
      'you typed',
    regex: 'Read the query as a regular expression',
    regexHint: 'Regular expression. Off means the query is matched literally.',
    caseSensitive: 'Match case',
    caseHint: 'Match upper and lower case exactly',
    clear: 'Clear the search',
    badPattern: 'That is not a pattern this can compile.',
    none: 'Not found at any layer.',
    count: (hits: number, layers: number) =>
      `${hits} ${hits === 1 ? 'match' : 'matches'} in ${layers} ${layers === 1 ? 'layer' : 'layers'}`,
    inInput: 'in the input',
    depth: (n: number) => `${n} deep`,
    at: (offset: number) => `at ${offset}`,
    open: 'Open',
    openHint: 'Load the recipe that reaches this layer and go to the workspace',
    embedded: 'embedded — no linear recipe',
  },

  hash: {
    label: 'Looks like',
    salted: 'salted',
    unsalted: 'no salt',
    saltIs: 'salt',
    alsoPossible: 'Could also be',
    oneWay:
      'Hashes are one-way. There is nothing here to decode — you would need a wordlist or a lookup service.',
  },

  share: {
    title: 'Share',
    subtitle: 'The link rebuilds this recipe in someone else’s browser.',
    includeInput: 'Include the input as well',
    includeInputHint: 'Off by default, so the link carries only the recipe.',
    inputWarning:
      'The input becomes part of the URL. Links get logged by proxies, chat clients and browser history — do not do this with credentials or live samples.',
    link: 'Link',
    copy: 'Copy',
    copied: 'Copied',
    length: (n: number) => `${n} characters`,
    tooLong: (n: number) => `${n} characters — some clients will truncate this`,
  },

  library: {
    title: 'Recipes',
    subtitle: 'Saved in this browser only.',
    namePlaceholder: 'Name this recipe',
    save: 'Save',
    nothingToSave: 'Nothing to save yet. Add an operation to the recipe, or paste something and let detection find one.',
    saveDetected: (chain: string) => `Save what detection found: ${chain}`,
    detectedNote: 'The recipe is empty, so this saves the chain detection found.',
    saved: 'Saved',
    empty: 'Nothing saved yet.',
    remove: (name: string) => `Delete ${name}`,
    storageNote: 'Recipes live in this browser’s storage. Clearing site data removes them.',
  },

  status: {
    region: 'Status',
    autoRun: 'Auto-run',
    on: 'ON',
    off: 'OFF',
    errors: (n: number) => `${n} error${n === 1 ? '' : 's'}`,
    ready: 'Ready',
    working: 'Working',
    failed: 'Failed',
    paused: 'Paused',
    input: 'in',
    output: 'out',
    lines: (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`,
    steps: 'steps',
    privacy: 'Everything runs in your browser — nothing is uploaded',
    owasp: 'An OWASP Foundation Project',
    source: 'Source',
    licence: 'Apache-2.0',
  },

  download: {
    title: 'Download DecodeBox',
    lead:
      'The whole application in a single HTML file. Save it, double-click it, and it runs — no ' +
      'server, no install, no network. It is the same build as this page.',
    privacy:
      'DecodeBox has no server-side component, and no operation in it makes a network request. ' +
      'That is true of this page and of the copy you download, and you can confirm it in your ' +
      'browser’s network tab.',
    airgap:
      'Useful where getting a build toolchain onto a machine is harder than getting one file onto ' +
      'it — an isolated network, a locked-down laptop, an incident-response box.',
    stale:
      'A downloaded copy never updates itself. It will not get fixes or new operations until you ' +
      'download it again.',
    worker:
      'One difference from this page: a single file cannot start a Web Worker, so very large ' +
      'inputs are processed on the main thread and the tab may pause while they run.',
    version: 'Version',
    built: 'Built',
    button: 'Download the file',
    size: 'about 1 MB',
  },

  help: {
    title: 'Keyboard shortcuts',
    note: 'Steps can also be reordered with the arrow buttons, so nothing here needs a mouse.',
    shortcuts: [
      ['Ctrl / Cmd + Enter', 'Run the recipe'],
      ['Alt + C', 'Copy the output'],
      ['Ctrl / Cmd + Shift + C', 'Copy the output (browsers may claim this one)'],
      ['Ctrl / Cmd + K', 'Find an operation'],
      ['Ctrl / Cmd + B', 'Show or hide the sidebar'],
      ['Ctrl / Cmd + S', 'Save or load a recipe'],
      ['Ctrl / Cmd + L', 'Share this recipe'],
      ['Esc', 'Close any open dialog'],
    ] as const,
  },

  error: {
    boundary: 'Something broke',
    boundaryDetail:
      'DecodeBox hit an unexpected error. Your data never left the browser. Reloading should clear it.',
    reload: 'Reload',
  },
} as const;
