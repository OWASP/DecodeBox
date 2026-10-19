import type { Analysis, AnalyseOptions } from './types';
import { DEFAULT_ANALYSE_OPTIONS, SEVERITY_ORDER } from './types';
import { explore, type Spine } from './explore';
import { flatten } from './report';
import { extractIndicators, mergeIndicators } from './indicators';
import { findIssues, mergeFindings } from './findings';

export async function analyse(
  input: string,
  options: Partial<AnalyseOptions> = {},
  spine: Spine = null,
): Promise<Analysis> {
  const started = performance.now();
  const settings = { ...DEFAULT_ANALYSE_OPTIONS, ...options };

  const { root, nodes, truncated } = await explore(input, settings, spine);
  const all = flatten(root);

  const indicators = mergeIndicators(
    all.flatMap((node) => extractIndicators(node.output, node.depth, node.path)),
  );

  const findings = mergeFindings(
    all.flatMap((node) => findIssues(node.output, node.depth, node.path, node.format)),
  ).sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.depth - b.depth,
  );

  return {
    root,
    nodes,
    maxDepth: Math.max(...all.map((node) => node.depth)),
    indicators,
    findings,
    durationMs: performance.now() - started,
    truncated,
  };
}

export { flatten, toMarkdown } from './report';
export { findInLayers, isValidQuery, DEFAULT_FIND_OPTIONS } from './find';
export { explain } from './explain';
export { entropyProfile, standoutRegions, bandOf, MIN_FOR_PROFILE } from './entropy';
export type { EntropyBucket, EntropyBand } from './entropy';
export type { Explanation } from './explain';
export type { LayerMatch, FindOptions } from './find';
export { defang } from './indicators';
export { RULE_COUNT } from './findings';
export type {
  Analysis,
  AnalyseOptions,
  AnalysisNode,
  Finding,
  Indicator,
  IndicatorKind,
  Severity,
} from './types';
