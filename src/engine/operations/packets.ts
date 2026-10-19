import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';


const INPUT_FORMATS = ['Hex', 'Raw'];

function packetBytes(input: string, format: string): Uint8Array {
  if (format === 'Hex') {
    const cleaned = input.replace(/[^0-9a-fA-F]/g, '');
    if (cleaned.length % 2 !== 0) throw new OperationError('Hex input has an odd number of digits.');
    const out = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.substr(i * 2, 2), 16);
    return out;
  }
  return asBytes(input);
}

function formatArg() {
  return { name: 'Input format', type: 'option' as const, value: 'Hex', options: INPUT_FORMATS };
}

function need(bytes: Uint8Array, count: number, what: string): void {
  if (bytes.length < count) {
    throw new OperationError(`A ${what} is at least ${count} bytes; this is ${bytes.length}.`);
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function be16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] as number) << 8) | (bytes[at + 1] as number);
}

function be32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] as number) * 0x1000000 +
    ((bytes[at + 1] as number) << 16) +
    ((bytes[at + 2] as number) << 8) +
    (bytes[at + 3] as number)
  );
}

function ipv4(bytes: Uint8Array, at: number): string {
  return `${bytes[at]}.${bytes[at + 1]}.${bytes[at + 2]}.${bytes[at + 3]}`;
}

function mac(bytes: Uint8Array, at: number): string {
  return Array.from(bytes.subarray(at, at + 6), (b) => b.toString(16).padStart(2, '0')).join(':');
}

const PROTOCOLS: Record<number, string> = {
  1: 'ICMP',
  2: 'IGMP',
  6: 'TCP',
  17: 'UDP',
  41: 'IPv6',
  47: 'GRE',
  50: 'ESP',
  51: 'AH',
  58: 'ICMPv6',
  89: 'OSPF',
  103: 'PIM',
  132: 'SCTP',
};

const ETHERTYPES: Record<number, string> = {
  0x0800: 'IPv4',
  0x0806: 'ARP',
  0x8035: 'RARP',
  0x809b: 'AppleTalk',
  0x8100: '802.1Q VLAN',
  0x86dd: 'IPv6',
  0x8808: 'Ethernet flow control',
  0x8847: 'MPLS unicast',
  0x8848: 'MPLS multicast',
  0x88cc: 'LLDP',
};

const TCP_FLAGS = ['NS', 'CWR', 'ECE', 'URG', 'ACK', 'PSH', 'RST', 'SYN', 'FIN'];

function internetChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) sum += be16(bytes, i);
  if (bytes.length % 2 === 1) sum += (bytes[bytes.length - 1] as number) << 8;
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return ~sum & 0xffff;
}

function checksumLine(given: number, header: Uint8Array, zeroAt: number): string {
  const copy = new Uint8Array(header);
  copy[zeroAt] = 0;
  copy[zeroAt + 1] = 0;
  const correct = internetChecksum(copy);
  const shown = `0x${given.toString(16).padStart(4, '0')}`;
  return correct === given
    ? `${shown} (correct)`
    : `${shown} (incorrect, should be 0x${correct.toString(16).padStart(4, '0')})`;
}


function expandIpv6(address: string): number[] {
  const trimmed = address.trim().replace(/^\[|\]$/g, '').split('%')[0] as string;
  const halves = trimmed.split('::');
  if (halves.length > 2) throw new OperationError('An address can hold only one :: gap.');

  const readGroups = (text: string): number[] =>
    text === '' ? [] : text.split(':').map((group) => {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) throw new OperationError(`'${group}' is not a hex group.`);
      return parseInt(group, 16);
    });

  const head = readGroups(halves[0] as string);
  const tail = halves.length === 2 ? readGroups(halves[1] as string) : [];
  if (halves.length === 1) {
    if (head.length !== 8) throw new OperationError('A full address has eight groups.');
    return head;
  }
  const gap = 8 - head.length - tail.length;
  if (gap < 1) throw new OperationError('The :: gap would cover no groups.');
  return [...head, ...new Array<number>(gap).fill(0), ...tail];
}

