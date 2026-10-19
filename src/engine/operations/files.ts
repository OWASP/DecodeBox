import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';


function u16(bytes: Uint8Array, offset: number, little = true): number {
  const a = bytes[offset] ?? 0;
  const b = bytes[offset + 1] ?? 0;
  return little ? a | (b << 8) : (a << 8) | b;
}

function u32(bytes: Uint8Array, offset: number, little = true): number {
  const a = bytes[offset] ?? 0;
  const b = bytes[offset + 1] ?? 0;
  const c = bytes[offset + 2] ?? 0;
  const d = bytes[offset + 3] ?? 0;
  return (little ? a | (b << 8) | (c << 16) | (d << 24) : (a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return bytesToLatin1(bytes.subarray(offset, offset + length));
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}


interface ImageInfo {
  format: string;
  mime: string;
  width: number;
  height: number;
  extra: string[];
}

const PNG_COLOUR: Record<number, string> = {
  0: 'greyscale',
  2: 'truecolour',
  3: 'indexed',
  4: 'greyscale + alpha',
  6: 'truecolour + alpha',
};

function readImage(bytes: Uint8Array): ImageInfo | null {
  if (ascii(bytes, 1, 3) === 'PNG') {
    return {
      format: 'PNG',
      mime: 'image/png',
      width: u32(bytes, 16, false),
      height: u32(bytes, 20, false),
      extra: [
        `Bit depth:   ${bytes[24] ?? 0}`,
        `Colour type: ${PNG_COLOUR[bytes[25] ?? 0] ?? 'unknown'}`,
        `Interlaced:  ${bytes[28] === 1 ? 'yes' : 'no'}`,
      ],
    };
  }

  if (ascii(bytes, 0, 3) === 'GIF') {
    return {
      format: `GIF (${ascii(bytes, 3, 3)})`,
      mime: 'image/gif',
      width: u16(bytes, 6),
      height: u16(bytes, 8),
      extra: [`Colour table: ${(bytes[10] ?? 0) & 0x80 ? 'global' : 'none'}`],
    };
  }

  if (ascii(bytes, 0, 2) === 'BM') {
    return {
      format: 'BMP',
      mime: 'image/bmp',
      width: u32(bytes, 18),
      height: u32(bytes, 22),
      extra: [`Bits per pixel: ${u16(bytes, 28)}`],
    };
  }

  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X') {
      return {
        format: 'WebP (extended)',
        mime: 'image/webp',
        width: (u32(bytes, 24) & 0xffffff) + 1,
        height: ((u32(bytes, 26) >>> 8) & 0xffffff) + 1,
        extra: [`Animation: ${(bytes[20] ?? 0) & 0x02 ? 'yes' : 'no'}`],
      };
    }
    return {
      format: `WebP (${chunk})`,
      mime: 'image/webp',
      width: u16(bytes, 26) & 0x3fff,
      height: u16(bytes, 28) & 0x3fff,
      extra: [],
    };
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1] ?? 0;
      const length = u16(bytes, offset + 2, false);

      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          format: 'JPEG',
          mime: 'image/jpeg',
          width: u16(bytes, offset + 7, false),
          height: u16(bytes, offset + 5, false),
          extra: [
            `Precision:  ${bytes[offset + 4] ?? 0} bits`,
            `Components: ${bytes[offset + 9] ?? 0}`,
            `Progressive: ${marker === 0xc2 ? 'yes' : 'no'}`,
          ],
        };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
    return { format: 'JPEG', mime: 'image/jpeg', width: 0, height: 0, extra: ['No frame header found.'] };
  }

  if (ascii(bytes, 0, 4) === '<svg' || ascii(bytes, 0, 5) === '<?xml') {
    const text = bytesToLatin1(bytes.subarray(0, 2048));
    if (!text.includes('<svg')) return null;
    return {
      format: 'SVG',
      mime: 'image/svg+xml',
      width: Number(/width="(\d+)/.exec(text)?.[1] ?? 0),
      height: Number(/height="(\d+)/.exec(text)?.[1] ?? 0),
      extra: ['SVG is markup, and markup can carry script. Never render one you do not trust.'],
    };
  }

  return null;
}


const EXIF_TAGS: Record<number, string> = {
  0x010f: 'Make',
  0x0110: 'Model',
  0x0112: 'Orientation',
  0x011a: 'X resolution',
  0x011b: 'Y resolution',
  0x0131: 'Software',
  0x0132: 'Modified',
  0x013b: 'Artist',
  0x8298: 'Copyright',
  0x829a: 'Exposure time',
  0x829d: 'F number',
  0x8827: 'ISO',
  0x9003: 'Taken',
  0x9004: 'Digitised',
  0xa002: 'Pixel width',
  0xa003: 'Pixel height',
  0x0100: 'Image width',
  0x0101: 'Image height',
};

function readExif(bytes: Uint8Array): string[] {
  let offset = 2;
  let tiff = -1;
  while (offset + 4 < bytes.length && offset < 65536) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    const length = u16(bytes, offset + 2, false);
    if (marker === 0xe1 && ascii(bytes, offset + 4, 4) === 'Exif') {
      tiff = offset + 10;
      break;
    }
    if (length < 2) break;
    offset += 2 + length;
  }
  if (tiff === -1) return [];

  const little = ascii(bytes, tiff, 2) === 'II';
  const ifd = tiff + u32(bytes, tiff + 4, little);
  const count = u16(bytes, ifd, little);
  const found: string[] = [];

  for (let i = 0; i < count && i < 200; i++) {
    const entry = ifd + 2 + i * 12;
    const tag = u16(bytes, entry, little);
    const name = EXIF_TAGS[tag];
    if (!name) continue;

    const type = u16(bytes, entry + 2, little);
    const length = u32(bytes, entry + 4, little);
    const valueOffset = u32(bytes, entry + 8, little);

    let value = '';
    if (type === 2) {
      const at = length > 4 ? tiff + valueOffset : entry + 8;
      value = ascii(bytes, at, Math.max(0, length - 1)).replace(/\0/g, '').trim();
    } else if (type === 3) {
      value = String(u16(bytes, entry + 8, little));
    } else if (type === 4) {
      value = String(valueOffset);
    } else if (type === 5) {
      const at = tiff + valueOffset;
      const numerator = u32(bytes, at, little);
      const denominator = u32(bytes, at + 4, little);
      value = denominator === 0 ? String(numerator) : `${numerator}/${denominator}`;
    }

    if (value.length > 0) found.push(`${name.padEnd(15)} ${value}`);
  }

  return found;
}


interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  uncompressed: number;
  headerOffset: number;
  crc: number;
}

function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new OperationError('No ZIP central directory found.');

  const total = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < total && offset + 46 <= bytes.length; i++) {
    if (u32(bytes, offset) !== 0x02014b50) break;
    const nameLength = u16(bytes, offset + 28);
    entries.push({
      name: ascii(bytes, offset + 46, nameLength),
      method: u16(bytes, offset + 10),
      crc: u32(bytes, offset + 16),
      compressed: u32(bytes, offset + 20),
      uncompressed: u32(bytes, offset + 24),
      headerOffset: u32(bytes, offset + 42),
    });
    offset += 46 + nameLength + u16(bytes, offset + 30) + u16(bytes, offset + 32);
  }

  return entries;
}

async function extractZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const local = entry.headerOffset;
  if (u32(bytes, local) !== 0x04034b50) throw new OperationError('Corrupt ZIP local header.');

  const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
  const data = bytes.subarray(start, start + entry.compressed);

  if (entry.method === 0) return data;
  if (entry.method !== 8) {
    throw new OperationError(
      `This entry uses compression method ${entry.method}. Only stored and deflate are supported.`,
    );
  }

  try {
    const stream = new Blob([data as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw') as ReadableWritablePair<Uint8Array, Uint8Array>);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new OperationError('The entry is not valid deflate data. It may be encrypted.');
  }
}


const PE_MACHINES: Record<number, string> = {
  0x014c: 'x86 (i386)',
  0x0200: 'Itanium',
  0x8664: 'x86-64',
  0x01c0: 'ARM',
  0xaa64: 'ARM64',
  0x01c4: 'ARMv7 Thumb',
};

const ELF_MACHINES: Record<number, string> = {
  0x03: 'x86',
  0x3e: 'x86-64',
  0x28: 'ARM',
  0xb7: 'AArch64',
  0xf3: 'RISC-V',
  0x08: 'MIPS',
};

const ELF_TYPES: Record<number, string> = {
  1: 'relocatable',
  2: 'executable',
  3: 'shared object',
  4: 'core dump',
};

export const fileOperations: Operation[] = [
  {
    id: 'image-info',
    name: 'Parse image',
    category: 'Multimedia',
    description: 'Reads dimensions and encoding details from an image header.',
    aliases: ['image dimensions', 'image header', 'picture info'],
    args: [],
    run: (input) => {
      const bytes = asBytes(input);
      const info = readImage(bytes);
      if (!info) throw new OperationError('Not a recognised image format.');

      return [
        `Format:      ${info.format}`,
        `MIME type:   ${info.mime}`,
        `Dimensions:  ${info.width} × ${info.height}`,
        `File size:   ${formatSize(bytes.length)}`,
        ...info.extra.map((line) => (line.includes(':') ? line : `             ${line}`)),
      ].join('\n');
    },
  },
  {
    id: 'render-image',
    name: 'Render image',
    category: 'Multimedia',
    description: 'Displays the input as a picture in the output pane.',
    aliases: ['show image', 'view image', 'display picture', 'preview'],
    args: [],
    run: (input) => {
      const bytes = asBytes(input);
      const info = readImage(bytes);
      if (!info) throw new OperationError('Not a recognised image format.');
      if (info.mime === 'image/svg+xml') {
        throw new OperationError(
          'SVG is not rendered. It is markup that can carry script, and this is a tool for untrusted input.',
        );
      }
      return `data:${info.mime};base64,${btoa(bytesToLatin1(bytes))}`;
    },
  },
  {
    id: 'extract-exif',
    name: 'Extract EXIF',
    category: 'Forensics',
    description: 'Reads the EXIF metadata a camera or phone wrote into a JPEG.',
    aliases: ['exif', 'photo metadata', 'camera data'],
    args: [],
    run: (input) => {
      const bytes = asBytes(input);
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        throw new OperationError('EXIF lives in JPEG files; this is not one.');
      }
      const found = readExif(bytes);
      if (found.length === 0) return 'No EXIF metadata found. It may have been stripped.';
      return ['EXIF metadata:', '', ...found].join('\n');
    },
  },
  {
    id: 'strip-exif',
    name: 'Strip EXIF',
    category: 'Forensics',
    description: 'Removes the APP1 metadata segment from a JPEG.',
    aliases: ['remove exif', 'scrub metadata', 'anonymise photo'],
    args: [],
    run: (input) => {
      const bytes = asBytes(input);
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new OperationError('Not a JPEG.');

      const out: number[] = [0xff, 0xd8];
      let offset = 2;
      let removed = 0;

      while (offset + 2 <= bytes.length && bytes[offset] === 0xff) {
        if (bytes[offset + 1] === 0xff) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1] ?? 0;
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          out.push(0xff, marker);
          offset += 2;
          continue;
        }
        if (offset + 4 > bytes.length) break;
        const length = u16(bytes, offset + 2, false);
        if (length < 2 || offset + 2 + length > bytes.length) break;

        if (marker === 0xe1 || marker === 0xed || marker === 0xee) removed++;
        else for (let i = offset; i < offset + 2 + length; i++) out.push(bytes[i]!);

        offset += 2 + length;
      }
      for (let i = offset; i < bytes.length; i++) out.push(bytes[i]!);

      if (removed === 0) return bytesToLatin1(bytes);
      return bytesToLatin1(new Uint8Array(out));
    },
  },
  {
    id: 'list-zip',
    name: 'List ZIP contents',
    category: 'Compression',
    description: 'Lists the files inside a ZIP archive without extracting them.',
    aliases: ['zip list', 'unzip -l', 'archive contents', 'jar contents'],
    args: [],
    run: (input) => {
      const entries = readZipDirectory(asBytes(input));
      if (entries.length === 0) return '(the archive is empty)';

      const width = Math.max(...entries.map((e) => e.name.length), 4);
      const rows = entries.map((e) => {
        const ratio =
          e.uncompressed > 0 ? `${Math.round((1 - e.compressed / e.uncompressed) * 100)}%` : '—';
        const method = e.method === 0 ? 'stored' : e.method === 8 ? 'deflate' : `m${e.method}`;
        return `${e.name.padEnd(width)}  ${String(e.uncompressed).padStart(10)}  ${ratio.padStart(5)}  ${method}`;
      });

      const total = entries.reduce((sum, e) => sum + e.uncompressed, 0);
      return [
        `${'Name'.padEnd(width)}  ${'Size'.padStart(10)}  ${'Saved'.padStart(5)}  Method`,
        `${'-'.repeat(width)}  ${'-'.repeat(10)}  ${'-'.repeat(5)}  ------`,
        ...rows,
        '',
        `${entries.length} entries, ${formatSize(total)} uncompressed`,
      ].join('\n');
    },
    detection: {
      formatName: 'ZIP archive',
      magic: '504b0304',
      minLength: 22,
    },
  },
  {
    id: 'extract-from-zip',
    name: 'Extract from ZIP',
    category: 'Compression',
    description: 'Pulls one file out of a ZIP archive by name or index.',
    aliases: ['unzip', 'zip extract', 'open archive'],
    args: [{ name: 'File', type: 'string', value: '', hint: 'Name, or a number for the index' }],
    run: async (input, args) => {
      const bytes = asBytes(input);
      const entries = readZipDirectory(bytes);
      if (entries.length === 0) throw new OperationError('The archive is empty.');

      const wanted = String(arg(args, 'File', '')).trim();
      const entry = wanted.length === 0
        ? entries[0]
        : /^\d+$/.test(wanted)
          ? entries[Number(wanted)]
          : entries.find((e) => e.name === wanted) ?? entries.find((e) => e.name.endsWith(wanted));

      if (!entry) {
        throw new OperationError(
          `No entry called '${wanted}'. Use "List ZIP contents" to see the names.`,
        );
      }

      return bytesToLatin1(await extractZipEntry(bytes, entry));
    },
  },
  {
    id: 'parse-pe',
    name: 'Parse PE header',
    category: 'Forensics',
    description: 'Reads the headers of a Windows executable, DLL or driver.',
    aliases: ['pe header', 'exe header', 'portable executable', 'parse exe'],
    args: [],
    run: (input) => {
      const bytes = asBytes(input);
      if (ascii(bytes, 0, 2) !== 'MZ') throw new OperationError('No MZ signature; not a PE file.');

      const peOffset = u32(bytes, 0x3c);
      if (ascii(bytes, peOffset, 4) !== 'PE\0\0') {
        throw new OperationError('The MZ header does not point at a PE signature.');
      }

      const coff = peOffset + 4;
      const machine = u16(bytes, coff);
      const sections = u16(bytes, coff + 2);
      const timestamp = u32(bytes, coff + 4);
      const optionalSize = u16(bytes, coff + 16);
      const characteristics = u16(bytes, coff + 18);
      const magic = u16(bytes, coff + 20);

      const lines = [
        `Machine:      ${PE_MACHINES[machine] ?? `unknown (0x${machine.toString(16)})`}`,
        `Format:       ${magic === 0x20b ? 'PE32+ (64-bit)' : magic === 0x10b ? 'PE32 (32-bit)' : 'unknown'}`,
        `Kind:         ${characteristics & 0x2000 ? 'DLL' : characteristics & 0x1000 ? 'system file' : 'executable'}`,
        `Compiled:     ${timestamp > 0 ? new Date(timestamp * 1000).toISOString() : 'not set'}`,
        `Sections:     ${sections}`,
        '',
        'Sections:',
      ];

      const table = coff + 20 + optionalSize;
      for (let i = 0; i < sections && table + i * 40 + 40 <= bytes.length; i++) {
        const at = table + i * 40;
        const name = ascii(bytes, at, 8).replace(/\0/g, '');
        const virtualSize = u32(bytes, at + 8);
        const rawSize = u32(bytes, at + 16);
        const flags = u32(bytes, at + 36);

        const perms = [
          flags & 0x20000000 ? 'x' : '-',
          flags & 0x80000000 ? 'w' : '-',
          flags & 0x40000000 ? 'r' : '-',
        ].join('');

        const note = flags & 0x20000000 && flags & 0x80000000 ? '  ← writable AND executable' : '';
        lines.push(
          `  ${name.padEnd(10)} ${perms}  virtual ${String(virtualSize).padStart(8)}  raw ${String(rawSize).padStart(8)}${note}`,
        );
      }

      return lines.join('\n');
    },
    detection: {
      formatName: 'PE executable',
      magic: '4d5a',
      minLength: 64,
    },
  },
  {
    id: 'parse-elf',
    name: 'Parse ELF header',
    category: 'Forensics',
    description: 'Reads the header of a Linux or BSD executable or shared object.',
    aliases: ['elf header', 'parse binary', 'readelf'],
    args: [],
    run: (input) => {
      const bytes = asBytes(input);
      if (bytes[0] !== 0x7f || ascii(bytes, 1, 3) !== 'ELF') {
        throw new OperationError('No ELF magic; not an ELF file.');
      }

      const is64 = bytes[4] === 2;
      const little = bytes[5] === 1;
      const type = u16(bytes, 16, little);
      const machine = u16(bytes, 18, little);
      const entry = is64 ? u32(bytes, 24, little) : u32(bytes, 24, little);

      const abis: Record<number, string> = {
        0: 'System V',
        3: 'Linux',
        6: 'Solaris',
        9: 'FreeBSD',
        12: 'OpenBSD',
      };

      return [
        `Class:        ${is64 ? '64-bit' : '32-bit'}`,
        `Endianness:   ${little ? 'little' : 'big'}`,
        `OS/ABI:       ${abis[bytes[7] ?? 0] ?? `unknown (${bytes[7] ?? 0})`}`,
        `Type:         ${ELF_TYPES[type] ?? `unknown (${type})`}`,
        `Machine:      ${ELF_MACHINES[machine] ?? `unknown (0x${machine.toString(16)})`}`,
        `Entry point:  0x${entry.toString(16)}`,
        `Size:         ${formatSize(bytes.length)}`,
      ].join('\n');
    },
    detection: {
      formatName: 'ELF binary',
      magic: '7f454c46',
      minLength: 20,
    },
  },
  {
    id: 'to-data-uri',
    name: 'To Data URI',
    category: 'Data format',
    description: 'Wraps the input as a data: URI with a detected or chosen MIME type.',
    aliases: ['data url', 'inline file', 'base64 image'],
    args: [{ name: 'MIME type', type: 'string', value: 'auto', hint: 'auto, or e.g. image/png' }],
    run: (input, args) => {
      const bytes = asBytes(input);
      const stated = String(arg(args, 'MIME type', 'auto')).trim();
      const mime =
        stated === 'auto' || stated.length === 0
          ? (readImage(bytes)?.mime ?? 'application/octet-stream')
          : stated;
      return `data:${mime};base64,${btoa(bytesToLatin1(bytes))}`;
    },
  },
  {
    id: 'from-data-uri',
    name: 'From Data URI',
    category: 'Data format',
    description: 'Extracts the payload from a data: URI.',
    aliases: ['parse data url', 'decode data uri'],
    args: [],
    run: (input) => {
      const match = /^data:([^;,]*)(;charset=[^;,]*)?(;base64)?,([\s\S]*)$/.exec(input.trim());
      if (!match) throw new OperationError('Not a data: URI.');

      const payload = match[4] ?? '';
      if (match[3]) {
        try {
          const binary = atob(payload.replace(/\s/g, ''));
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return bytesToLatin1(bytes);
        } catch {
          throw new OperationError('The data URI payload is not valid Base64.');
        }
      }
      return decodeURIComponent(payload);
    },
    detection: {
      formatName: 'Data URI',
      pattern: /^data:[a-z]+\/[a-z0-9.+-]+(;[^,]*)?,/i,
      minLength: 12,
    },
  },
  {
    id: 'file-hashes',
    name: 'File hashes',
    category: 'Forensics',
    description: 'Computes the digests a file would be identified by in a report or feed.',
    aliases: ['ioc hashes', 'sample hashes', 'hash file'],
    args: [
      { name: 'SHA-256', type: 'boolean', value: true },
      { name: 'SHA-1', type: 'boolean', value: true },
      { name: 'SHA-512', type: 'boolean', value: false },
      { name: 'SHA-384', type: 'boolean', value: false },
      {
        name: 'Include the size',
        type: 'boolean',
        value: true,
        hint: 'Off leaves only digests, one per line, for pasting into a feed.',
      },
    ],
    run: async (input, args) => {
      const bytes = asBytes(input);
      if (!globalThis.crypto?.subtle) {
        throw new OperationError('Hashing needs a secure context (HTTPS or localhost).');
      }
      const digest = async (algorithm: string) =>
        Array.from(new Uint8Array(await crypto.subtle.digest(algorithm, bytes as BufferSource)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

      const wanted = (['SHA-256', 'SHA-1', 'SHA-512', 'SHA-384'] as const).filter((name) =>
        arg(args, name, name === 'SHA-256' || name === 'SHA-1'),
      );
      if (wanted.length === 0) throw new OperationError('Choose at least one algorithm.');

      const withSize = arg(args, 'Include the size', true);
      const width = Math.max(...wanted.map((n) => n.length)) + 1;
      const lines = withSize ? [`${'Size:'.padEnd(width + 1)}${bytes.length} bytes`] : [];
      for (const name of wanted) {
        const value = await digest(name);
        lines.push(withSize ? `${(name + ':').padEnd(width + 1)}${value}` : value);
      }
      return lines.join('\n');
    },
  },
];
