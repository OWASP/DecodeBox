import { OperationError } from '../types';
import { asBytes } from '../core/bytes';
import { arg, type Operation } from './types';


const FRAME_NAMES: Record<string, string> = {
  TIT2: 'Title',
  TT2: 'Title',
  TPE1: 'Artist',
  TP1: 'Artist',
  TPE2: 'Album artist',
  TALB: 'Album',
  TAL: 'Album',
  TYER: 'Year',
  TYE: 'Year',
  TDRC: 'Recorded',
  TRCK: 'Track',
  TRK: 'Track',
  TCON: 'Genre',
  TCO: 'Genre',
  TPOS: 'Disc',
  TCOM: 'Composer',
  TPUB: 'Publisher',
  TCOP: 'Copyright',
  TENC: 'Encoded by',
  TSSE: 'Encoder settings',
  TXXX: 'User text',
  COMM: 'Comment',
  COM: 'Comment',
  USLT: 'Lyrics',
  APIC: 'Attached picture',
  PIC: 'Attached picture',
  WXXX: 'URL',
  PRIV: 'Private',
  MCDI: 'CD identifier',
  UFID: 'File identifier',
};

const NUL = '\u0000';

function stripNulls(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === NUL) end--;
  return text.slice(0, end);
}

function untilNul(text: string): string {
  const at = text.indexOf(NUL);
  return at === -1 ? text : text.slice(0, at);
}

function syncsafe(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! & 0x7f) << 21) |
    ((bytes[at + 1]! & 0x7f) << 14) |
    ((bytes[at + 2]! & 0x7f) << 7) |
    (bytes[at + 3]! & 0x7f)
  );
}

function decodeText(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const encoding = bytes[0]!;
  const body = bytes.subarray(1);

  let text: string;
  if (encoding === 0) text = new TextDecoder('windows-1252').decode(body);
  else if (encoding === 1) text = new TextDecoder('utf-16').decode(body);
  else if (encoding === 2) text = new TextDecoder('utf-16be').decode(body);
  else if (encoding === 3) text = new TextDecoder().decode(body);
  else text = new TextDecoder('windows-1252').decode(bytes);

  return stripNulls(text).split(NUL).join(' / ').trim();
}

function readId3v2(bytes: Uint8Array): string[] {
  const version = bytes[3]!;
  const revision = bytes[4]!;
  const flags = bytes[5]!;
  const size = syncsafe(bytes, 6);
  const lines = [`ID3v2.${version}.${revision}, ${size} bytes of tag`];

  if ((flags & 0x80) !== 0) {
    lines.push('The tag is unsynchronised, so frame contents may read oddly.');
  }

  let at = 10;
  if ((flags & 0x40) !== 0 && version >= 3) at += syncsafe(bytes, at);

  const idLength = version === 2 ? 3 : 4;
  const end = Math.min(bytes.length, 10 + size);

  while (at + idLength + (version === 2 ? 3 : 6) <= end) {
    const id = new TextDecoder('ascii').decode(bytes.subarray(at, at + idLength));
    if (!/^[A-Z0-9]+$/.test(id)) break; 

    let length: number;
    if (version === 2) {
      length = (bytes[at + 3]! << 16) | (bytes[at + 4]! << 8) | bytes[at + 5]!;
      at += 6;
    } else if (version === 4) {
      length = syncsafe(bytes, at + 4);
      at += 10;
    } else {
      length =
        (bytes[at + 4]! << 24) | (bytes[at + 5]! << 16) | (bytes[at + 6]! << 8) | bytes[at + 7]!;
      at += 10;
    }

    if (length < 0 || at + length > bytes.length) break;
    const body = bytes.subarray(at, at + length);
    at += length;

    const name = FRAME_NAMES[id] ?? id;
    if (id === 'APIC' || id === 'PIC') {
      lines.push(`${name.padEnd(18)} ${length} bytes of image data`);
    } else if (id.startsWith('T') || id === 'COMM' || id === 'COM' || id === 'USLT') {
      const value = decodeText(body);
      if (value.length > 0) lines.push(`${name.padEnd(18)} ${value}`);
    } else {
      lines.push(`${name.padEnd(18)} ${length} bytes`);
    }
  }

  return lines;
}