function ipv6Kind(groups: number[]): string {
  const first = groups[0] as number;
  if (groups.every((g) => g === 0)) return 'Unspecified (::)';
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return 'Loopback (::1)';
  if ((first & 0xffc0) === 0xfe80) return 'Link-local unicast';
  if ((first & 0xfe00) === 0xfc00) return 'Unique local unicast';
  if ((first & 0xff00) === 0xff00) return 'Multicast';
  if (first === 0x2002) return '6to4';
  if (first === 0x2001 && groups[1] === 0) return 'Teredo';
  if ((first & 0xe000) === 0x2000) return 'Global unicast';
  return 'Reserved or unassigned';
}


function parseCidr(text: string): { network: number; prefix: number } {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(text.trim());
  if (!match) throw new OperationError('Expected an address in CIDR form, such as 10.0.0.0/24.');
  const octets = (match[1] as string).split('.').map(Number);
  if (octets.some((o) => o > 255)) throw new OperationError('An octet cannot exceed 255.');
  const prefix = Number(match[2]);
  if (prefix > 32) throw new OperationError('An IPv4 prefix cannot exceed 32.');
  const network =
    ((octets[0] as number) * 0x1000000 +
      ((octets[1] as number) << 16) +
      ((octets[2] as number) << 8) +
      (octets[3] as number)) >>>
    0;
  return { network, prefix };
}

function toDotted(value: number): string {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.');
}

const MAX_LISTED_ADDRESSES = 20000;

