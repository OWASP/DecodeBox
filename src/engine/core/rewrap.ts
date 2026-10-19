import type { OperationArg, OperationDef, RecipeStep } from '../types';


type ArgFix = (args: OperationArg[], source: OperationArg[]) => OperationArg[];

interface InverseRule {
  op: string;
  args?: ArgFix;
}

function negateAmount(modulus: number): ArgFix {
  return (args) =>
    args.map((a) =>
      a.name === 'Amount' && typeof a.value === 'number'
        ? { ...a, value: ((-a.value % modulus) + modulus) % modulus }
        : a,
    );
}

const swapInputOutput: ArgFix = (args) => {
  const input = args.find((a) => a.name === 'Input')?.value;
  const output = args.find((a) => a.name === 'Output')?.value;
  if (input === undefined || output === undefined) return args;
  return args.map((a) => {
    if (a.name === 'Input') return { ...a, value: output };
    if (a.name === 'Output') return { ...a, value: input };
    return a;
  });
};

const flipDirection: ArgFix = (args) =>
  args.map((a) =>
    a.name === 'Direction' ? { ...a, value: a.value === 'Left' ? 'Right' : 'Left' } : a,
  );

function withValue(args: OperationArg[], name: string, value: string): OperationArg[] {
  return args.map((a) => (a.name === name ? { ...a, value } : a));
}

const valueOf = (args: OperationArg[], name: string): unknown =>
  args.find((a) => a.name === name)?.value;

const bech32ToBytes: ArgFix = (args, source) =>
  withValue(args, 'Output format', valueOf(source, 'Input format') === 'Hex' ? 'Hex' : 'Raw');

const bytesToBech32: ArgFix = (args, source) =>
  withValue(args, 'Input format', valueOf(source, 'Output format') === 'Raw' ? 'Raw bytes' : 'Hex');