function readId3v1(bytes: Uint8Array): string[] {
  const at = bytes.length - 128;
  const field = (from: number, length: number): string => {
    const raw = new TextDecoder('windows-1252').decode(
      bytes.subarray(at + from, at + from + length),
    );
    return untilNul(raw).trim();
  };

  const lines = ['ID3v1, the 128 bytes at the end of the file'];
  const fields: Array<[string, string]> = [
    ['Title', field(3, 30)],
    ['Artist', field(33, 30)],
    ['Album', field(63, 30)],
    ['Year', field(93, 4)],
    ['Comment', field(97, 30)],
  ];
  for (const [name, value] of fields) {
    if (value.length > 0) lines.push(`${name.padEnd(18)} ${value}`);
  }
  const genre = bytes[at + 127]!;
  if (genre !== 255) lines.push(`${'Genre'.padEnd(18)} ${genre}`);
  return lines;
}

function readVorbisComments(bytes: Uint8Array, at: number): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lines: string[] = [];

  const vendorLength = view.getUint32(at, true);
  at += 4;
  const vendor = new TextDecoder().decode(bytes.subarray(at, at + vendorLength));
  at += vendorLength;
  if (vendor.length > 0) lines.push(`${'Vendor'.padEnd(18)} ${vendor}`);

  const count = view.getUint32(at, true);
  at += 4;
  for (let i = 0; i < count && at + 4 <= bytes.length; i++) {
    const length = view.getUint32(at, true);
    at += 4;
    const entry = new TextDecoder().decode(bytes.subarray(at, at + length));
    at += length;
    const split = entry.indexOf('=');
    if (split === -1) continue;
    lines.push(`${entry.slice(0, split).padEnd(18)} ${entry.slice(split + 1)}`);
  }
  return lines;
}

function readFlac(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lines = ['FLAC'];
  let at = 4;

  for (;;) {
    if (at + 4 > bytes.length) break;
    const header = bytes[at]!;
    const last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const length = (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!;
    at += 4;

    if (type === 0 && at + 18 <= bytes.length) {
      const rate = (bytes[at + 10]! << 12) | (bytes[at + 11]! << 4) | (bytes[at + 12]! >> 4);
      const channels = ((bytes[at + 12]! >> 1) & 0x07) + 1;
      const depth = (((bytes[at + 12]! & 0x01) << 4) | (bytes[at + 13]! >> 4)) + 1;
      const samples = Number(view.getBigUint64(at + 13) & 0x0fffffffffn);
      lines.push(`${'Sample rate'.padEnd(18)} ${rate} Hz`);
      lines.push(`${'Channels'.padEnd(18)} ${channels}`);
      lines.push(`${'Bit depth'.padEnd(18)} ${depth}`);
      if (rate > 0 && samples > 0) {
        lines.push(`${'Duration'.padEnd(18)} ${(samples / rate).toFixed(2)}s`);
      }
    } else if (type === 4) {
      lines.push(...readVorbisComments(bytes, at));
    } else if (type === 6) {
      lines.push(`${'Attached picture'.padEnd(18)} ${length} bytes`);
    }

    at += length;
    if (last) break;
  }
  return lines;
}

function readRiff(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = new TextDecoder('ascii').decode(bytes.subarray(8, 12));
  const lines = [`RIFF ${kind}`];

  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = new TextDecoder('ascii').decode(bytes.subarray(at, at + 4));
    const length = view.getUint32(at + 4, true);
    const body = at + 8;

    if (id === 'fmt ' && body + 16 <= bytes.length) {
      lines.push(`${'Channels'.padEnd(18)} ${view.getUint16(body + 2, true)}`);
      lines.push(`${'Sample rate'.padEnd(18)} ${view.getUint32(body + 4, true)} Hz`);
      lines.push(`${'Bit depth'.padEnd(18)} ${view.getUint16(body + 14, true)}`);
    } else if (id === 'LIST') {
      const listType = new TextDecoder('ascii').decode(bytes.subarray(body, body + 4));
      if (listType === 'INFO') {
        let inner = body + 4;
        while (inner + 8 <= body + length) {
          const tag = new TextDecoder('ascii').decode(bytes.subarray(inner, inner + 4));
          const size = view.getUint32(inner + 4, true);
          const value = stripNulls(
            new TextDecoder('windows-1252').decode(bytes.subarray(inner + 8, inner + 8 + size)),
          );
          lines.push(`${tag.padEnd(18)} ${value}`);
          inner += 8 + size + (size % 2);
        }
      }
    }

    at = body + length + (length % 2);
  }
  return lines;
}

