import { OperationError } from '../types';
import { imageMime, isBmp, isPng } from './imageSignature';

export { imageMime, isBmp, isPng };


export interface Image {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const MAX_PIXELS = 64 * 1024 * 1024;

export function makeImage(width: number, height: number): Image {
  if (width <= 0 || height <= 0) throw new OperationError('An image needs a positive size.');
  if (width * height > MAX_PIXELS) {
    throw new OperationError(`${width}×${height} is more pixels than a browser tab should hold.`);
  }
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}


async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}


const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}


function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilter(raw: Uint8Array, width: number, height: number, bytesPerPixel: number, rowBytes: number): Uint8Array {
  const out = new Uint8Array(rowBytes * height);
  let at = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    if (filter === undefined) throw new OperationError('The pixel data ends before the last row.');
    const row = y * rowBytes;
    const previous = row - rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const value = raw[at + x];
      if (value === undefined) throw new OperationError('The pixel data ends mid-row.');
      const left = x >= bytesPerPixel ? out[row + x - bytesPerPixel]! : 0;
      const up = y > 0 ? out[previous + x]! : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? out[previous + x - bytesPerPixel]! : 0;

      let result: number;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + up;
          break;
        case 3:
          result = value + ((left + up) >> 1);
          break;
        case 4:
          result = value + paeth(left, up, upLeft);
          break;
        default:
          throw new OperationError(`Filter type ${filter} on row ${y} is not one PNG defines.`);
      }
      out[row + x] = result & 0xff;
    }
    at += rowBytes;
  }
  void width;
  return out;
}

export async function decodePng(bytes: Uint8Array): Promise<Image> {
  if (!isPng(bytes)) throw new OperationError('Not a PNG: the eight-byte signature is missing.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;

  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (at + 12 + length > bytes.length) throw new OperationError(`The ${type} chunk runs past the end of the file.`);

    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = bytes[at + 16]!;
      colourType = bytes[at + 17]!;
      interlace = bytes[at + 20]!;
    } else if (type === 'PLTE') {
      palette = body.slice();
    } else if (type === 'tRNS') {
      transparency = body.slice();
    } else if (type === 'IDAT') {
      idat.push(body.slice());
    } else if (type === 'IEND') {
      break;
    }

    at += 12 + length;
  }

  if (width === 0 || height === 0) throw new OperationError('The PNG header declares no size.');
  if (interlace !== 0) {
    throw new OperationError(
      'This PNG is Adam7 interlaced, which is not supported. Save it without interlacing first.',
    );
  }
  if (idat.length === 0) throw new OperationError('The PNG carries no image data.');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (channels === undefined) throw new OperationError(`Colour type ${colourType} is not one PNG defines.`);
  if (![1, 2, 4, 8, 16].includes(depth)) throw new OperationError(`A bit depth of ${depth} is not one PNG defines.`);

  const image = makeImage(width, height);

  const total = idat.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of idat) {
    joined.set(part, offset);
    offset += part.length;
  }

  let raw: Uint8Array;
  try {
    raw = await inflate(joined);
  } catch {
    throw new OperationError("The PNG's compressed data could not be decompressed: the file is damaged.");
  }

  const bitsPerPixel = channels * depth;
  const rowBytes = Math.ceil((bitsPerPixel * width) / 8);
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3);
  const pixels = unfilter(raw, width, height, bytesPerPixel, rowBytes);

  const sample = (row: number, index: number): number => {
    if (depth === 8) return pixels[row + index]!;
    if (depth === 16) return pixels[row + index * 2]!; 
    const bitAt = index * depth;
    const byte = pixels[row + (bitAt >> 3)]!;
    const shift = 8 - depth - (bitAt & 7);
    const value = (byte >> shift) & ((1 << depth) - 1);
    return colourType === 3 ? value : Math.round((value * 255) / ((1 << depth) - 1));
  };

  for (let y = 0; y < height; y++) {
    const row = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      const base = x * channels;

      if (colourType === 0) {
        const grey = sample(row, base);
        image.data[out] = grey;
        image.data[out + 1] = grey;
        image.data[out + 2] = grey;
        image.data[out + 3] = 255;
      } else if (colourType === 2) {
        image.data[out] = sample(row, base);
        image.data[out + 1] = sample(row, base + 1);
        image.data[out + 2] = sample(row, base + 2);
        image.data[out + 3] = 255;
      } else if (colourType === 3) {
        const index = sample(row, base);
        if (!palette) throw new OperationError('An indexed PNG has no palette.');
        image.data[out] = palette[index * 3] ?? 0;
        image.data[out + 1] = palette[index * 3 + 1] ?? 0;
        image.data[out + 2] = palette[index * 3 + 2] ?? 0;
        image.data[out + 3] = transparency?.[index] ?? 255;
      } else if (colourType === 4) {
        const grey = sample(row, base);
        image.data[out] = grey;
        image.data[out + 1] = grey;
        image.data[out + 2] = grey;
        image.data[out + 3] = sample(row, base + 1);
      } else {
        image.data[out] = sample(row, base);
        image.data[out + 1] = sample(row, base + 1);
        image.data[out + 2] = sample(row, base + 2);
        image.data[out + 3] = sample(row, base + 3);
      }
    }
  }

  return image;
}