export const INVERSES: Readonly<Record<string, InverseRule>> = {
  'from-base64': { op: 'to-base64' },
  'to-base64': { op: 'from-base64' },
  'from-base32': { op: 'to-base32' },
  'to-base32': { op: 'from-base32' },
  'from-base58': { op: 'to-base58' },
  'to-base58': { op: 'from-base58' },
  'from-base62': { op: 'to-base62' },
  'to-base62': { op: 'from-base62' },
  'from-base85': { op: 'to-base85' },
  'to-base85': { op: 'from-base85' },
  'from-base92': { op: 'to-base92' },
  'to-base92': { op: 'from-base92' },
  'from-base45': { op: 'to-base45' },
  'to-base45': { op: 'from-base45' },
  'from-base': { op: 'to-base' },
  'to-base': { op: 'from-base' },
  'from-bech32': { op: 'to-bech32', args: bytesToBech32 },
  'to-bech32': { op: 'from-bech32', args: bech32ToBytes },
  'from-hex': { op: 'to-hex' },
  'to-hex': { op: 'from-hex' },
  'from-hex-content': { op: 'to-hex-content' },
  'to-hex-content': { op: 'from-hex-content' },
  'from-hexdump': { op: 'to-hexdump' },
  'to-hexdump': { op: 'from-hexdump' },
  'from-octal': { op: 'to-octal' },
  'to-octal': { op: 'from-octal' },
  'from-binary': { op: 'to-binary' },
  'to-binary': { op: 'from-binary' },
  'from-decimal': { op: 'to-decimal' },
  'to-decimal': { op: 'from-decimal' },
  'from-charcode': { op: 'to-charcode' },
  'to-charcode': { op: 'from-charcode' },
  'from-bcd': { op: 'to-bcd' },
  'to-bcd': { op: 'from-bcd' },
  'from-float': { op: 'to-float' },
  'to-float': { op: 'from-float' },
  'from-modhex': { op: 'to-modhex' },
  'to-modhex': { op: 'from-modhex' },
  'from-braille': { op: 'to-braille' },
  'to-braille': { op: 'from-braille' },
  'from-morse': { op: 'to-morse' },
  'to-morse': { op: 'from-morse' },
  'from-cobs': { op: 'to-cobs' },
  'to-cobs': { op: 'from-cobs' },
  'from-uuencode': { op: 'to-uuencode' },
  'to-uuencode': { op: 'from-uuencode' },
  'from-punycode': { op: 'to-punycode' },
  'to-punycode': { op: 'from-punycode' },
  'from-quoted-printable': { op: 'to-quoted-printable' },
  'to-quoted-printable': { op: 'from-quoted-printable' },
  'from-data-uri': { op: 'to-data-uri' },
  'to-data-uri': { op: 'from-data-uri' },
  'from-messagepack': { op: 'to-messagepack' },
  'to-messagepack': { op: 'from-messagepack' },
  'from-case-insensitive-regex': { op: 'to-case-insensitive-regex' },
  'to-case-insensitive-regex': { op: 'from-case-insensitive-regex' },

  'url-encode': { op: 'url-decode' },
  'url-decode': { op: 'url-encode' },
  'escape-unicode': { op: 'unescape-unicode' },
  'unescape-unicode': { op: 'escape-unicode' },
  'escape-string': { op: 'unescape-string' },
  'unescape-string': { op: 'escape-string' },
  'json-escape': { op: 'json-unescape' },
  'json-unescape': { op: 'json-escape' },
  'to-html-entity': { op: 'from-html-entity' },
  'from-html-entity': { op: 'to-html-entity' },
  'encode-text': { op: 'decode-text' },
  'decode-text': { op: 'encode-text' },

  'cbor-encode': { op: 'cbor-decode' },
  'cbor-decode': { op: 'cbor-encode' },
  'rison-encode': { op: 'rison-decode' },
  'rison-decode': { op: 'rison-encode' },
  'varint-encode': { op: 'varint-decode' },
  'varint-decode': { op: 'varint-encode' },
  'amf-encode': { op: 'amf-decode' },
  'amf-decode': { op: 'amf-encode' },
  'protobuf-encode': { op: 'protobuf-decode' },
  'protobuf-decode': { op: 'protobuf-encode' },
  'encode-netbios-name': { op: 'decode-netbios-name' },
  'decode-netbios-name': { op: 'encode-netbios-name' },

  gzip: { op: 'gunzip' },
  gunzip: { op: 'gzip' },
  'zlib-deflate': { op: 'zlib-inflate' },
  'zlib-inflate': { op: 'zlib-deflate' },
  'raw-deflate': { op: 'raw-inflate' },
  'raw-inflate': { op: 'raw-deflate' },
  'lz4-compress': { op: 'lz4-decompress' },
  'lz4-decompress': { op: 'lz4-compress' },
  'lzstring-compress': { op: 'lzstring-decompress' },
  'lzstring-decompress': { op: 'lzstring-compress' },
  'bzip2-compress': { op: 'bzip2-decompress' },
  'bzip2-decompress': { op: 'bzip2-compress' },
  'lzma-compress': { op: 'lzma-decompress' },
  'lzma-decompress': { op: 'lzma-compress' },

  rot13: { op: 'rot13', args: negateAmount(26) },
  rot: { op: 'rot', args: negateAmount(26) },
  rot47: { op: 'rot47' },
  rot8000: { op: 'rot8000' },
  'bit-rotate': { op: 'bit-rotate', args: flipDirection },
  atbash: { op: 'atbash' },
  not: { op: 'not' },
  xor: { op: 'xor' },
  add: { op: 'sub' },
  sub: { op: 'add' },
  'vigenere-encode': { op: 'vigenere-decode' },
  'vigenere-decode': { op: 'vigenere-encode' },
  'affine-encode': { op: 'affine-decode' },
  'affine-decode': { op: 'affine-encode' },
  'rail-fence-encode': { op: 'rail-fence-decode' },
  'rail-fence-decode': { op: 'rail-fence-encode' },
  'a1z26-encode': { op: 'a1z26-decode' },
  'a1z26-decode': { op: 'a1z26-encode' },
  'bacon-encode': { op: 'bacon-decode' },
  'bacon-decode': { op: 'bacon-encode' },
  'bifid-encode': { op: 'bifid-decode' },
  'bifid-decode': { op: 'bifid-encode' },
  'cetacean-encode': { op: 'cetacean-decode' },
  'cetacean-decode': { op: 'cetacean-encode' },
  'citrix-ctx1-encode': { op: 'citrix-ctx1-decode' },
  'citrix-ctx1-decode': { op: 'citrix-ctx1-encode' },

  'aes-encrypt': { op: 'aes-decrypt' },
  'aes-decrypt': { op: 'aes-encrypt' },
  'des-encrypt': { op: 'des-decrypt' },
  'des-decrypt': { op: 'des-encrypt' },
  'triple-des-encrypt': { op: 'triple-des-decrypt' },
  'triple-des-decrypt': { op: 'triple-des-encrypt' },
  'blowfish-encrypt': { op: 'blowfish-decrypt' },
  'blowfish-decrypt': { op: 'blowfish-encrypt' },
  'rc2-encrypt': { op: 'rc2-decrypt' },
  'rc2-decrypt': { op: 'rc2-encrypt' },
  'tea-encrypt': { op: 'tea-decrypt' },
  'tea-decrypt': { op: 'tea-encrypt' },
  'xtea-encrypt': { op: 'xtea-decrypt' },
  'xtea-decrypt': { op: 'xtea-encrypt' },
  'xxtea-encrypt': { op: 'xxtea-decrypt' },
  'xxtea-decrypt': { op: 'xxtea-encrypt' },
  'aes-key-wrap': { op: 'aes-key-unwrap' },
  'aes-key-unwrap': { op: 'aes-key-wrap' },

  rc4: { op: 'rc4' },
  'rc4-drop': { op: 'rc4-drop', args: swapInputOutput },
  chacha: { op: 'chacha', args: swapInputOutput },
  salsa20: { op: 'salsa20', args: swapInputOutput },
  xsalsa20: { op: 'xsalsa20', args: swapInputOutput },
  rabbit: { op: 'rabbit', args: swapInputOutput },
};

