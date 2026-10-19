import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation } from './operations';
import type { Recipe } from './types';


type Entry = string | [string, Record<string, string | number | boolean>];

function recipe(...entries: Entry[]): Recipe {
  return {
    id: 'test',
    name: 'test',
    steps: entries.map((entry, i) => {
      const [opId, overrides] = typeof entry === 'string' ? [entry, {}] : entry;
      const op = getOperation(opId);
      if (!op) throw new Error(`Unknown operation '${opId}'`);
      return {
        uid: `s${i}`,
        opId,
        args: op.args.map((a) => ({ ...a, value: overrides[a.name] ?? a.value })),
        disabled: false,
      };
    }),
  };
}

async function raw(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (result.error) throw new Error(`${String(entries[0])}: ${result.error.message}`);
  return result.output;
}

async function run(input: string, ...entries: Entry[]): Promise<string> {
  return renderText(await raw(input, ...entries));
}

const toHex = (byteString: string) =>
  Array.from(byteString, (c) => (c.charCodeAt(0) & 0xff).toString(16).padStart(2, '0')).join('');

describe('VarInt', () => {
  it('matches the Protobuf documentation examples', async () => {
    expect(toHex(await raw('1', 'varint-encode'))).toBe('01');
    expect(toHex(await raw('150', 'varint-encode'))).toBe('9601');
    expect(toHex(await raw('300', 'varint-encode'))).toBe('ac02');
    expect(await run('9601', 'from-hex', 'varint-decode')).toBe('150');
    expect(await run('ac02', 'from-hex', 'varint-decode')).toBe('300');
  });

  it('round-trips a number beyond 32 bits', async () => {
    expect(await run('123456789012345', 'varint-encode', 'varint-decode')).toBe('123456789012345');
  });

  it('refuses a negative number', async () => {
    const result = await bake('-1', recipe('varint-encode'));
    expect(result.error?.message).toMatch(/negative/);
  });
});

describe('NetBIOS names', () => {
  it('matches the RFC 1001 example', async () => {
    expect(await run('FRED', 'encode-netbios-name')).toBe('EGFCEFEECACACACACACACACACACACACA');
    expect(await run('EGFCEFEECACACACACACACACACACACACA', 'decode-netbios-name')).toBe('FRED');
  });
});

describe('IP headers', () => {
  const IPV4 = '4500007300004000401' + '1b861c0a80001c0a800c7';

  it('reads every field, and confirms the checksum', async () => {
    const parsed = await run(IPV4, 'parse-ipv4-header');
    expect(parsed).toContain('Version: 4');
    expect(parsed).toContain('Internet header length: 5 words = 20 bytes');
    expect(parsed).toContain('Total length: 115 bytes');
    expect(parsed).toContain("Flags: don't fragment");
    expect(parsed).toContain('Time to live: 64');
    expect(parsed).toContain('Protocol: 17 (UDP)');
    expect(parsed).toContain('Header checksum: 0xb861 (correct)');
    expect(parsed).toContain('Source: 192.168.0.1');
    expect(parsed).toContain('Destination: 192.168.0.199');
  });

  it('says what the checksum should have been', async () => {
    const broken = IPV4.replace('b861', '0000');
    expect(await run(broken, 'parse-ipv4-header')).toContain('should be 0xb861');
  });

  it('strips the header from the payload', async () => {
    expect(toHex(await raw(`${IPV4}deadbeef`, 'strip-ipv4-header'))).toBe('deadbeef');
  });
});

describe('TCP and UDP', () => {
  const TCP = '0050c738000000010000000250122000000000 00'.replace(/ /g, '');

  it('reads a TCP header and its flags', async () => {
    const parsed = await run(TCP, 'parse-tcp');
    expect(parsed).toContain('Source port: 80');
    expect(parsed).toContain('Destination port: 51000');
    expect(parsed).toContain('Sequence number: 1');
    expect(parsed).toContain('Acknowledgement number: 2');
    expect(parsed).toContain('Flags: ACK, SYN');
    expect(parsed).toContain('Window size: 8192');
  });

  it('reads a UDP header', async () => {
    const parsed = await run('003500350010ffff', 'parse-udp');
    expect(parsed).toContain('Source port: 53');
    expect(parsed).toContain('Destination port: 53');
    expect(parsed).toContain('Length: 16 bytes');
  });

  it('strips both headers', async () => {
    expect(toHex(await raw(`${TCP}c0ffee`, 'strip-tcp-header'))).toBe('c0ffee');
    expect(toHex(await raw('003500350010ffffc0ffee', 'strip-udp-header'))).toBe('c0ffee');
  });
});

