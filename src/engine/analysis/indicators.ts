import type { Indicator, IndicatorKind } from './types';


interface Rule {
  kind: IndicatorKind;
  pattern: RegExp;
  reject?: (value: string) => boolean;
}

const RULES: Rule[] = [
  {
    kind: 'url',
    pattern: /\b(?:https?|ftps?|smb|ldaps?|file):\/\/[^\s<>"'`\\)\]}]{4,}/gi,
  },
  {
    kind: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    kind: 'ipv4',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    reject: (value) => /^0\.|^255\.255\.255\.255$/.test(value),
  },
  {
    kind: 'ipv6',
    /*
     * The old rule asked for three or more colon-separated hex groups, which
     * is also the shape of a clock: `11:02:14` in a log timestamp was being
     * reported as an IPv6 address, and `fe80::1` was not reported at all.
     * An address is either written out in full, with eight groups, or
     * compressed with exactly one `::` — and nothing else counts.
     */
    pattern: /\b(?:[0-9a-fA-F]{1,4}:{1,2}){1,7}[0-9a-fA-F]{1,4}\b/g,
    reject: (value) =>
      value.includes('::') ? value.split('::').length > 2 : value.split(':').length !== 8,
  },
  {
    kind: 'domain',
    pattern:
      /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ru|cn|info|xyz|top|biz|online|site|shop|club|live|icu|cc|tk|ml|ga|cf|gq|pw|su|onion|dev|app|co|uk|de|fr|nl|br|in|ir|pl|it|es|ca|au|jp|kr)\b/gi,
  },
  {
    kind: 'hash',
    pattern: /\b[0-9a-f]{32}\b|\b[0-9a-f]{40}\b|\b[0-9a-f]{64}\b/gi,
  },
  {
    kind: 'path',
    pattern:
      /\b[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*|(?:\/(?:etc|var|tmp|usr|home|opt|root|proc)\/)[^\s"'<>|;]{2,}/g,
  },
  {
    kind: 'registry',
    pattern: /\b(?:HKLM|HKCU|HKCR|HKU|HKEY_[A-Z_]+)\\[^\s"'<>|;]{4,}/gi,
  },
  {
    kind: 'mac',
    pattern: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g,
  },
  {
    kind: 'cve',
    pattern: /\bCVE-\d{4}-\d{4,7}\b/gi,
  },
  {
    kind: 'wallet',
    pattern: /\b(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,62}|0x[a-fA-F0-9]{40})\b/g,
  },
  {
    kind: 'crypto-key',
    pattern:
      /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE|PUBLIC KEY)-----|\bAKIA[0-9A-Z]{16}\b|\bASIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{16,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    kind: 'command',
    pattern:
      /\b(?:powershell(?:\.exe)?|cmd(?:\.exe)?|wscript|cscript|rundll32|regsvr32|mshta|certutil|bitsadmin|curl|wget|nc|ncat|bash\s+-i|sh\s+-c)\b[^\n\r]{0,120}/gi,
  },
];

export function defang(value: string, kind?: IndicatorKind): string {
  if (kind === 'ipv6') return value.replace(/:/g, '[:]');
  return value
    .replace(/\bhttp(s?)(?=:\/\/)/gi, 'hxxp$1')
    .replace(/:\/\//g, '[://]')
    .replace(/\./g, '[.]')
    .replace(/@/g, '[at]');
}

const NEEDS_DEFANG = new Set<IndicatorKind>(['url', 'domain', 'ipv4', 'ipv6', 'email', 'command']);

const MAX_PER_KIND = 40;

const MAX_VALUE = 110;

function clip(value: string): string {
  return value.length <= MAX_VALUE ? value : `${value.slice(0, MAX_VALUE)}…`;
}

export function extractIndicators(text: string, depth: number, path: string): Indicator[] {
  if (text.length === 0) return [];
  const sample = text.length > 256 * 1024 ? text.slice(0, 256 * 1024) : text;
  const found: Indicator[] = [];

  for (const rule of RULES) {
    let count = 0;
    for (const match of sample.matchAll(rule.pattern)) {
      const value = clip(match[0].trim());
      if (value.length === 0) continue;
      if (rule.reject?.(value)) continue;

      found.push({
        kind: rule.kind,
        value,
        defanged: NEEDS_DEFANG.has(rule.kind) ? defang(value, rule.kind) : value,
        depth,
        path,
      });

      if (++count >= MAX_PER_KIND) break;
    }
  }

  return found;
}

export function mergeIndicators(all: Indicator[]): Indicator[] {
  const byValue = new Map<string, Indicator>();

  for (const indicator of all) {
    const key = `${indicator.kind}:${indicator.value.toLowerCase()}`;
    const existing = byValue.get(key);
    if (!existing || indicator.depth < existing.depth) byValue.set(key, indicator);
  }

  const order: IndicatorKind[] = [
    'crypto-key',
    'command',
    'url',
    'domain',
    'ipv4',
    'ipv6',
    'email',
    'path',
    'registry',
    'wallet',
    'cve',
    'hash',
    'mac',
  ];

  return [...byValue.values()].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.value.localeCompare(b.value),
  );
}
