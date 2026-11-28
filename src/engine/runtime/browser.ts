import type { Compression, RuntimeProvider } from './provider';
import { checkSize, MAX_OUTPUT } from './limits';

function zoneNames(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.('timeZone');
    if (supported && supported.length > 0) return ['UTC', ...supported];
  } catch {}
  return ['UTC'];
}

function zoneOffset(zone: string, instant: number): number {
  if (zone === 'UTC') return 0;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(instant))) parts[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60000);
}

function zoneAbbreviation(zone: string, instant: number): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'short',
    }).formatToParts(new Date(instant));
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? zone;
  } catch {
    return zone;
  }
}

export const browserProvider: RuntimeProvider = {
  name: 'web',
  timeZones: zoneNames,
  zoneOffset,
  zoneAbbreviation,
  get secureRandom() {
    return typeof globalThis.crypto?.getRandomValues === 'function';
  },
  compressionFormats() {
    const formats: Compression[] = ['gzip', 'deflate', 'deflate-raw'];
    return formats.filter((format) => {
      try {
        new CompressionStream(format);
        new DecompressionStream(format);
        return true;
      } catch {
        return false;
      }
    });
  },
  get subtle() {
    return globalThis.crypto?.subtle;
  },
  decoder: (label, options) => new TextDecoder(label, options),
  encode: (text) => new TextEncoder().encode(text),
  toBase64: (binary) => btoa(binary),
  fromBase64: (encoded) => atob(encoded),
  parseUrl: (text) => new URL(text),
  query: (text) => new URLSearchParams(text),
  random(target) {
    const bytes = new Uint8Array(target.buffer, target.byteOffset, target.byteLength);
    for (let i = 0; i < bytes.length; i += 65536)
      crypto.getRandomValues(bytes.subarray(i, i + 65536));
    return target;
  },
  uuid: () => crypto.randomUUID(),
  now: () => performance.now(),
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  async timed(work, ms, timeout) {
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(timeout()), ms);
        }),
      ]);
      if (performance.now() - start > ms) throw timeout();
      return result;
    } finally {
      clearTimeout(timer);
    }
  },
  async transform(bytes, format, compress, limit = MAX_OUTPUT) {
    const transform = compress ? new CompressionStream(format) : new DecompressionStream(format);
    const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(transform).getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        checkSize(length, limit);
        chunks.push(part.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const out = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  },
};