function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

function filterRow(row: Uint8Array, previous: Uint8Array, bpp: number, out: Uint8Array, at: number): void {
  const width = row.length;
  const candidates: Uint8Array[] = [];

  for (let type = 0; type < 5; type++) {
    const filtered = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const left = x >= bpp ? row[x - bpp]! : 0;
      const up = previous[x]!;
      const upLeft = x >= bpp ? previous[x - bpp]! : 0;
      const value = row[x]!;
      filtered[x] =
        (type === 0
          ? value
          : type === 1
            ? value - left
            : type === 2
              ? value - up
              : type === 3
                ? value - ((left + up) >> 1)
                : value - paeth(left, up, upLeft)) & 0xff;
    }
    candidates.push(filtered);
  }

  let best = 0;
  let bestCost = Infinity;
  candidates.forEach((candidate, type) => {
    let cost = 0;
    for (const byte of candidate) cost += byte < 128 ? byte : 256 - byte;
    if (cost < bestCost) {
      bestCost = cost;
      best = type;
    }
  });

  out[at] = best;
  out.set(candidates[best]!, at + 1);
}

export async function encodePng(image: Image): Promise<Uint8Array> {
  const { width, height, data } = image;
  const rowBytes = width * 4;
  const raw = new Uint8Array((rowBytes + 1) * height);

  let previous: Uint8Array = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(data.subarray(y * rowBytes, (y + 1) * rowBytes));
    filterRow(row, previous, 4, raw, y * (rowBytes + 1));
    previous = row;
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8; 
  header[9] = 6; 
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const compressed = await deflate(raw);
  const parts = [
    new Uint8Array(PNG_MAGIC),
    chunk('IHDR', header),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}


export function decodeBmp(bytes: Uint8Array): Image {
  if (!isBmp(bytes)) throw new OperationError("Not a BMP: it does not start with 'BM'.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const dataOffset = view.getUint32(10, true);
  const headerSize = view.getUint32(14, true);
  if (headerSize < 40) throw new OperationError('Only BMP files with a 40-byte header or larger are read.');

  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const bits = view.getUint16(28, true);
  const compression = view.getUint32(30, true);

  if (compression !== 0 && compression !== 3) {
    throw new OperationError(`This BMP uses compression method ${compression}, which is not supported.`);
  }
  if (bits !== 24 && bits !== 32) {
    throw new OperationError(`Only 24- and 32-bit BMP files are read; this one is ${bits}-bit.`);
  }

  const image = makeImage(width, height);
  const stride = Math.ceil((width * bits) / 32) * 4;

  for (let y = 0; y < height; y++) {
    const sourceRow = topDown ? y : height - 1 - y;
    const row = dataOffset + sourceRow * stride;
    for (let x = 0; x < width; x++) {
      const at = row + x * (bits / 8);
      const out = (y * width + x) * 4;
      image.data[out] = bytes[at + 2] ?? 0;
      image.data[out + 1] = bytes[at + 1] ?? 0;
      image.data[out + 2] = bytes[at] ?? 0;
      image.data[out + 3] = bits === 32 ? (bytes[at + 3] ?? 255) : 255;
    }
  }
  return image;
}

export function encodeBmp(image: Image): Uint8Array {
  const { width, height, data } = image;
  const stride = Math.ceil((width * 32) / 32) * 4;
  const size = 54 + stride * height;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);

  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, size, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(34, stride * height, true);

  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const at = row + x * 4;
      out[at] = data[from + 2]!;
      out[at + 1] = data[from + 1]!;
      out[at + 2] = data[from]!;
      out[at + 3] = data[from + 3]!;
    }
  }
  return out;
}


export async function decodeImage(bytes: Uint8Array): Promise<Image> {
  if (isPng(bytes)) return decodePng(bytes);
  if (isBmp(bytes)) return decodeBmp(bytes);

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    throw new OperationError(
      'This is a JPEG. DecodeBox reads PNG and BMP; convert it to one of those first.',
    );
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    throw new OperationError('This is a GIF. DecodeBox reads PNG and BMP; convert it first.');
  }
  throw new OperationError('This is not a picture in a format DecodeBox reads (PNG or BMP).');
}

export function clone(image: Image): Image {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

export function pixel(image: Image, x: number, y: number): [number, number, number, number] {
  const cx = Math.min(image.width - 1, Math.max(0, x));
  const cy = Math.min(image.height - 1, Math.max(0, y));
  const at = (cy * image.width + cx) * 4;
  return [image.data[at]!, image.data[at + 1]!, image.data[at + 2]!, image.data[at + 3]!];
}

export function setPixel(image: Image, x: number, y: number, rgba: number[]): void {
  const at = (y * image.width + x) * 4;
  image.data[at] = rgba[0]!;
  image.data[at + 1] = rgba[1]!;
  image.data[at + 2] = rgba[2]!;
  image.data[at + 3] = rgba[3]!;
}
