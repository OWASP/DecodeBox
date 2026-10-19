import type { HashMatch } from '../types';


export interface ArtefactRule {
  test: RegExp | ((text: string) => boolean);
  name: string;
  confidence: number;
  reason: string;
  context?: string;
  terminal?: boolean;
}

function isUnixSeconds(text: string): boolean {
  if (!/^\d{10}$/.test(text)) return false;
  const year = new Date(Number(text) * 1000).getUTCFullYear();
  return year >= 1990 && year <= 2100;
}

function isUnixMillis(text: string): boolean {
  if (!/^\d{13}$/.test(text)) return false;
  const year = new Date(Number(text)).getUTCFullYear();
  return year >= 1990 && year <= 2100;
}

function passesLuhn(text: string): boolean {
  const digits = text.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

export const ARTEFACTS: ArtefactRule[] = [
  {
    test: /^-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
    name: 'Private key (PEM)',
    confidence: 0.99,
    reason: 'PEM armour naming a private key',
    context: 'A secret. Handle it as one — do not paste it anywhere that logs.',
    terminal: true,
  },
  {
    test: /^-----BEGIN CERTIFICATE-----/,
    name: 'X.509 certificate (PEM)',
    confidence: 0.99,
    reason: 'PEM armour naming a certificate',
    context: 'Base64-wrapped DER. Strip the armour and parse the ASN.1 to read the fields.',
  },
  {
    test: /^-----BEGIN (PUBLIC KEY|RSA PUBLIC KEY)-----/,
    name: 'Public key (PEM)',
    confidence: 0.99,
    reason: 'PEM armour naming a public key',
  },
  {
    test: /^-----BEGIN PGP (MESSAGE|PUBLIC KEY BLOCK|PRIVATE KEY BLOCK|SIGNATURE)-----/,
    name: 'PGP block',
    confidence: 0.99,
    reason: 'PGP armour header',
  },
  {
    test: /^ssh-(rsa|ed25519|dss) [A-Za-z0-9+/]+={0,2}( .*)?$/,
    name: 'SSH public key',
    confidence: 0.98,
    reason: 'An SSH key type followed by a Base64 blob',
  },
  {
    test: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    name: 'UUID',
    confidence: 0.97,
    reason: 'The 8-4-4-4-12 layout with a valid version and variant nibble',
    context: 'Version and variant bits are both in range, so this is a real UUID rather than a lookalike.',
    terminal: true,
  },
  {
    test: /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/,
    name: 'MAC address',
    confidence: 0.95,
    reason: 'Six hex octets separated by colons or dashes',
    terminal: true,
  },
  {
    test: /^data:[a-z]+\/[a-z0-9.+-]+;base64,/i,
    name: 'Data URI',
    confidence: 0.98,
    reason: 'A data: URI declaring a MIME type and Base64 payload',
    context: 'Strip the prefix and decode the Base64 to recover the file.',
  },
  {
    test: /^\{"[^"]+":|^\[\{/,
    name: 'JSON',
    confidence: 0.6,
    reason: 'Opens the way a JSON object or array of objects does',
  },
  {
    test: /^(a:\d+:\{|O:\d+:"|s:\d+:")/,
    name: 'PHP serialized data',
    confidence: 0.96,
    reason: 'PHP serialize() type markers',
    context: 'Deserialising untrusted data of this kind is a known remote-code-execution path.',
  },
  {
    test: /^rO0AB/,
    name: 'Java serialized object (Base64)',
    confidence: 0.97,
    reason: 'Base64 of the Java serialization magic AC ED 00 05',
    context: 'A frequent deserialisation attack vector. Worth looking at closely.',
  },
  {
    test: (text) =>
      text.charCodeAt(0) === 0xac &&
      text.charCodeAt(1) === 0xed &&
      text.charCodeAt(2) === 0x00 &&
      text.charCodeAt(3) === 0x05,
    name: 'Java serialized object',
    confidence: 0.98,
    reason: 'The Java serialization magic AC ED 00 05',
    context: 'A frequent deserialisation attack vector.',
  },
  {
    test: isUnixSeconds,
    name: 'Unix timestamp (seconds)',
    confidence: 0.8,
    reason: 'Ten digits landing on a plausible date',
    terminal: true,
  },
  {
    test: isUnixMillis,
    name: 'Unix timestamp (milliseconds)',
    confidence: 0.8,
    reason: 'Thirteen digits landing on a plausible date',
    terminal: true,
  },
  {
    test: passesLuhn,
    name: 'Payment card number',
    confidence: 0.85,
    reason: 'Card-length digits that pass the Luhn check',
    context: 'Treat as regulated data. Do not paste it into anything that leaves your machine.',
    terminal: true,
  },
  {
    test: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/,
    name: 'IPv4 address',
    confidence: 0.9,
    reason: 'Four dot-separated octets',
    terminal: true,
  },
  {
    test: /^(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/,
    name: 'IPv6 address',
    confidence: 0.85,
    reason: 'Colon-separated hextets',
    terminal: true,
  },
];

export function identifyArtefact(input: string): HashMatch[] {
  const text = input.trim();
  if (text.length === 0 || text.length > 8192) return [];

  const matches: HashMatch[] = [];
  for (const rule of ARTEFACTS) {
    const hit =
      typeof rule.test === 'function' ? rule.test(text) : rule.test.test(text);
    if (!hit) continue;
    matches.push({
      name: rule.name,
      confidence: rule.confidence,
      reason: rule.reason,
      ...(rule.context ? { context: rule.context } : {}),
    });
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

export function isTerminal(name: string): boolean {
  return ARTEFACTS.some((rule) => rule.name === name && rule.terminal === true);
}
