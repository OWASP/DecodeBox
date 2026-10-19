
export function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function fromBytes(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function tryDecodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function bytesToText(bytes: Uint8Array): string {
  return tryDecodeUtf8(bytes) ?? bytesToLatin1(bytes);
}

export function renderText(byteString: string): string {
  return bytesToText(asBytes(byteString));
}

export function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

export function latin1ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export function byteLength(text: string): number {
  return asBytes(text).length;
}

export function asBytes(text: string): Uint8Array {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0xff) return toBytes(text);
  }
  return latin1ToBytes(text);
}

export function shannonEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const counts = new Uint32Array(256);
  for (const b of bytes) counts[b]!++;

  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / bytes.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function printableRatio(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let printable = 0;
  for (const b of bytes) {
    if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
  }
  return printable / bytes.length;
}

export function describeCharset(text: string): string {
  const has = {
    lower: /[a-z]/.test(text),
    upper: /[A-Z]/.test(text),
    digit: /[0-9]/.test(text),
    hexOnly: /^[0-9a-fA-F\s]+$/.test(text),
    b64: /^[A-Za-z0-9+/=\s]+$/.test(text),
    b64url: /^[A-Za-z0-9\-_=.\s]+$/.test(text),
  };
  if (has.hexOnly) return '0-9 a-f only';
  if (has.b64) return 'A-Z a-z 0-9 + / =';
  if (has.b64url) return 'A-Z a-z 0-9 - _ .';
  const parts: string[] = [];
  if (has.upper) parts.push('A-Z');
  if (has.lower) parts.push('a-z');
  if (has.digit) parts.push('0-9');
  return parts.length ? parts.join(' ') : 'non-alphanumeric';
}

export function truncate(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

export function previewText(byteString: string, max = 160): string {
  return truncate(renderText(byteString), max);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} ${n === 1 ? 'byte' : 'bytes'}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