function looksLike(bytes: Uint8Array, ascii: string, at = 0): boolean {
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[at + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

export const metadataOperations: Operation[] = [
  {
    id: 'extract-id3',
    name: 'Extract ID3',
    category: 'Forensics',
    description: 'Reads the ID3v1 and ID3v2 tags an MP3 carries.',
    aliases: ['id3 tags', 'mp3 metadata', 'mp3 tags'],
    args: [],
    run: (input) => {
      const bytes = asBytes(input);
      const lines: string[] = [];

      if (looksLike(bytes, 'ID3')) lines.push(...readId3v2(bytes));
      if (bytes.length >= 128 && looksLike(bytes, 'TAG', bytes.length - 128)) {
        if (lines.length > 0) lines.push('');
        lines.push(...readId3v1(bytes));
      }

      if (lines.length === 0) {
        throw new OperationError(
          "No ID3 tag here: the data starts with neither 'ID3' nor ends with a 128-byte 'TAG' block.",
        );
      }
      return lines.join('\n');
    },
    detection: { magic: '494433', formatName: 'ID3', minLength: 10 },
  },
  {
    id: 'extract-audio-metadata',
    name: 'Extract Audio Metadata',
    category: 'Forensics',
    description: 'Reads the tags and stream details of MP3, FLAC, Ogg, WAV and AVI files.',
    aliases: ['audio tags', 'vorbis comments', 'flac metadata', 'wav metadata'],
    args: [{ name: 'Include the format line', type: 'boolean', value: true }],
    run: (input, args) => {
      const bytes = asBytes(input);
      let lines: string[];

      if (looksLike(bytes, 'fLaC')) {
        lines = readFlac(bytes);
      } else if (looksLike(bytes, 'RIFF')) {
        lines = readRiff(bytes);
      } else if (looksLike(bytes, 'OggS')) {
        const marker = [0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73];
        let found = -1;
        for (let i = 0; i + marker.length < bytes.length && found === -1; i++) {
          if (marker.every((b, j) => bytes[i + j] === b)) found = i + marker.length;
        }
        if (found === -1) throw new OperationError('This Ogg stream carries no Vorbis comments.');
        lines = ['Ogg Vorbis', ...readVorbisComments(bytes, found)];
      } else if (looksLike(bytes, 'ID3') || (bytes.length >= 128 && looksLike(bytes, 'TAG', bytes.length - 128))) {
        lines = [];
        if (looksLike(bytes, 'ID3')) lines.push(...readId3v2(bytes));
        if (bytes.length >= 128 && looksLike(bytes, 'TAG', bytes.length - 128)) {
          if (lines.length > 0) lines.push('');
          lines.push(...readId3v1(bytes));
        }
      } else {
        throw new OperationError(
          'This is not a container this operation knows: it reads MP3 (ID3), FLAC, Ogg, WAV and AVI.',
        );
      }

      if (!arg(args, 'Include the format line', true)) lines = lines.slice(1);
      return lines.join('\n');
    },
  },
];