describe('Ethernet', () => {
  it('reads the addresses and the type', async () => {
    const parsed = await run('ffffffffffff0011223344550806', 'parse-ethernet-frame');
    expect(parsed).toContain('Destination: ff:ff:ff:ff:ff:ff');
    expect(parsed).toContain('Source: 00:11:22:33:44:55');
    expect(parsed).toContain('EtherType: 0x0806 (ARP)');
    expect(parsed).toContain('multicast or broadcast');
  });
});

describe('addresses', () => {
  it('expands a CIDR block', async () => {
    const parsed = await run('10.0.0.0/24', 'parse-ip-range');
    expect(parsed).toContain('Netmask: 255.255.255.0');
    expect(parsed).toContain('Broadcast: 10.0.0.255');
    expect(parsed).toContain('First host: 10.0.0.1');
    expect(parsed).toContain('Last host: 10.0.0.254');
    expect(parsed).toContain('Addresses: 256');
    expect(parsed).toContain('Usable hosts: 254');
  });

  it('enumerates a small block and refuses a large one', async () => {
    const listed = await run('192.168.1.0/30', [
      'parse-ip-range',
      { 'Include network info': false, 'Enumerate IP addresses': true },
    ]);
    expect(listed).toBe('192.168.1.0\n192.168.1.1\n192.168.1.2\n192.168.1.3');

    const result = await bake(
      '10.0.0.0/8',
      recipe(['parse-ip-range', { 'Enumerate IP addresses': true }]),
    );
    expect(result.error?.message).toMatch(/is the limit for listing/);
  });

  it('groups addresses by subnet', async () => {
    const grouped = await run('10.0.1.5 10.0.1.9 10.0.2.3', 'group-ip-addresses');
    expect(grouped).toContain('10.0.1.0/24');
    expect(grouped).toContain('  10.0.1.5');
    expect(grouped).toContain('10.0.2.0/24');
  });

  it('expands and classifies an IPv6 address', async () => {
    const parsed = await run('2001:db8::ff00:42:8329', 'parse-ipv6-address');
    expect(parsed).toContain('Full: 2001:0db8:0000:0000:0000:ff00:0042:8329');
    expect(parsed).toContain('Type: Global unicast');

    expect(await run('::1', 'parse-ipv6-address')).toContain('Type: Loopback');
    expect(await run('fe80::1', 'parse-ipv6-address')).toContain('Type: Link-local unicast');
    expect(await run('ff02::1', 'parse-ipv6-address')).toContain('Type: Multicast');
  });

  it('shows the transition forms of an IPv4 address', async () => {
    const forms = await run('192.168.0.1', 'ipv6-transition-addresses');
    expect(forms).toContain('IPv4-mapped: ::ffff:c0a8:1');
    expect(forms).toContain('6to4: 2002:c0a8:1::/48');

    expect(
      await run('::ffff:c0a8:1', ['ipv6-transition-addresses', { Direction: 'IPv6 to IPv4' }]),
    ).toBe('IPv4-mapped address of 192.168.0.1');
  });

  it('rewrites MAC addresses in every notation asked for', async () => {
    const forms = await run('00:11:22:33:44:55', [
      'format-mac-addresses',
      { 'Output case': 'Lower only', 'Cisco style': true, 'IPv6 interface ID': true },
    ]);
    expect(forms.split('\n')).toEqual([
      '001122334455',
      '00-11-22-33-44-55',
      '00:11:22:33:44:55',
      '0011.2233.4455',
      '0211:22ff:fe33:4455',
    ]);
  });
});

describe('HTTP', () => {
  it('strips headers from the body', async () => {
    expect(
      await run('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nbody here', 'strip-http-headers'),
    ).toBe('body here');
  });

  it('joins a chunked body, using the Wikipedia example', async () => {
    const chunked = '4\r\nWiki\r\n6\r\npedia \r\nE\r\nin \r\n\r\nchunks.\r\n0\r\n\r\n';
    expect(await run(chunked, 'dechunk-http-response')).toBe('Wikipedia in \r\n\r\nchunks.');
  });
});