const WHY_NOT: Readonly<Record<string, string>> = {
  'remove-whitespace': 'it discards the whitespace rather than recording where it was',
  'remove-null-bytes': 'it discards the bytes rather than recording where they were',
  'remove-diacritics': 'the accents are gone, not stored',
  'remove-line-numbers': 'the numbers are gone, not stored',
  'remove-ansi-escape-codes': 'the escape codes are gone, not stored',
  unique: 'the duplicates it removed are not recorded',
  'to-upper-case': 'the original casing is not recorded',
  'to-lower-case': 'the original casing is not recorded',
  'json-minify': 'the original formatting is not recorded',
  'xml-minify': 'the original formatting is not recorded',
  'sql-minify': 'the original formatting is not recorded',
  'javascript-minify': 'the original formatting is not recorded',
  'sort-json-keys': 'the original key order is not recorded',
  'strip-exif': 'the metadata is removed, not stored',
  'strip-http-headers': 'the headers are removed, not stored',
  'rot-n': 'it produces twenty-five candidate decodings, not one output',
  'rot47-brute-force': 'it produces ninety-four candidate decodings, not one output',
  ror13: 'it is a hash, not a rotation — the name is misleading',
};

const READ_ONLY_CATEGORIES = new Set([
  'Hashing',
  'Forensics',
  'Extractors',
  'Public Key',
  'Arithmetic / Logic',
  'Networking',
  'Date / Time',
  'Multimedia',
  'Other',
]);

export function whyNotInvertible(op: OperationDef | undefined, opId: string): string {
  if (!op) return `"${opId}" is not in the catalogue.`;
  const specific = WHY_NOT[op.id];
  if (specific) return `${op.name} cannot be undone: ${specific}.`;
  if (op.category === 'Hashing') {
    return `${op.name} is a hash. Hashes are one-way by design; there is nothing to reverse.`;
  }
  if (op.isFlowControl) {
    return `${op.name} steers the recipe rather than changing the data, so it has no inverse.`;
  }
  if (READ_ONLY_CATEGORIES.has(op.category)) {
    return `${op.name} reads the data rather than transforming it, so there is nothing to undo.`;
  }
  return `${op.name} has no inverse in the catalogue.`;
}

export interface RewrapBlocker {
  position: number;
  opId: string;
  reason: string;
}

export type RewrapResult =
  | { ok: true; steps: RecipeStep[] }
  | { ok: false; blockers: RewrapBlocker[] };

export function carryArgs(target: OperationArg[], source: OperationArg[]): OperationArg[] {
  return target.map((a) => {
    const found = source.find((s) => s.name === a.name && s.type === a.type);
    if (!found) return { ...a };
    if (a.options && !a.options.includes(String(found.value))) return { ...a };
    if (a.toggleValues && found.toggleValue && !a.toggleValues.includes(found.toggleValue)) {
      return { ...a, value: found.value };
    }
    return {
      ...a,
      value: found.value,
      ...(found.toggleValue !== undefined ? { toggleValue: found.toggleValue } : {}),
    };
  });
}

export function rewrap(
  steps: readonly RecipeStep[],
  operations: readonly OperationDef[],
  newUid: () => string,
): RewrapResult {
  const byId = new Map(operations.map((o) => [o.id, o]));
  const live = steps
    .map((step, index) => ({ step, position: index + 1 }))
    .filter(({ step }) => !step.disabled);

  const blockers: RewrapBlocker[] = [];
  for (const { step, position } of live) {
    if (!INVERSES[step.opId]) {
      blockers.push({
        position,
        opId: step.opId,
        reason: whyNotInvertible(byId.get(step.opId), step.opId),
      });
    }
  }
  if (blockers.length > 0) return { ok: false, blockers };

  const inverted: RecipeStep[] = [];
  for (let i = live.length - 1; i >= 0; i -= 1) {
    const entry = live[i];
    if (!entry) continue;
    const rule = INVERSES[entry.step.opId];
    if (!rule) continue;
    const target = byId.get(rule.op);
    if (!target) {
      blockers.push({
        position: entry.position,
        opId: entry.step.opId,
        reason: `Its inverse "${rule.op}" is not in the catalogue.`,
      });
      continue;
    }
    const carried = carryArgs(target.args, entry.step.args);
    inverted.push({
      uid: newUid(),
      opId: target.id,
      args: rule.args ? rule.args(carried, entry.step.args) : carried,
      disabled: false,
    });
  }

  if (blockers.length > 0) return { ok: false, blockers };
  return { ok: true, steps: inverted };
}
