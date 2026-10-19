import { OperationError } from '../types';
import { arg, type Operation } from './types';

function parseIPv4(text: string): number {
  const parts = text.trim().split('.');
  if (parts.length !== 4) throw new OperationError(`'${text}' is not an IPv4 address.`);
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      throw new OperationError(`'${text}' has an octet outside 0-255.`);
    }
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function formatIPv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.');
}

function expandIPv6(text: string): string {
  const trimmed = text.trim();
  const halves = trimmed.split('::');
  if (halves.length > 2) throw new OperationError('An IPv6 address may contain only one "::".');

  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves[1] !== undefined ? (halves[1] ? halves[1].split(':').filter(Boolean) : []) : [];
  const missing = 8 - head.length - tail.length;

  if (halves.length === 1 && head.length !== 8) {
    throw new OperationError('A full IPv6 address needs eight groups.');
  }
  if (missing < 0) throw new OperationError('Too many groups for an IPv6 address.');

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  return groups
    .map((group) => {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
        throw new OperationError(`'${group}' is not a valid IPv6 group.`);
      }
      return group.toLowerCase().padStart(4, '0');
    })
    .join(':');
}

function compressIPv6(text: string): string {
  const groups = expandIPv6(text).split(':').map((g) => g.replace(/^0+(?=.)/, ''));

  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  let length = 0;

  for (let i = 0; i <= groups.length; i++) {
    if (i < groups.length && groups[i] === '0') {
      if (start === -1) start = i;
      length++;
    } else {
      if (length > bestLength) {
        bestLength = length;
        bestStart = start;
      }
      start = -1;
      length = 0;
    }
  }

  if (bestLength < 2) return groups.join(':');
  const head = groups.slice(0, bestStart).join(':');
  const tail = groups.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

export const networkOperations: Operation[] = [
  {
    id: 'parse-uri',
    name: 'Parse URI',
    category: 'Networking',
    description: 'Breaks a URL into its parts, with the query string decoded.',
    aliases: ['parse url', 'url parts', 'split url'],
    args: [
      {
        name: 'Output',
        type: 'option',
        value: 'Report',
        options: ['Report', 'JSON'],
        hint: 'JSON when this feeds the next step; the report is what you read.',
      },
    ],
    run: (input, args) => {
      let url: URL;
      try {
        url = new URL(input.trim());
      } catch {
        throw new OperationError('Not a valid absolute URL. Include the scheme, such as https://.');
      }

      if (arg(args, 'Output', 'Report') === 'JSON') {
        return JSON.stringify(
          {
            scheme: url.protocol.replace(':', ''),
            host: url.hostname,
            port: url.port || null,
            username: url.username || null,
            password: url.password || null,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams.entries()),
            fragment: url.hash ? url.hash.slice(1) : null,
          },
          null,
          2,
        );
      }

      const lines = [
        `Scheme:    ${url.protocol.replace(':', '')}`,
        `Host:      ${url.hostname}`,
        ...(url.port ? [`Port:      ${url.port}`] : []),
        ...(url.username ? [`User:      ${url.username}`] : []),
        ...(url.password ? [`Password:  ${url.password}`] : []),
        `Path:      ${url.pathname}`,
        ...(url.hash ? [`Fragment:  ${url.hash.slice(1)}`] : []),
      ];

      const params = [...url.searchParams.entries()];
      if (params.length > 0) {
        lines.push('', 'Query parameters:');
        const width = Math.max(...params.map(([k]) => k.length));
        for (const [key, value] of params) lines.push(`  ${key.padEnd(width)}  ${value}`);
      }

      return lines.join('\n');
    },
    detection: {
      formatName: 'URL',
      pattern: /^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i,
      minLength: 12,
    },
  },
  {
    id: 'parse-query-string',
    name: 'Parse query string',
    category: 'Networking',
    description: 'Decodes a query string into readable key and value pairs.',
    aliases: ['query params', 'form data', 'urlencoded body'],
    args: [
      {
        name: 'Output',
        type: 'option',
        value: 'Aligned',
        options: ['Aligned', 'JSON', 'One per line'],
        hint: 'JSON when this feeds the next step; aligned when you are reading it.',
      },
      {
        name: 'Sort by name',
        type: 'boolean',
        value: false,
        hint: 'Makes two captures of the same request comparable.',
      },
    ],
    run: (input, args) => {
      const params = new URLSearchParams(input.trim().replace(/^[?&]/, ''));
      const entries = [...params.entries()];
      if (entries.length === 0) throw new OperationError('No parameters found.');

      if (arg(args, 'Sort by name', false)) entries.sort(([a], [b]) => a.localeCompare(b));

      const output = String(arg(args, 'Output', 'Aligned'));
      if (output === 'JSON') {
        const grouped: Record<string, string | string[]> = {};
        for (const [key, value] of entries) {
          const seen = grouped[key];
          if (seen === undefined) grouped[key] = value;
          else if (Array.isArray(seen)) seen.push(value);
          else grouped[key] = [seen, value];
        }
        return JSON.stringify(grouped, null, 2);
      }

      if (output === 'One per line') {
        return entries.map(([key, value]) => `${key}=${value}`).join('\n');
      }

      const width = Math.max(...entries.map(([k]) => k.length));
      return entries.map(([key, value]) => `${key.padEnd(width)}  ${value}`).join('\n');
    },
  },
  {
    id: 'expand-ipv6',
    name: 'Expand IPv6',
    category: 'Networking',
    description: 'Writes an IPv6 address in full, with every group padded.',
    aliases: ['ipv6 full', 'uncompress ipv6'],
    args: [],
    run: (input) => expandIPv6(input),
  },
  {
    id: 'compress-ipv6',
    name: 'Compress IPv6',
    category: 'Networking',
    description: 'Writes an IPv6 address in its shortest form.',
    aliases: ['ipv6 short', 'shorten ipv6'],
    args: [],
    run: (input) => compressIPv6(input),
  },
  {
    id: 'cidr-range',
    name: 'Parse CIDR',
    category: 'Networking',
    description: 'Expands an IPv4 CIDR block into its network, broadcast and host range.',
    aliases: ['subnet', 'netmask', 'ip range', 'cidr'],
    args: [
      {
        name: 'Output',
        type: 'option',
        value: 'Summary',
        options: ['Summary', 'List every address', 'List usable hosts'],
        hint: 'A list is what feeds the next step; the summary is what you read.',
      },
      {
        name: 'Maximum addresses to list',
        type: 'number',
        value: 1024,
        min: 1,
        max: 65536,
        hint: 'A /8 is sixteen million addresses. This is the guard rail, not a preference.',
      },
    ],
    run: (input, args) => {
      const match = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(input.trim());
      if (!match) throw new OperationError('Expected something like 10.0.0.0/24.');

      const prefix = Number(match[2]);
      if (prefix > 32) throw new OperationError('A prefix length cannot exceed 32.');

      const address = parseIPv4(match[1]!);
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      const network = (address & mask) >>> 0;
      const broadcast = (network | (~mask >>> 0)) >>> 0;
      const total = 2 ** (32 - prefix);
      const output = String(arg(args, 'Output', 'Summary'));

      if (output !== 'Summary') {
        const usableOnly = output === 'List usable hosts' && total > 2;
        const first = usableOnly ? network + 1 : network;
        const last = usableOnly ? broadcast - 1 : broadcast;
        const count = last - first + 1;
        const cap = Math.max(1, Math.min(65536, Number(arg(args, 'Maximum addresses to list', 1024))));
        if (count > cap) {
          throw new OperationError(
            `That block holds ${count.toLocaleString('en')} addresses, above the limit of ${cap.toLocaleString('en')}. Raise the limit or narrow the block.`,
          );
        }
        const out: string[] = [];
        for (let n = first; n <= last; n += 1) out.push(formatIPv4(n >>> 0));
        return out.join('\n');
      }

      return [
        `Network:    ${formatIPv4(network)}/${prefix}`,
        `Netmask:    ${formatIPv4(mask)}`,
        `Wildcard:   ${formatIPv4(~mask >>> 0)}`,
        `Broadcast:  ${formatIPv4(broadcast)}`,
        `First host: ${formatIPv4(total > 2 ? network + 1 : network)}`,
        `Last host:  ${formatIPv4(total > 2 ? broadcast - 1 : broadcast)}`,
        `Addresses:  ${total.toLocaleString('en')}`,
        `Usable:     ${(total > 2 ? total - 2 : total).toLocaleString('en')}`,
      ].join('\n');
    },
    detection: {
      formatName: 'CIDR block',
      pattern: /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/,
      minLength: 9,
    },
  },
  {
    id: 'change-ip-format',
    name: 'Change IP format',
    category: 'Networking',
    description: 'Converts an IPv4 address between dotted, decimal, hex and octal forms.',
    aliases: ['ip decimal', 'ip hex', 'obfuscated ip'],
    args: [
      {
        name: 'To',
        type: 'option',
        value: 'Decimal',
        options: ['Decimal', 'Hexadecimal', 'Octal', 'Dotted decimal'],
      },
    ],
    run: (input, args) => {
      const text = input.trim();
      const value = /^\d+$/.test(text) ? Number(text) >>> 0 : parseIPv4(text);

      switch (String(arg(args, 'To', 'Decimal'))) {
        case 'Hexadecimal':
          return `0x${value.toString(16).padStart(8, '0')}`;
        case 'Octal':
          return `0${value.toString(8)}`;
        case 'Dotted decimal':
          return formatIPv4(value);
        default:
          return String(value);
      }
    },
  },
  {
    id: 'parse-user-agent',
    name: 'Parse User Agent',
    category: 'Networking',
    description: 'Picks the browser, engine and platform out of a User-Agent string.',
    aliases: ['user agent', 'ua', 'browser string'],
    args: [],
    run: (input) => {
      const ua = input.trim();
      if (ua.length === 0) throw new OperationError('Paste a User-Agent string.');

      const browsers: Array<[string, RegExp]> = [
        ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/],
        ['Opera', /OPR\/([\d.]+)/],
        ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
        ['Chrome', /Chrome\/([\d.]+)/],
        ['Firefox', /Firefox\/([\d.]+)/],
        ['Safari', /Version\/([\d.]+).*Safari/],
        ['curl', /curl\/([\d.]+)/],
        ['wget', /Wget\/([\d.]+)/],
        ['Python requests', /python-requests\/([\d.]+)/],
      ];

      const platforms: Array<[string, RegExp]> = [
        ['Windows', /Windows NT ([\d.]+)/],
        ['macOS', /Mac OS X ([\d_.]+)/],
        ['Android', /Android ([\d.]+)/],
        ['iOS', /(?:iPhone|iPad).*OS ([\d_]+)/],
        ['Linux', /Linux/],
      ];

      const find = (list: Array<[string, RegExp]>) => {
        for (const [name, pattern] of list) {
          const match = pattern.exec(ua);
          if (match) return match[1] ? `${name} ${match[1].replace(/_/g, '.')}` : name;
        }
        return 'unrecognised';
      };

      const engine = /AppleWebKit/.test(ua)
        ? 'WebKit / Blink'
        : /Gecko\/|rv:/.test(ua)
          ? 'Gecko'
          : 'unrecognised';

      return [
        `Client:    ${find(browsers)}`,
        `Platform:  ${find(platforms)}`,
        `Engine:    ${engine}`,
        `Mobile:    ${/Mobi|Android|iPhone/.test(ua) ? 'yes' : 'no'}`,
        `Bot:       ${/bot|crawler|spider|curl|wget|python-requests/i.test(ua) ? 'likely' : 'no obvious marker'}`,
      ].join('\n');
    },
    detection: {
      formatName: 'User-Agent',
      pattern: /^Mozilla\/[\d.]+ \(/,
      minLength: 20,
    },
  },
  {
    id: 'extract-mac',
    name: 'Extract MAC addresses',
    category: 'Extractors',
    description: 'Finds MAC addresses in the input.',
    aliases: ['find mac', 'hardware address'],
    args: [{ name: 'Unique', type: 'boolean', value: true }],
    run: (input, args) => {
      const found = input.match(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g) ?? [];
      const result = arg(args, 'Unique', true) ? [...new Set(found)] : found;
      return result.length > 0 ? result.join('\n') : '(nothing found)';
    },
  },
  {
    id: 'extract-ipv6',
    name: 'Extract IPv6 addresses',
    category: 'Extractors',
    description: 'Finds IPv6 addresses in the input.',
    aliases: ['find ipv6'],
    args: [{ name: 'Unique', type: 'boolean', value: true }],
    run: (input, args) => {
      const found = input.match(/\b(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}\b/g) ?? [];
      const filtered = found.filter((candidate) => candidate.includes('::') || candidate.split(':').length === 8);
      const result = arg(args, 'Unique', true) ? [...new Set(filtered)] : filtered;
      return result.length > 0 ? result.join('\n') : '(nothing found)';
    },
  },
];
