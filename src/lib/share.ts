import type { OperationDef, RecipeStep } from '../engine';


const VERSION = 1;
const PREFIX = '#s=';

interface SharedStep {
  op: string;
  args?: Record<string, string | number | boolean>;
  toggles?: Record<string, string>;
  off?: true;
}

interface SharePayload {
  v: number;
  s: SharedStep[];
  i?: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes: BlobPart, stream: CompressionStream | DecompressionStream) {
  const source = new Blob([bytes]).stream();
  const piped = source.pipeThrough(stream as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

const MAX_SHARE_BYTES = 512 * 1024;

async function inflateBounded(bytes: Uint8Array): Promise<Uint8Array | null> {
  const reader = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(
      new DecompressionStream('deflate-raw') as ReadableWritablePair<Uint8Array, Uint8Array>,
    )
    .getReader();

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_SHARE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export function safeArgValue(
  candidate: unknown,
  fallback: string | number | boolean,
): string | number | boolean {
  if (typeof candidate === 'string' || typeof candidate === 'boolean') return candidate;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  return fallback;
}

export async function encodeShare(
  steps: RecipeStep[],
  operations: OperationDef[],
  input?: string,
): Promise<string> {
  const shared: SharedStep[] = steps.map((step) => {
    const definition = operations.find((op) => op.id === step.opId);
    const entry: SharedStep = { op: step.opId };

    for (const arg of step.args) {
      const original = definition?.args.find((a) => a.name === arg.name);
      if (original && original.value !== arg.value) {
        entry.args ??= {};
        entry.args[arg.name] = arg.value;
      }
      if (arg.toggleValue && original?.toggleValue !== arg.toggleValue) {
        entry.toggles ??= {};
        entry.toggles[arg.name] = arg.toggleValue;
      }
    }

    if (step.disabled) entry.off = true;
    return entry;
  });

  const payload: SharePayload = { v: VERSION, s: shared };
  if (input !== undefined && input.length > 0) payload.i = input;

  const json = JSON.stringify(payload);
  const compressed = await pipe(json, new CompressionStream('deflate-raw'));
  return PREFIX + toBase64Url(compressed);
}

export interface DecodedShare {
  steps: RecipeStep[];
  input?: string;
}

export async function decodeShare(
  hash: string,
  operations: OperationDef[],
): Promise<DecodedShare | null> {
  if (!hash.startsWith(PREFIX)) return null;

  let payload: SharePayload;
  try {
    const bytes = fromBase64Url(hash.slice(PREFIX.length));
    const inflated = await inflateBounded(bytes);
    if (!inflated) return null;
    const parsed: unknown = JSON.parse(new TextDecoder().decode(inflated));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as SharePayload).s)
    ) {
      return null;
    }
    payload = parsed as SharePayload;
  } catch {
    return null;
  }

  if (payload.v !== VERSION) return null;

  const steps: RecipeStep[] = [];
  for (const entry of payload.s) {
    const definition = operations.find((op) => op.id === entry.op);
    if (!definition) continue;

    steps.push({
      uid: `${entry.op}-${Math.random().toString(36).slice(2, 9)}`,
      opId: entry.op,
      args: definition.args.map((arg) => {
        const toggle = entry.toggles?.[arg.name];
        return {
          ...arg,
          value: safeArgValue(entry.args?.[arg.name], arg.value),
          toggleValue: typeof toggle === 'string' ? toggle : arg.toggleValue,
        };
      }),
      disabled: entry.off === true,
    });
  }

  return { steps, input: typeof payload.i === 'string' ? payload.i : undefined };
}

export function shareUrl(fragment: string): string {
  return `${location.origin}${location.pathname}${fragment}`;
}
