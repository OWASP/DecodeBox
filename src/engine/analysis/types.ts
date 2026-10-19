import type { RecipeStep } from '../types';


export type IndicatorKind =
  | 'url'
  | 'domain'
  | 'ipv4'
  | 'ipv6'
  | 'email'
  | 'hash'
  | 'path'
  | 'registry'
  | 'command'
  | 'crypto-key'
  | 'mac'
  | 'cve'
  | 'wallet';

export interface Indicator {
  kind: IndicatorKind;
  value: string;
  defanged: string;
  depth: number;
  path: string;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: string;
  depth: number;
  path: string;
  reference?: string;
}

export interface AnalysisNode {
  id: string;
  format: string;
  confidence: number;
  depth: number;
  path: string;
  byteLength: number;
  output: string;
  preview: string;
  steps: RecipeStep[];
  children: AnalysisNode[];
  origin?: { label: string; offset: number };
}

export interface Analysis {
  root: AnalysisNode;
  nodes: number;
  maxDepth: number;
  indicators: Indicator[];
  findings: Finding[];
  durationMs: number;
  truncated: boolean;
}

export interface AnalyseOptions {
  maxDepth: number;
  maxNodes: number;
  budgetMs: number;
  threshold: number;
}

export const DEFAULT_ANALYSE_OPTIONS: AnalyseOptions = {
  maxDepth: 64,
  maxNodes: 128,
  budgetMs: 10000,
  threshold: 0.5,
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};
