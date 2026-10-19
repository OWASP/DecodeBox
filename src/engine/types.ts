
export type ArgType = 'string' | 'number' | 'boolean' | 'option' | 'toggleString' | 'textarea';

export interface OperationArg {
  name: string;
  type: ArgType;
  value: string | number | boolean;
  options?: string[];
  optionLabels?: Record<string, string>;
  toggleValues?: string[];
  toggleValue?: string;
  hint?: string;
  min?: number;
  max?: number;
}

export interface OperationDef {
  id: string;
  name: string;
  category: string;
  description: string;
  aliases: string[];
  args: OperationArg[];
  isFlowControl?: boolean;
}

export interface RecipeStep {
  uid: string;
  opId: string;
  args: OperationArg[];
  disabled: boolean;
}

export interface Recipe {
  id: string;
  name: string;
  steps: RecipeStep[];
}

export interface Evidence {
  label: string;
  detail: string;
  weight: number;
}

export interface Candidate {
  id: string;
  format: string;
  confidence: number;
  evidence: Evidence[];
  preview: string;
  steps: RecipeStep[];
}

export interface HashMatch {
  name: string;
  confidence: number;
  reason: string;
  context?: string;
  salt?: { present: boolean; value?: string; note: string };
}

export interface HashIdentification {
  matches: HashMatch[];
  summary: string;
  oneWay: boolean;
  terminal?: boolean;
}

export type TerminusReason =
  | 'identified'
  | 'plain'
  | 'remainder'
  | 'tooShort'
  | 'depth'
  | 'budget'
  | 'cycle'
  | 'failed';

export interface Terminus {
  reason: TerminusReason;
  note: string;
  complete: boolean;
  identification?: HashIdentification;
}

export interface EmbeddedFind {
  format: string;
  offset: number;
  length: number;
  source: string;
  decoded: string;
  preview: string;
  confidence: number;
  steps: RecipeStep[];
}

export interface Layer {
  id: string;
  depth: number;
  format: string;
  confidence: number;
  byteLength: number;
  output: string;
  evidence: Evidence[];
  steps: RecipeStep[];
  children: Layer[];
  terminus?: Terminus;
  /** Encoded data found inside this layer rather than wrapped around it. */
  embedded?: EmbeddedFind[];
}

export type OutputType = 'text' | 'json' | 'bytes' | 'image';

export interface BakeResult {
  output: string;
  outputType: OutputType;
  byteLength: number;
  durationMs: number;
  error?: { stepIndex: number; message: string };
}

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationError';
  }
}
