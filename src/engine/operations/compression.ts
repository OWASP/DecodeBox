import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';

async function transform(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream();
  const piped = source.pipeThrough(stream as ReadableWritablePair<Uint8Array, Uint8Array>);
  const buffer = await new Response(piped).arrayBuffer();
  return new Uint8Array(buffer);
}

function asBinary(input: string): Uint8Array {
  return asBytes(input);
}

async function decompress(input: string, format: 'gzip' | 'deflate' | 'deflate-raw') {
  try {
    return bytesToLatin1(await transform(asBinary(input), new DecompressionStream(format)));
  } catch {
    throw new OperationError(`Input is not valid ${format} data.`);
  }
}

async function compress(input: string, format: 'gzip' | 'deflate' | 'deflate-raw') {
  return bytesToLatin1(await transform(asBytes(input), new CompressionStream(format)));
}

function withGzipHeader(
  raw: Uint8Array,
  options: { filename: string; comment: string; mtime: number },
): Uint8Array {
  if (raw.length < 10 || raw[0] !== 0x1f || raw[1] !== 0x8b) return raw;

  const latin1 = (text: string) => Array.from(text, (c) => c.charCodeAt(0) & 0xff);
  const name = options.filename ? [...latin1(options.filename.replace(/\0/g, '')), 0] : [];
  const comment = options.comment ? [...latin1(options.comment.replace(/\0/g, '')), 0] : [];

  let flags = raw[3] as number;
  if (name.length) flags |= 0x08;
  if (comment.length) flags |= 0x10;

  const head = raw.slice(0, 10);
  head[3] = flags;
  const seconds = Math.max(0, Math.floor(options.mtime));
  head[4] = seconds & 0xff;
  head[5] = (seconds >>> 8) & 0xff;
  head[6] = (seconds >>> 16) & 0xff;
  head[7] = (seconds >>> 24) & 0xff;

  const out = new Uint8Array(head.length + name.length + comment.length + (raw.length - 10));
  out.set(head, 0);
  out.set(name, 10);
  out.set(comment, 10 + name.length);
  out.set(raw.subarray(10), 10 + name.length + comment.length);
  return out;
}

export const compressionOperations: Operation[] = [
  {
    id: 'gunzip',
    name: 'Gunzip',
    category: 'Compression',
    description: 'Decompresses gzip data.',
    aliases: ['gzip decompress', 'ungzip', 'inflate gzip'],
    args: [],
    run: (input) => decompress(input, 'gzip'),
    detection: {
      formatName: 'gzip',
      magic: '1f8b',
      minLength: 10,
    },
  },
  {
    id: 'gzip',
    name: 'Gzip',
    category: 'Compression',
    description: 'Compresses data using gzip.',
    aliases: ['gzip compress'],
    args: [
      {
        name: 'Filename',
        type: 'string',
        value: '',
        hint: 'Stored in the header, as gzip does for a file it compressed.',
      },
      { name: 'Comment', type: 'string', value: '' },
      {
        name: 'Modification time',
        type: 'option',
        value: 'None',
        options: ['None', 'Now', 'Unix timestamp'],
        hint: 'None writes zero, which is what a browser-made archive looks like.',
      },
      { name: 'Timestamp', type: 'number', value: 0, min: 0 },
    ],
    run: async (input, args) => {
      const raw = await transform(asBytes(input), new CompressionStream('gzip'));
      const when = String(arg(args, 'Modification time', 'None'));
      const mtime =
        when === 'Now'
          ? Math.floor(Date.now() / 1000)
          : when === 'Unix timestamp'
            ? Number(arg(args, 'Timestamp', 0))
            : 0;

      return bytesToLatin1(
        withGzipHeader(raw, {
          filename: String(arg(args, 'Filename', '')),
          comment: String(arg(args, 'Comment', '')),
          mtime: Number.isFinite(mtime) ? mtime : 0,
        }),
      );
    },
  },
  {
    id: 'zlib-inflate',
    name: 'Zlib Inflate',
    category: 'Compression',
    description: 'Decompresses zlib-wrapped deflate data.',
    aliases: ['inflate', 'zlib decompress'],
    args: [],
    run: (input) => decompress(input, 'deflate'),
    detection: {
      formatName: 'zlib',
      magic: '789c',
      minLength: 8,
    },
  },
  {
    id: 'zlib-deflate',
    name: 'Zlib Deflate',
    category: 'Compression',
    description: 'Compresses data using zlib-wrapped deflate.',
    aliases: ['deflate', 'zlib compress'],
    args: [],
    run: (input) => compress(input, 'deflate'),
  },
  {
    id: 'raw-inflate',
    name: 'Raw Inflate',
    category: 'Compression',
    description: 'Decompresses raw deflate data that has no zlib or gzip header.',
    aliases: ['inflate raw', 'deflate decompress'],
    args: [],
    run: (input) => decompress(input, 'deflate-raw'),
  },
  {
    id: 'raw-deflate',
    name: 'Raw Deflate',
    category: 'Compression',
    description: 'Compresses data using deflate with no header.',
    aliases: ['deflate raw'],
    args: [],
    run: (input) => compress(input, 'deflate-raw'),
  },
];
