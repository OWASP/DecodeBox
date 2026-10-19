import type { AnalysisNode } from './types';
import type { RecipeStep } from '../types';
import { flatten } from './report';


export interface LayerMatch {
  nodeId: string;
  format: string;
  depth: number;
  path: string;
  offset: number;
  match: string;
  before: string;
  after: string;
  steps: RecipeStep[];
}

export interface FindOptions {
  caseSensitive: boolean;
  regex: boolean;
  maxPerLayer: number;
  maxTotal: number;
  context: number;
}

export const DEFAULT_FIND_OPTIONS: FindOptions = {
  caseSensitive: false,
  regex: false,
  maxPerLayer: 20,
  maxTotal: 200,
  context: 40,
};

const MAX_SCAN = 512 * 1024;

function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matcher(query: string, options: FindOptions): RegExp | null {
  const source = options.regex ? query : escapeLiteral(query);
  try {
    return new RegExp(source, options.caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
}

function searchNode(
  node: AnalysisNode,
  pattern: RegExp,
  options: FindOptions,
  remaining: number,
): LayerMatch[] {
  const text = node.output.length > MAX_SCAN ? node.output.slice(0, MAX_SCAN) : node.output;
  const found: LayerMatch[] = [];

  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (found.length >= options.maxPerLayer || found.length >= remaining) break;

    const offset = match.index;
    found.push({
      nodeId: node.id,
      format: node.format,
      depth: node.depth,
      path: node.path,
      offset,
      match: match[0],
      before: text.slice(Math.max(0, offset - options.context), offset),
      after: text.slice(offset + match[0].length, offset + match[0].length + options.context),
      steps: node.steps,
    });

    if (match[0].length === 0) pattern.lastIndex += 1;
  }

  return found;
}

export function findInLayers(
  root: AnalysisNode,
  query: string,
  options: Partial<FindOptions> = {},
): LayerMatch[] {
  const opts = { ...DEFAULT_FIND_OPTIONS, ...options };
  if (query.length === 0) return [];

  const pattern = matcher(query, opts);
  if (!pattern) return [];

  const matches: LayerMatch[] = [];
  for (const node of flatten(root).sort((a, b) => a.depth - b.depth)) {
    if (matches.length >= opts.maxTotal) break;
    matches.push(...searchNode(node, pattern, opts, opts.maxTotal - matches.length));
  }

  return matches;
}

export function isValidQuery(query: string, regex: boolean): boolean {
  if (!regex || query.length === 0) return true;
  try {
    new RegExp(query);
    return true;
  } catch {
    return false;
  }
}