export const packetOperations: Operation[] = [
  {
    id: 'varint-encode',
    name: 'VarInt Encode',
    category: 'Networking',
    description: 'Writes a whole number as a Protobuf base-128 variable-length integer.',
    aliases: ['varint', 'protobuf integer', 'leb128'],
    args: [],
    run: (input) => {
      let value: bigint;
      try {
        value = BigInt(input.trim());
      } catch {
        throw new OperationError('Input must be a whole number.');
      }
      if (value < 0n) throw new OperationError('A VarInt cannot hold a negative number.');

      const out: number[] = [];
      while (value >= 0x80n) {
        out.push(Number(value & 0x7fn) | 0x80);
        value >>= 7n;
      }
      out.push(Number(value));
      return bytesToLatin1(new Uint8Array(out));
    },
  },
  {
    id: 'varint-decode',
    name: 'VarInt Decode',
    category: 'Networking',
    description: 'Reads a Protobuf base-128 variable-length integer.',
    aliases: ['varint decode', 'leb128 decode'],
    args: [],
    run: (input) => {
      const bytes = asBytes(input);
      if (bytes.length === 0) throw new OperationError('No bytes to read.');
      let value = 0n;
      let shift = 0n;
      for (const byte of bytes) {
        value |= BigInt(byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) return value.toString();
        shift += 7n;
        if (shift > 70n) throw new OperationError('The VarInt never terminates.');
      }
      throw new OperationError('The VarInt is missing its final byte.');
    },
  },
  {
    id: 'encode-netbios-name',
    name: 'Encode NetBIOS Name',
    category: 'Networking',
    description: 'Encodes a NetBIOS name in the two-nibbles-per-byte form SMB uses.',
    aliases: ['netbios', 'smb name'],
    args: [{ name: 'Offset', type: 'number', value: 65 }],
    run: (input, args) => {
      const offset = Number(arg(args, 'Offset', 65));
      const bytes = asBytes(input);
      if (bytes.length > 16) throw new OperationError('A NetBIOS name is at most 16 bytes.');

      const padded = new Uint8Array(16).fill(32);
      padded.set(bytes);
      const out: number[] = [];
      for (const byte of padded) {
        out.push((byte >> 4) + offset, (byte & 0xf) + offset);
      }
      return bytesToLatin1(new Uint8Array(out));
    },
  },
  {
    id: 'decode-netbios-name',
    name: 'Decode NetBIOS Name',
    category: 'Networking',
    description: 'Decodes an encoded NetBIOS name back to its readable form.',
    aliases: ['netbios decode', 'smb name decode'],
    args: [{ name: 'Offset', type: 'number', value: 65 }],
    run: (input, args) => {
      const offset = Number(arg(args, 'Offset', 65));
      const bytes = asBytes(input);
      if (bytes.length > 32 || bytes.length % 2 !== 0) {
        throw new OperationError('An encoded NetBIOS name is an even number of bytes, at most 32.');
      }
      const out: number[] = [];
      for (let i = 0; i < bytes.length; i += 2) {
        out.push((((bytes[i] as number) - offset) << 4) | (((bytes[i + 1] as number) - offset) & 0xf));
      }
      while (out.length > 0 && out[out.length - 1] === 32) out.pop();
      return bytesToLatin1(new Uint8Array(out));
    },
  },
  {
    id: 'strip-http-headers',
    name: 'Strip HTTP headers',
    category: 'Networking',
    description: 'Removes everything before the blank line that ends the headers.',
    aliases: ['http body', 'remove headers'],
    args: [],
    run: (input) => {
      const crlf = input.indexOf('\r\n\r\n');
      if (crlf >= 0) return input.slice(crlf + 4);
      const lf = input.indexOf('\n\n');
      return lf >= 0 ? input.slice(lf + 2) : input;
    },
  },
  {
    id: 'dechunk-http-response',
    name: 'Dechunk HTTP response',
    category: 'Networking',
    description: 'Joins a chunked transfer-encoded body back into one piece.',
    aliases: ['chunked', 'transfer encoding'],
    args: [],
    run: (input) => {
      let rest = input;
      const chunks: string[] = [];

      for (;;) {
        const breakAt = rest.indexOf('\n');
        if (breakAt < 0) break;
        const ending = rest[breakAt - 1] === '\r' ? '\r\n' : '\n';
        const size = parseInt(rest.slice(0, breakAt), 16);
        if (Number.isNaN(size)) break;
        if (size === 0) break;

        const start = breakAt + 1;
        chunks.push(rest.slice(start, start + size));
        rest = rest.slice(start + size + ending.length);
      }
      if (chunks.length === 0) throw new OperationError('No chunk length found at the start.');
      return chunks.join('');
    },
  },
  {
    id: 'parse-ipv4-header',
    name: 'Parse IPv4 header',
    category: 'Networking',
    description: 'Reports every field of an IPv4 header, and checks its checksum.',
    aliases: ['ip header', 'ipv4'],
    args: [formatArg()],
    run: (input, args) => {
      const bytes = packetBytes(input, String(arg(args, 'Input format', 'Hex')));
      need(bytes, 20, 'IPv4 header');

      const version = ((bytes[0] as number) >>> 4) & 0xf;
      const ihl = (bytes[0] as number) & 0xf;
      const protocol = bytes[9] as number;
      const header = bytes.subarray(0, Math.max(20, ihl * 4));

      const lines = [
        `Version: ${version}${version === 4 ? '' : ' (should be 4)'}`,
        `Internet header length: ${ihl} words = ${ihl * 4} bytes${ihl < 5 ? ' (should be at least 5)' : ''}`,
        `DSCP: ${((bytes[1] as number) >>> 2) & 0x3f}`,
        `ECN: ${(bytes[1] as number) & 0x03}`,
        `Total length: ${be16(bytes, 2)} bytes`,
        `Identification: 0x${be16(bytes, 4).toString(16).padStart(4, '0')}`,
        `Flags: ${[
          (bytes[6] as number) & 0x80 ? 'reserved' : '',
          (bytes[6] as number) & 0x40 ? "don't fragment" : '',
          (bytes[6] as number) & 0x20 ? 'more fragments' : '',
        ]
          .filter(Boolean)
          .join(', ') || 'none'}`,
        `Fragment offset: ${((((bytes[6] as number) & 0x1f) << 8) | (bytes[7] as number)) * 8} bytes`,
        `Time to live: ${bytes[8]}`,
        `Protocol: ${protocol} (${PROTOCOLS[protocol] ?? 'unknown'})`,
        `Header checksum: ${checksumLine(be16(bytes, 10), header, 10)}`,
        `Source: ${ipv4(bytes, 12)}`,
        `Destination: ${ipv4(bytes, 16)}`,
      ];
      if (ihl > 5) lines.push(`Options: 0x${hex(bytes.subarray(20, ihl * 4))}`);
      return lines.join('\n');
    },
  },
  {
    id: 'strip-ipv4-header',
    name: 'Strip IPv4 header',
    category: 'Networking',
    description: 'Removes the IPv4 header and returns the payload.',
    aliases: ['ip payload'],
    args: [formatArg()],
    run: (input, args) => {
      const bytes = packetBytes(input, String(arg(args, 'Input format', 'Hex')));
      need(bytes, 20, 'IPv4 header');
      const ihl = (bytes[0] as number) & 0xf;
      return bytesToLatin1(bytes.subarray(Math.max(20, ihl * 4)));
    },
  },
  {
    id: 'parse-tcp',
    name: 'Parse TCP',
    category: 'Networking',
    description: 'Reports the fields, flags and options of a TCP header.',
    aliases: ['tcp header', 'tcp segment'],
    args: [formatArg()],
    run: (input, args) => {
      const bytes = packetBytes(input, String(arg(args, 'Input format', 'Hex')));
      need(bytes, 20, 'TCP header');

      const dataOffset = ((bytes[12] as number) >>> 4) & 0xf;
      const flagBits = (((bytes[12] as number) & 1) << 8) | (bytes[13] as number);
      const flags = TCP_FLAGS.filter((_, i) => flagBits & (0x100 >> i));

      const lines = [
        `Source port: ${be16(bytes, 0)}`,
        `Destination port: ${be16(bytes, 2)}`,
        `Sequence number: ${be32(bytes, 4)}`,
        `Acknowledgement number: ${be32(bytes, 8)}`,
        `Data offset: ${dataOffset} words = ${dataOffset * 4} bytes`,
        `Flags: ${flags.join(', ') || 'none'}`,
        `Window size: ${be16(bytes, 14)}`,
        `Checksum: 0x${be16(bytes, 16).toString(16).padStart(4, '0')}`,
        `Urgent pointer: ${be16(bytes, 18)}`,
      ];
      if (dataOffset > 5 && bytes.length >= dataOffset * 4) {
        lines.push(`Options: 0x${hex(bytes.subarray(20, dataOffset * 4))}`);
      }
      const payload = bytes.subarray(Math.max(20, dataOffset * 4));
      if (payload.length > 0) lines.push(`Payload: ${payload.length} bytes`);
      return lines.join('\n');
    },
  },
  {
    id: 'strip-tcp-header',
    name: 'Strip TCP header',
    category: 'Networking',
    description: 'Removes the TCP header and returns the payload.',
    aliases: ['tcp payload'],
    args: [formatArg()],
    run: (input, args) => {
      const bytes = packetBytes(input, String(arg(args, 'Input format', 'Hex')));
      need(bytes, 20, 'TCP header');
      const dataOffset = ((bytes[12] as number) >>> 4) & 0xf;
      return bytesToLatin1(bytes.subarray(Math.max(20, dataOffset * 4)));
    },
  },
  {
    id: 'parse-udp',
    name: 'Parse UDP',
    category: 'Networking',
    description: 'Reports the four fields of a UDP header.',
    aliases: ['udp header', 'datagram'],
    args: [formatArg()],
    run: (input, args) => {
      const bytes = packetBytes(input, String(arg(args, 'Input format', 'Hex')));
      need(bytes, 8, 'UDP header');
      return [
        `Source port: ${be16(bytes, 0)}`,
        `Destination port: ${be16(bytes, 2)}`,
        `Length: ${be16(bytes, 4)} bytes`,
        `Checksum: 0x${be16(bytes, 6).toString(16).padStart(4, '0')}`,
        ...(bytes.length > 8 ? [`Payload: ${bytes.length - 8} bytes`] : []),
      ].join('\n');
    },
  },
  {
    id: 'strip-udp-header',
    name: 'Strip UDP header',
    category: 'Networking',
    description: 'Removes the eight-byte UDP header and returns the payload.',
    aliases: ['udp payload'],
    args: [formatArg()],
    run: (input, args) => {
      const bytes = packetBytes(input, String(arg(args, 'Input format', 'Hex')));
      need(bytes, 8, 'UDP header');
      return bytesToLatin1(bytes.subarray(8));
    },
  },
  {
    id: 'parse-ethernet-frame',
    name: 'Parse Ethernet frame',
    category: 'Networking',
    description: 'Reads the addresses and type from an Ethernet II frame.',
    aliases: ['ethernet', 'layer 2', 'frame'],
    args: [formatArg()],
    run: (input, args) => {
      const bytes = packetBytes(input, String(arg(args, 'Input format', 'Hex')));
      need(bytes, 14, 'Ethernet frame');

      const type = be16(bytes, 12);
      const lines = [
        `Destination: ${mac(bytes, 0)}`,
        `Source: ${mac(bytes, 6)}`,
      ];
      if (type < 0x0600) lines.push(`Length: ${type} (IEEE 802.3 framing)`);
      else lines.push(`EtherType: 0x${type.toString(16).padStart(4, '0')} (${ETHERTYPES[type] ?? 'unknown'})`);
      if ((bytes[0] as number) & 1) lines.push('Destination is a multicast or broadcast address.');
      if (bytes.length > 14) lines.push(`Payload: ${bytes.length - 14} bytes`);
      return lines.join('\n');
    },
  },
  {
    id: 'parse-ip-range',
    name: 'Parse IP range',
    category: 'Networking',
    description: 'Expands a CIDR block into its network, broadcast and host range.',
    aliases: ['cidr', 'subnet', 'netmask'],
    args: [
      { name: 'Include network info', type: 'boolean', value: true },
      { name: 'Enumerate IP addresses', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const { network, prefix } = parseCidr(input);
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      const start = (network & mask) >>> 0;
      const end = (start | (~mask >>> 0)) >>> 0;
      const total = 2 ** (32 - prefix);

      const lines: string[] = [];
      if (arg(args, 'Include network info', true)) {
        lines.push(
          `Network: ${toDotted(start)}/${prefix}`,
          `Netmask: ${toDotted(mask)}`,
          `CIDR: ${toDotted(start)}/${prefix}`,
          `Wildcard: ${toDotted(~mask >>> 0)}`,
          `Broadcast: ${toDotted(end)}`,
          `First host: ${toDotted(prefix >= 31 ? start : start + 1)}`,
          `Last host: ${toDotted(prefix >= 31 ? end : end - 1)}`,
          `Addresses: ${total}`,
          `Usable hosts: ${prefix >= 31 ? total : Math.max(0, total - 2)}`,
        );
      }
      if (arg(args, 'Enumerate IP addresses', false)) {
        if (total > MAX_LISTED_ADDRESSES) {
          throw new OperationError(
            `That range holds ${total} addresses; ${MAX_LISTED_ADDRESSES} is the limit for listing.`,
          );
        }
        if (lines.length > 0) lines.push('');
        for (let value = start; value <= end; value++) lines.push(toDotted(value >>> 0));
      }
      return lines.join('\n');
    },
  },
  {
    id: 'group-ip-addresses',
    name: 'Group IP addresses',
    category: 'Networking',
    description: 'Groups a list of addresses into the subnets of a chosen size.',
    aliases: ['bucket ips', 'subnet grouping'],
    args: [{ name: 'Subnet (CIDR)', type: 'number', value: 24, min: 0, max: 32 }],
    run: (input, args) => {
      const prefix = Math.min(32, Math.max(0, Number(arg(args, 'Subnet (CIDR)', 24))));
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

      const groups = new Map<number, string[]>();
      for (const match of input.matchAll(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g)) {
        const octets = match.slice(1, 5).map(Number);
        if (octets.some((o) => o > 255)) continue;
        const value =
          ((octets[0] as number) * 0x1000000 +
            ((octets[1] as number) << 16) +
            ((octets[2] as number) << 8) +
            (octets[3] as number)) >>>
          0;
        const key = (value & mask) >>> 0;
        const bucket = groups.get(key) ?? [];
        if (!bucket.includes(match[0])) bucket.push(match[0]);
        groups.set(key, bucket);
      }
      if (groups.size === 0) throw new OperationError('No IPv4 addresses found.');

      return [...groups.entries()]
        .sort(([a], [b]) => a - b)
        .map(([key, members]) => `${toDotted(key)}/${prefix}\n${members.map((m) => `  ${m}`).join('\n')}`)
        .join('\n\n');
    },
  },
  {
    id: 'parse-ipv6-address',
    name: 'Parse IPv6 address',
    category: 'Networking',
    description: 'Expands an IPv6 address and says what kind of address it is.',
    aliases: ['ipv6', 'address type'],
    args: [],
    run: (input) => {
      const groups = expandIpv6(input);
      const full = groups.map((g) => g.toString(16).padStart(4, '0')).join(':');
      const lines = [
        `Full: ${full}`,
        `Short: ${full.replace(/\b0+(?=[0-9a-f])/g, '').replace(/\b(?:0(?::0)+)\b/, ':').replace(/:{3,}/, '::')}`,
        `Type: ${ipv6Kind(groups)}`,
      ];

      if ((groups[0] as number) === 0x2002) {
        const embedded = [(groups[1] as number) >> 8, (groups[1] as number) & 0xff, (groups[2] as number) >> 8, (groups[2] as number) & 0xff];
        lines.push(`Encapsulated IPv4: ${embedded.join('.')}`);
      }
      if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
        const embedded = [(groups[6] as number) >> 8, (groups[6] as number) & 0xff, (groups[7] as number) >> 8, (groups[7] as number) & 0xff];
        lines.push(`IPv4-mapped: ${embedded.join('.')}`);
      }
      if (((groups[0] as number) & 0xffc0) === 0xfe80 && ((groups[4] as number) & 0x0200) !== 0) {
        const bytes = [
          ((groups[4] as number) >> 8) ^ 0x02,
          (groups[4] as number) & 0xff,
          (groups[5] as number) >> 8,
          (groups[6] as number) & 0xff,
          (groups[7] as number) >> 8,
          (groups[7] as number) & 0xff,
        ];
        if (((groups[5] as number) & 0xff) === 0xff && (groups[6] as number) >> 8 === 0xfe) {
          lines.push(
            `Derived from MAC: ${bytes.map((b) => b.toString(16).padStart(2, '0')).join(':')}`,
          );
        }
      }
      return lines.join('\n');
    },
  },
  {
    id: 'ipv6-transition-addresses',
    name: 'IPv6 Transition Addresses',
    category: 'Networking',
    description: 'Shows the transition forms an IPv4 address takes, and reverses them.',
    aliases: ['6to4', 'teredo', 'ipv4 mapped'],
    args: [
      {
        name: 'Direction',
        type: 'option',
        value: 'IPv4 to IPv6',
        options: ['IPv4 to IPv6', 'IPv6 to IPv4'],
      },
    ],
    run: (input, args) => {
      const direction = String(arg(args, 'Direction', 'IPv4 to IPv6'));
      if (direction === 'IPv4 to IPv6') {
        const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(input.trim());
        if (!match) throw new OperationError('Expected an IPv4 address.');
        const octets = match.slice(1, 5).map(Number);
        if (octets.some((o) => o > 255)) throw new OperationError('An octet cannot exceed 255.');
        const pair = (a: number, b: number) => ((a << 8) | b).toString(16);
        const high = pair(octets[0] as number, octets[1] as number);
        const low = pair(octets[2] as number, octets[3] as number);
        return [
          `IPv4-mapped: ::ffff:${high}:${low}`,
          `IPv4-compatible: ::${high}:${low}`,
          `6to4: 2002:${high}:${low}::/48`,
        ].join('\n');
      }

      const groups = expandIpv6(input);
      const extract = (a: number, b: number) =>
        [(a >> 8) & 0xff, a & 0xff, (b >> 8) & 0xff, b & 0xff].join('.');
      if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
        return `IPv4-mapped address of ${extract(groups[6] as number, groups[7] as number)}`;
      }
      if (groups[0] === 0x2002) {
        return `6to4 address of ${extract(groups[1] as number, groups[2] as number)}`;
      }
      if (groups.slice(0, 6).every((g) => g === 0)) {
        return `IPv4-compatible address of ${extract(groups[6] as number, groups[7] as number)}`;
      }
      throw new OperationError('This address carries no embedded IPv4 address.');
    },
  },
  {
    id: 'format-mac-addresses',
    name: 'Format MAC addresses',
    category: 'Networking',
    description: 'Rewrites every MAC address in the input in the chosen notations.',
    aliases: ['mac', 'hardware address', 'ether address'],
    args: [
      { name: 'Output case', type: 'option', value: 'Both', options: ['Both', 'Upper only', 'Lower only'] },
      { name: 'No delimiter', type: 'boolean', value: true },
      { name: 'Dash delimiter', type: 'boolean', value: true },
      { name: 'Colon delimiter', type: 'boolean', value: true },
      { name: 'Cisco style', type: 'boolean', value: false },
      { name: 'IPv6 interface ID', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const outputCase = String(arg(args, 'Output case', 'Both'));
      const cases =
        outputCase === 'Upper only' ? ['upper'] : outputCase === 'Lower only' ? ['lower'] : ['lower', 'upper'];

      const out: string[] = [];
      for (const match of input.matchAll(/[0-9a-f]{2}(?:[:.-]?[0-9a-f]{2}){5}/gi)) {
        const digits = match[0].replace(/[^0-9a-f]/gi, '').toLowerCase();
        if (digits.length !== 12) continue;
        const pairs = digits.match(/../g) as string[];

        const forms: string[] = [];
        if (arg(args, 'No delimiter', true)) forms.push(digits);
        if (arg(args, 'Dash delimiter', true)) forms.push(pairs.join('-'));
        if (arg(args, 'Colon delimiter', true)) forms.push(pairs.join(':'));
        if (arg(args, 'Cisco style', false)) {
          forms.push((digits.match(/..../g) as string[]).join('.'));
        }
        if (arg(args, 'IPv6 interface ID', false)) {
          const flipped = (parseInt(pairs[0] as string, 16) ^ 2).toString(16).padStart(2, '0');
          const id = [flipped, ...pairs.slice(1, 3), 'ff', 'fe', ...pairs.slice(3)].join('');
          forms.push((id.match(/..../g) as string[]).join(':'));
        }

        for (const form of forms) {
          for (const which of cases) out.push(which === 'upper' ? form.toUpperCase() : form);
        }
      }
      if (out.length === 0) throw new OperationError('No MAC addresses found.');
      return out.join('\n');
    },
  },
];
