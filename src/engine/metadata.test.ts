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

async function run(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (result.error) throw new Error(`${String(entries[0])}: ${result.error.message}`);
  return renderText(result.output);
}

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));
const bytes = (values: number[]): string => String.fromCharCode(...values);

function syncsafe(value: number): number[] {
  return [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
}

function big32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function little(value: number, size: number): number[] {
  return Array.from({ length: size }, (_, i) => (value >>> (i * 8)) & 0xff);
}

function frame(id: string, body: number[]): number[] {
  return [...ascii(id), ...big32(body.length), 0, 0, ...body];
}

function id3v2(frames: number[][]): string {
  const body = frames.flat();
  return bytes([...ascii('ID3'), 3, 0, 0, ...syncsafe(body.length), ...body]);
}

function textFrame(id: string, text: string): number[] {
  return frame(id, [0x00, ...ascii(text)]); 
}

function id3v1(title: string, artist: string, album: string, year: string): string {
  const pad = (text: string, length: number): number[] => {
    const out = ascii(text).slice(0, length);
    while (out.length < length) out.push(0);
    return out;
  };
  return bytes([
    ...ascii('TAG'),
    ...pad(title, 30),
    ...pad(artist, 30),
    ...pad(album, 30),
    ...pad(year, 4),
    ...pad('', 30),
    17,
  ]);
}

describe('Extract ID3', () => {
  it('reads the text frames of an ID3v2.3 tag', async () => {
    const tag = id3v2([
      textFrame('TIT2', 'Sleeping Beauty'),
      textFrame('TPE1', 'Alan Turing'),
      textFrame('TALB', 'Bletchley Sessions'),
      textFrame('TYER', '1940'),
      frame('APIC', [0x00, ...ascii('image/png'), 0, 3, 0, 0xde, 0xad, 0xbe, 0xef]),
    ]);

    const report = await run(tag, 'extract-id3');
    expect(report).toContain('ID3v2.3.0');
    expect(report).toContain('Title              Sleeping Beauty');
    expect(report).toContain('Artist             Alan Turing');
    expect(report).toContain('Album              Bletchley Sessions');
    expect(report).toContain('Year               1940');
    expect(report).toMatch(/Attached picture\s+\d+ bytes of image data/);
  });

  it('reads a UTF-16 frame, byte-order mark and all', async () => {
    const utf16 = [0xff, 0xfe, ...ascii('Über').flatMap((c) => [c, 0])];
    utf16[2] = 0xdc; 
    const tag = id3v2([frame('TIT2', [0x01, ...utf16])]);
    expect(await run(tag, 'extract-id3')).toContain('Über');
  });

  it('reads the 128-byte tag at the end of the file', async () => {
    const file = 'some mp3 frames here' + id3v1('Enigma', 'Dilly Knox', 'Hut 6', '1941');
    const report = await run(file, 'extract-id3');
    expect(report).toContain('ID3v1');
    expect(report).toContain('Title              Enigma');
    expect(report).toContain('Artist             Dilly Knox');
    expect(report).toContain('Year               1941');
  });

  it('reads both tags when a file carries both', async () => {
    const file = id3v2([textFrame('TIT2', 'From v2')]) + 'audio' + id3v1('From v1', '', '', '');
    const report = await run(file, 'extract-id3');
    expect(report).toContain('From v2');
    expect(report).toContain('From v1');
  });

  it('says so when there is no tag rather than returning nothing', async () => {
    const result = await bake('plain text, no tag', recipe('extract-id3'));
    expect(result.error?.message).toMatch(/No ID3 tag here/);
  });
});

describe('Extract Audio Metadata', () => {
  it('reads Vorbis comments out of a FLAC file', async () => {
    const comment = [
      ...little(9, 4),
      ...ascii('DecodeBox'),
      ...little(2, 4),
      ...little('TITLE=Colossus'.length, 4),
      ...ascii('TITLE=Colossus'),
      ...little('ARTIST=Tommy Flowers'.length, 4),
      ...ascii('ARTIST=Tommy Flowers'),
    ];
    const file = bytes([
      ...ascii('fLaC'),
      0x84,
      (comment.length >> 16) & 0xff,
      (comment.length >> 8) & 0xff,
      comment.length & 0xff,
      ...comment,
    ]);

    const report = await run(file, 'extract-audio-metadata');
    expect(report).toContain('FLAC');
    expect(report).toContain('Vendor             DecodeBox');
    expect(report).toContain('TITLE              Colossus');
    expect(report).toContain('ARTIST             Tommy Flowers');
  });

  it('reads the format block and INFO list of a WAV file', async () => {
    const fmt = [
      ...ascii('fmt '),
      ...little(16, 4),
      ...little(1, 2), 
      ...little(2, 2), 
      ...little(44100, 4),
      ...little(176400, 4),
      ...little(4, 2),
      ...little(16, 2), 
    ];
    const info = [
      ...ascii('LIST'),
      ...little(4 + 8 + 6, 4),
      ...ascii('INFO'),
      ...ascii('INAM'),
      ...little(6, 4),
      ...ascii('Bombe'),
      0,
    ];
    const body = [...ascii('WAVE'), ...fmt, ...info];
    const file = bytes([...ascii('RIFF'), ...little(body.length, 4), ...body]);

    const report = await run(file, 'extract-audio-metadata');
    expect(report).toContain('RIFF WAVE');
    expect(report).toContain('Channels           2');
    expect(report).toContain('Sample rate        44100 Hz');
    expect(report).toContain('Bit depth          16');
    expect(report).toContain('INAM               Bombe');
  });

  it('falls back to ID3 for an MP3', async () => {
    const tag = id3v2([textFrame('TIT2', 'Lorenz')]);
    expect(await run(tag, 'extract-audio-metadata')).toContain('Title              Lorenz');
  });

  it('names the containers it knows when it meets one it does not', async () => {
    const result = await bake('PNG not audio', recipe('extract-audio-metadata'));
    expect(result.error?.message).toMatch(/MP3 \(ID3\), FLAC, Ogg, WAV and AVI/);
  });
});
