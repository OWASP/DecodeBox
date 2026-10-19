import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import {
  clone,
  decodeImage,
  encodeBmp,
  encodePng,
  makeImage,
  pixel,
  setPixel,
  type Image,
} from '../core/image';
import { drawText, textWidth, GLYPH_HEIGHT } from '../core/font';
import { arg, type Operation } from './types';


async function load(input: string): Promise<Image> {
  return decodeImage(asBytes(input));
}

async function save(image: Image): Promise<string> {
  return bytesToLatin1(await encodePng(image));
}

function eachPixel(image: Image, fn: (rgba: number[], x: number, y: number) => number[]): Image {
  const out = clone(image);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const at = (y * image.width + x) * 4;
      const result = fn(
        [out.data[at]!, out.data[at + 1]!, out.data[at + 2]!, out.data[at + 3]!],
        x,
        y,
      );
      out.data[at] = result[0]!;
      out.data[at + 1] = result[1]!;
      out.data[at + 2] = result[2]!;
      out.data[at + 3] = result[3]!;
    }
  }
  return out;
}


function flip(image: Image, horizontal: boolean, vertical: boolean): Image {
  const out = makeImage(image.width, image.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const sx = horizontal ? image.width - 1 - x : x;
      const sy = vertical ? image.height - 1 - y : y;
      setPixel(out, x, y, pixel(image, sx, sy));
    }
  }
  return out;
}

function rotateRight(image: Image, quarters: number): Image {
  const turns = ((quarters % 4) + 4) % 4;
  if (turns === 0) return clone(image);

  const swapped = turns % 2 === 1;
  const out = makeImage(swapped ? image.height : image.width, swapped ? image.width : image.height);

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const source = pixel(image, x, y);
      if (turns === 1) setPixel(out, image.height - 1 - y, x, source);
      else if (turns === 2) setPixel(out, image.width - 1 - x, image.height - 1 - y, source);
      else setPixel(out, y, image.width - 1 - x, source);
    }
  }
  return out;
}

function sample(image: Image, fx: number, fy: number): number[] {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const dx = fx - x0;
  const dy = fy - y0;

  const p00 = pixel(image, x0, y0);
  const p10 = pixel(image, x0 + 1, y0);
  const p01 = pixel(image, x0, y0 + 1);
  const p11 = pixel(image, x0 + 1, y0 + 1);

  const out: number[] = [];
  for (let c = 0; c < 4; c++) {
    const top = p00[c]! * (1 - dx) + p10[c]! * dx;
    const bottom = p01[c]! * (1 - dx) + p11[c]! * dx;
    out.push(Math.round(top * (1 - dy) + bottom * dy));
  }
  return out;
}

function resize(image: Image, width: number, height: number, smooth: boolean): Image {
  const out = makeImage(width, height);
  const scaleX = image.width / width;
  const scaleY = image.height / height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (smooth) {
        setPixel(out, x, y, sample(image, (x + 0.5) * scaleX - 0.5, (y + 0.5) * scaleY - 0.5));
      } else {
        setPixel(out, x, y, pixel(image, Math.floor(x * scaleX), Math.floor(y * scaleY)));
      }
    }
  }
  return out;
}

function crop(image: Image, x: number, y: number, width: number, height: number): Image {
  if (width <= 0 || height <= 0) throw new OperationError('A crop needs a positive width and height.');
  if (x < 0 || y < 0 || x + width > image.width || y + height > image.height) {
    throw new OperationError(
      `That rectangle does not fit: the image is ${image.width}×${image.height}.`,
    );
  }
  const out = makeImage(width, height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      setPixel(out, column, row, pixel(image, x + column, y + row));
    }
  }
  return out;
}

function fit(image: Image, width: number, height: number, cover: boolean, background: number[]): Image {
  const scale = cover
    ? Math.max(width / image.width, height / image.height)
    : Math.min(width / image.width, height / image.height);

  const scaled = resize(
    image,
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
    true,
  );

  const out = makeImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(out, x, y, background);
  }

  const offsetX = Math.round((width - scaled.width) / 2);
  const offsetY = Math.round((height - scaled.height) / 2);
  for (let y = 0; y < scaled.height; y++) {
    const ty = y + offsetY;
    if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < scaled.width; x++) {
      const tx = x + offsetX;
      if (tx < 0 || tx >= width) continue;
      setPixel(out, tx, ty, pixel(scaled, x, y));
    }
  }
  return out;
}


function convolve(image: Image, kernel: number[], size: number, divisor: number, bias = 0): Image {
  const out = makeImage(image.width, image.height);
  const half = (size - 1) / 2;

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const sums = [0, 0, 0];
      for (let ky = 0; ky < size; ky++) {
        for (let kx = 0; kx < size; kx++) {
          const weight = kernel[ky * size + kx]!;
          if (weight === 0) continue;
          const source = pixel(image, x + kx - half, y + ky - half);
          sums[0]! += source[0]! * weight;
          sums[1]! += source[1]! * weight;
          sums[2]! += source[2]! * weight;
        }
      }
      const alpha = pixel(image, x, y)[3]!;
      setPixel(out, x, y, [
        sums[0]! / divisor + bias,
        sums[1]! / divisor + bias,
        sums[2]! / divisor + bias,
        alpha,
      ]);
    }
  }
  return out;
}

function gaussianKernel(radius: number): { kernel: number[]; size: number; divisor: number } {
  const size = radius * 2 + 1;
  const sigma = Math.max(radius / 2, 0.5);
  const kernel: number[] = [];
  let divisor = 0;

  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const value = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
      kernel.push(value);
      divisor += value;
    }
  }
  return { kernel, size, divisor };
}

const luminance = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;

  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) hue = ((bn - rn) / delta + 2) / 6;
  else hue = ((rn - gn) / delta + 4) / 6;
  return [hue, saturation, lightness];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const grey = Math.round(l * 255);
    return [grey, grey, grey];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const channel = (t: number): number => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };

  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255),
  ];
}


function random(seed: number): () => number {
  let state = (seed >>> 0) || 0x2545f491;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

const CHANNELS = ['Red', 'Green', 'Blue', 'Alpha'];

function channelIndex(name: string): number {
  const at = CHANNELS.indexOf(name);
  if (at < 0) throw new OperationError(`'${name}' is not a colour channel.`);
  return at;
}


export const imageOperations: Operation[] = [
  {
    id: 'invert-image',
    name: 'Invert Image',
    category: 'Multimedia',
    description: 'Turns every colour into its opposite, leaving transparency alone.',
    aliases: ['negative', 'invert colours', 'photo negative'],
    budgetMs: 20000,
    args: [{ name: 'Invert alpha too', type: 'boolean', value: false }],
    run: async (input, args) => {
      const invertAlpha = arg(args, 'Invert alpha too', false);
      const image = await load(input);
      return save(
        eachPixel(image, ([r, g, b, a]) => [
          255 - r!,
          255 - g!,
          255 - b!,
          invertAlpha ? 255 - a! : a!,
        ]),
      );
    },
  },
  {
    id: 'flip-image',
    name: 'Flip Image',
    category: 'Multimedia',
    description: 'Mirrors the picture horizontally, vertically, or both.',
    aliases: ['mirror', 'reflect image'],
    budgetMs: 20000,
    args: [
      {
        name: 'Axis',
        type: 'option',
        value: 'Horizontal',
        options: ['Horizontal', 'Vertical', 'Both'],
      },
    ],
    run: async (input, args) => {
      const axis = String(arg(args, 'Axis', 'Horizontal'));
      const image = await load(input);
      return save(flip(image, axis !== 'Vertical', axis !== 'Horizontal'));
    },
  },
  {
    id: 'rotate-image',
    name: 'Rotate Image',
    category: 'Multimedia',
    description: 'Turns the picture a quarter, a half or three quarters of the way round.',
    aliases: ['turn image', 'rotate 90', 'orientation'],
    budgetMs: 20000,
    args: [
      {
        name: 'Rotation',
        type: 'option',
        value: '90° clockwise',
        options: ['90° clockwise', '180°', '90° anticlockwise'],
      },
    ],
    run: async (input, args) => {
      const rotation = String(arg(args, 'Rotation', '90° clockwise'));
      const quarters = rotation === '180°' ? 2 : rotation.includes('anticlockwise') ? 3 : 1;
      return save(rotateRight(await load(input), quarters));
    },
  },
  {
    id: 'crop-image',
    name: 'Crop Image',
    category: 'Multimedia',
    description: 'Keeps a rectangle of the picture and discards the rest.',
    aliases: ['trim image', 'cut out', 'clip'],
    budgetMs: 20000,
    args: [
      { name: 'X', type: 'number', value: 0, min: 0 },
      { name: 'Y', type: 'number', value: 0, min: 0 },
      { name: 'Width', type: 'number', value: 100, min: 1 },
      { name: 'Height', type: 'number', value: 100, min: 1 },
    ],
    run: async (input, args) =>
      save(
        crop(
          await load(input),
          Number(arg(args, 'X', 0)),
          Number(arg(args, 'Y', 0)),
          Number(arg(args, 'Width', 100)),
          Number(arg(args, 'Height', 100)),
        ),
      ),
  },
  {
    id: 'resize-image',
    name: 'Resize Image',
    category: 'Multimedia',
    description: 'Changes the size of the picture, in pixels or as a percentage.',
    aliases: ['scale image', 'shrink', 'enlarge', 'thumbnail'],
    budgetMs: 30000,
    args: [
      { name: 'Width', type: 'number', value: 100, min: 1 },
      { name: 'Height', type: 'number', value: 100, min: 1 },
      { name: 'Unit', type: 'option', value: 'Pixels', options: ['Pixels', 'Percent'] },
      { name: 'Keep the aspect ratio', type: 'boolean', value: false },
      { name: 'Smooth', type: 'boolean', value: true },
    ],
    run: async (input, args) => {
      const image = await load(input);
      const percent = arg(args, 'Unit', 'Pixels') === 'Percent';
      let width = Number(arg(args, 'Width', 100));
      let height = Number(arg(args, 'Height', 100));

      if (percent) {
        width = Math.max(1, Math.round((image.width * width) / 100));
        height = Math.max(1, Math.round((image.height * height) / 100));
      }
      if (arg(args, 'Keep the aspect ratio', false)) {
        const scale = Math.min(width / image.width, height / image.height);
        width = Math.max(1, Math.round(image.width * scale));
        height = Math.max(1, Math.round(image.height * scale));
      }
      return save(resize(image, width, height, arg(args, 'Smooth', true)));
    },
  },
  {
    id: 'contain-image',
    name: 'Contain Image',
    category: 'Multimedia',
    description: 'Fits the whole picture inside a given size, padding what is left over.',
    aliases: ['letterbox', 'fit image', 'pad image'],
    budgetMs: 30000,
    args: [
      { name: 'Width', type: 'number', value: 100, min: 1 },
      { name: 'Height', type: 'number', value: 100, min: 1 },
      {
        name: 'Background',
        type: 'option',
        value: 'Transparent',
        options: ['Transparent', 'Black', 'White'],
      },
    ],
    run: async (input, args) => {
      const background = String(arg(args, 'Background', 'Transparent'));
      const colour =
        background === 'Black' ? [0, 0, 0, 255] : background === 'White' ? [255, 255, 255, 255] : [0, 0, 0, 0];
      return save(
        fit(
          await load(input),
          Number(arg(args, 'Width', 100)),
          Number(arg(args, 'Height', 100)),
          false,
          colour,
        ),
      );
    },
  },
  {
    id: 'cover-image',
    name: 'Cover Image',
    category: 'Multimedia',
    description: 'Fills a given size with the picture, cropping whatever overflows.',
    aliases: ['fill image', 'crop to fit'],
    budgetMs: 30000,
    args: [
      { name: 'Width', type: 'number', value: 100, min: 1 },
      { name: 'Height', type: 'number', value: 100, min: 1 },
    ],
    run: async (input, args) =>
      save(
        fit(
          await load(input),
          Number(arg(args, 'Width', 100)),
          Number(arg(args, 'Height', 100)),
          true,
          [0, 0, 0, 0],
        ),
      ),
  },
  {
    id: 'blur-image',
    name: 'Blur Image',
    category: 'Multimedia',
    description: 'Softens the picture, either quickly with a box blur or smoothly with a Gaussian.',
    aliases: ['soften', 'gaussian blur', 'redact'],
    budgetMs: 30000,
    args: [
      { name: 'Amount', type: 'number', value: 3, min: 1, max: 20 },
      { name: 'Type', type: 'option', value: 'Gaussian', options: ['Gaussian', 'Box'] },
    ],
    run: async (input, args) => {
      const radius = Math.min(20, Math.max(1, Number(arg(args, 'Amount', 3))));
      const image = await load(input);

      if (arg(args, 'Type', 'Gaussian') === 'Box') {
        const size = radius * 2 + 1;
        const kernel = new Array<number>(size * size).fill(1);
        return save(convolve(image, kernel, size, size * size));
      }
      const { kernel, size, divisor } = gaussianKernel(radius);
      return save(convolve(image, kernel, size, divisor));
    },
  },
  {
    id: 'sharpen-image',
    name: 'Sharpen Image',
    category: 'Multimedia',
    description: 'Increases local contrast so edges stand out.',
    aliases: ['unsharp', 'crisp', 'enhance edges'],
    budgetMs: 30000,
    args: [{ name: 'Amount', type: 'number', value: 1, min: 1, max: 10 }],
    run: async (input, args) => {
      const amount = Math.min(10, Math.max(1, Number(arg(args, 'Amount', 1))));
      const centre = 4 * amount + 1;
      const edge = -amount;
      const kernel = [0, edge, 0, edge, centre, edge, 0, edge, 0];
      return save(convolve(await load(input), kernel, 3, 1));
    },
  },
  {
    id: 'image-brightness-contrast',
    name: 'Image Brightness / Contrast',
    category: 'Multimedia',
    description: 'Lightens or darkens the picture and stretches or flattens its contrast.',
    aliases: ['brighten', 'darken', 'levels', 'exposure'],
    budgetMs: 20000,
    args: [
      { name: 'Brightness', type: 'number', value: 0, min: -255, max: 255 },
      { name: 'Contrast', type: 'number', value: 0, min: -100, max: 100 },
    ],
    run: async (input, args) => {
      const brightness = Number(arg(args, 'Brightness', 0));
      const contrast = Number(arg(args, 'Contrast', 0));
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

      const adjust = (value: number): number => factor * (value + brightness - 128) + 128;
      return save(
        await load(input).then((image) =>
          eachPixel(image, ([r, g, b, a]) => [adjust(r!), adjust(g!), adjust(b!), a!]),
        ),
      );
    },
  },
  {
    id: 'image-opacity',
    name: 'Image Opacity',
    category: 'Multimedia',
    description: 'Makes the whole picture more or less transparent.',
    aliases: ['alpha', 'transparency', 'fade'],
    budgetMs: 20000,
    args: [{ name: 'Opacity %', type: 'number', value: 50, min: 0, max: 100 }],
    run: async (input, args) => {
      const factor = Math.min(100, Math.max(0, Number(arg(args, 'Opacity %', 50)))) / 100;
      const image = await load(input);
      return save(eachPixel(image, ([r, g, b, a]) => [r!, g!, b!, a! * factor]));
    },
  },
  {
    id: 'image-filter',
    name: 'Image Filter',
    category: 'Multimedia',
    description: 'Applies a colour filter: greyscale, sepia, or a single channel on its own.',
    aliases: ['greyscale', 'grayscale', 'sepia', 'black and white', 'monochrome'],
    budgetMs: 20000,
    args: [
      {
        name: 'Filter',
        type: 'option',
        value: 'Greyscale',
        options: ['Greyscale', 'Sepia', 'Red only', 'Green only', 'Blue only', 'Threshold'],
      },
      { name: 'Threshold', type: 'number', value: 128, min: 0, max: 255 },
    ],
    run: async (input, args) => {
      const filter = String(arg(args, 'Filter', 'Greyscale'));
      const threshold = Number(arg(args, 'Threshold', 128));
      const image = await load(input);

      return save(
        eachPixel(image, ([r, g, b, a]) => {
          const grey = luminance(r!, g!, b!);
          switch (filter) {
            case 'Sepia':
              return [
                0.393 * r! + 0.769 * g! + 0.189 * b!,
                0.349 * r! + 0.686 * g! + 0.168 * b!,
                0.272 * r! + 0.534 * g! + 0.131 * b!,
                a!,
              ];
            case 'Red only':
              return [r!, 0, 0, a!];
            case 'Green only':
              return [0, g!, 0, a!];
            case 'Blue only':
              return [0, 0, b!, a!];
            case 'Threshold': {
              const value = grey >= threshold ? 255 : 0;
              return [value, value, value, a!];
            }
            default:
              return [grey, grey, grey, a!];
          }
        }),
      );
    },
  },
  {
    id: 'image-hsl',
    name: 'Image Hue/Saturation/Lightness',
    category: 'Multimedia',
    description: 'Shifts the hue, saturation and lightness of every colour in the picture.',
    aliases: ['hue shift', 'saturate', 'desaturate', 'colourise'],
    budgetMs: 30000,
    args: [
      { name: 'Hue shift (degrees)', type: 'number', value: 0, min: -360, max: 360 },
      { name: 'Saturation %', type: 'number', value: 0, min: -100, max: 100 },
      { name: 'Lightness %', type: 'number', value: 0, min: -100, max: 100 },
    ],
    run: async (input, args) => {
      const hueShift = Number(arg(args, 'Hue shift (degrees)', 0)) / 360;
      const saturation = Number(arg(args, 'Saturation %', 0)) / 100;
      const lightness = Number(arg(args, 'Lightness %', 0)) / 100;
      const image = await load(input);

      return save(
        eachPixel(image, ([r, g, b, a]) => {
          const [h, s, l] = toHsl(r!, g!, b!);
          const [nr, ng, nb] = fromHsl(
            (((h + hueShift) % 1) + 1) % 1,
            Math.min(1, Math.max(0, s + saturation)),
            Math.min(1, Math.max(0, l + lightness)),
          );
          return [nr, ng, nb, a!];
        }),
      );
    },
  },
  {
    id: 'normalise-image',
    name: 'Normalise Image',
    category: 'Multimedia',
    description: 'Stretches the picture to use the whole range from black to white.',
    aliases: ['auto levels', 'stretch contrast', 'histogram stretch'],
    budgetMs: 20000,
    args: [
      {
        name: 'Channels',
        type: 'option',
        value: 'Together',
        options: ['Together', 'Separately'],
        hint: 'Separately stretches R, G and B on their own, which also removes a colour cast.',
      },
      {
        name: 'Ignore outliers',
        type: 'number',
        value: 0,
        min: 0,
        max: 20,
        hint: 'Per cent of the darkest and lightest pixels to disregard. One stuck pixel at 0 or 255 otherwise flattens the whole stretch.',
      },
    ],
    run: async (input, args) => {
      const image = await load(input);
      const separate = arg(args, 'Channels', 'Together') === 'Separately';
      const clip = Math.max(0, Math.min(20, Number(arg(args, 'Ignore outliers', 0)))) / 100;

      const bounds = (channel: number): [number, number] => {
        const histogram = new Uint32Array(256);
        let count = 0;
        for (let i = 0; i < image.data.length; i += 4) {
          if (separate) {
            histogram[image.data[i + channel]!]! += 1;
            count += 1;
          } else {
            for (let c = 0; c < 3; c += 1) {
              histogram[image.data[i + c]!]! += 1;
              count += 1;
            }
          }
        }
        const drop = Math.floor(count * clip);
        let low = 0;
        let high = 255;
        for (let seen = 0, v = 0; v < 256; v += 1) {
          seen += histogram[v]!;
          if (seen > drop) {
            low = v;
            break;
          }
        }
        for (let seen = 0, v = 255; v >= 0; v -= 1) {
          seen += histogram[v]!;
          if (seen > drop) {
            high = v;
            break;
          }
        }
        return [low, high];
      };

      if (!separate) {
        const [low, high] = bounds(0);
        if (high <= low) return save(clone(image));
        const scale = 255 / (high - low);
        return save(
          eachPixel(image, ([r, g, b, a]) => [
            (r! - low) * scale,
            (g! - low) * scale,
            (b! - low) * scale,
            a!,
          ]),
        );
      }

      const perChannel = [bounds(0), bounds(1), bounds(2)];
      return save(
        eachPixel(image, ([r, g, b, a]) => {
          const stretch = (value: number, index: number) => {
            const pair = perChannel[index]!;
            if (pair[1] <= pair[0]) return value;
            return (value - pair[0]) * (255 / (pair[1] - pair[0]));
          };
          return [stretch(r!, 0), stretch(g!, 1), stretch(b!, 2), a!];
        }),
      );
    },
  },
  {
    id: 'dither-image',
    name: 'Dither Image',
    category: 'Multimedia',
    description: 'Reduces the picture to black and white, spreading the error into its neighbours.',
    aliases: ['floyd-steinberg', 'halftone', '1-bit', 'bayer'],
    budgetMs: 30000,
    args: [],
    run: async (input) => {
      const image = await load(input);
      const out = clone(image);
      const errors = new Float64Array(image.width * image.height);

      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const at = (y * image.width + x) * 4;
          const index = y * image.width + x;
          const old = luminance(out.data[at]!, out.data[at + 1]!, out.data[at + 2]!) + errors[index]!;
          const value = old >= 128 ? 255 : 0;
          const error = old - value;

          out.data[at] = value;
          out.data[at + 1] = value;
          out.data[at + 2] = value;

          const spread = (dx: number, dy: number, weight: number): void => {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= image.width || ny >= image.height) return;
            errors[ny * image.width + nx]! += (error * weight) / 16;
          };
          spread(1, 0, 7);
          spread(-1, 1, 3);
          spread(0, 1, 5);
          spread(1, 1, 1);
        }
      }
      return save(out);
    },
  },
  {
    id: 'convert-image-format',
    name: 'Convert Image Format',
    category: 'Multimedia',
    description: 'Rewrites the picture as PNG or BMP.',
    aliases: ['png to bmp', 'bmp to png', 'image convert'],
    budgetMs: 30000,
    args: [{ name: 'Format', type: 'option', value: 'PNG', options: ['PNG', 'BMP'] }],
    run: async (input, args) => {
      const image = await load(input);
      if (arg(args, 'Format', 'PNG') === 'BMP') return bytesToLatin1(encodeBmp(image));
      return save(image);
    },
  },
  {
    id: 'split-colour-channels',
    name: 'Split Colour Channels',
    category: 'Multimedia',
    description: 'Shows the red, green and blue channels of the picture side by side.',
    aliases: ['separate channels', 'rgb split', 'channel view'],
    budgetMs: 30000,
    args: [
      {
        name: 'Show as',
        type: 'option',
        value: 'Grey',
        options: ['Grey', 'Colour'],
        hint: 'Grey shows each channel as brightness; Colour tints it',
      },
    ],
    run: async (input, args) => {
      const image = await load(input);
      const tinted = arg(args, 'Show as', 'Grey') === 'Colour';
      const out = makeImage(image.width * 3, image.height);

      for (let channel = 0; channel < 3; channel++) {
        for (let y = 0; y < image.height; y++) {
          for (let x = 0; x < image.width; x++) {
            const value = pixel(image, x, y)[channel]!;
            const rgba = tinted
              ? [channel === 0 ? value : 0, channel === 1 ? value : 0, channel === 2 ? value : 0, 255]
              : [value, value, value, 255];
            setPixel(out, channel * image.width + x, y, rgba);
          }
        }
      }
      return save(out);
    },
  },
  {
    id: 'generate-image',
    name: 'Generate Image',
    category: 'Multimedia',
    description: 'Draws the input bytes as a picture, which makes structure in binary data visible.',
    aliases: ['bytes as image', 'visualise binary', 'binary picture'],
    budgetMs: 30000,
    args: [
      {
        name: 'Mode',
        type: 'option',
        value: 'Greyscale',
        options: ['Greyscale', 'RGB', 'RGBA', 'Bits'],
      },
      { name: 'Width', type: 'number', value: 0, min: 0, hint: '0 chooses a square' },
      { name: 'Scale', type: 'number', value: 1, min: 1, max: 16 },
    ],
    run: async (input, args) => {
      const bytes = asBytes(input);
      if (bytes.length === 0) throw new OperationError('There is nothing to draw.');

      const mode = String(arg(args, 'Mode', 'Greyscale'));
      const perPixel = mode === 'RGB' ? 3 : mode === 'RGBA' ? 4 : 1;
      const count = mode === 'Bits' ? bytes.length * 8 : Math.ceil(bytes.length / perPixel);

      let width = Number(arg(args, 'Width', 0));
      if (width <= 0) width = Math.max(1, Math.ceil(Math.sqrt(count)));
      const height = Math.max(1, Math.ceil(count / width));

      const image = makeImage(width, height);
      for (let i = 0; i < count; i++) {
        const x = i % width;
        const y = Math.floor(i / width);
        if (mode === 'Bits') {
          const bit = (bytes[i >> 3]! >> (7 - (i & 7))) & 1;
          setPixel(image, x, y, bit ? [255, 255, 255, 255] : [0, 0, 0, 255]);
        } else if (mode === 'RGB') {
          setPixel(image, x, y, [
            bytes[i * 3] ?? 0,
            bytes[i * 3 + 1] ?? 0,
            bytes[i * 3 + 2] ?? 0,
            255,
          ]);
        } else if (mode === 'RGBA') {
          setPixel(image, x, y, [
            bytes[i * 4] ?? 0,
            bytes[i * 4 + 1] ?? 0,
            bytes[i * 4 + 2] ?? 0,
            bytes[i * 4 + 3] ?? 255,
          ]);
        } else {
          const value = bytes[i] ?? 0;
          setPixel(image, x, y, [value, value, value, 255]);
        }
      }

      const scale = Math.min(16, Math.max(1, Number(arg(args, 'Scale', 1))));
      return save(scale === 1 ? image : resize(image, width * scale, height * scale, false));
    },
  },
  {
    id: 'add-text-to-image',
    name: 'Add Text To Image',
    category: 'Multimedia',
    description: 'Writes a line of text onto the picture.',
    aliases: ['caption', 'label image', 'watermark', 'annotate'],
    budgetMs: 30000,
    args: [
      { name: 'Text', type: 'string', value: '' },
      {
        name: 'Position',
        type: 'option',
        value: 'Bottom left',
        options: ['Top left', 'Top right', 'Bottom left', 'Bottom right', 'Centre'],
      },
      { name: 'Size', type: 'number', value: 3, min: 1, max: 20 },
      { name: 'Colour', type: 'option', value: 'White', options: ['White', 'Black', 'Red'] },
      { name: 'Margin', type: 'number', value: 8, min: 0, max: 200 },
    ],
    run: async (input, args) => {
      const text = String(arg(args, 'Text', ''));
      if (text.length === 0) throw new OperationError('There is no text to add.');

      const image = clone(await load(input));
      const scale = Math.min(20, Math.max(1, Number(arg(args, 'Size', 3))));
      const margin = Number(arg(args, 'Margin', 8));
      const width = textWidth(text, scale);
      const height = GLYPH_HEIGHT * scale;

      const position = String(arg(args, 'Position', 'Bottom left'));
      const x = position.includes('right')
        ? image.width - width - margin
        : position === 'Centre'
          ? Math.round((image.width - width) / 2)
          : margin;
      const y = position.startsWith('Top')
        ? margin
        : position === 'Centre'
          ? Math.round((image.height - height) / 2)
          : image.height - height - margin;

      const colour = { White: [255, 255, 255, 255], Black: [0, 0, 0, 255], Red: [230, 60, 60, 255] }[
        String(arg(args, 'Colour', 'White'))
      ] ?? [255, 255, 255, 255];

      drawText(image, text, x, y, colour, scale);
      return save(image);
    },
  },
  {
    id: 'extract-rgba',
    name: 'Extract RGBA',
    category: 'Forensics',
    description: 'Writes out the colour values of every pixel as numbers.',
    aliases: ['pixel values', 'dump pixels', 'rgba values'],
    budgetMs: 30000,
    args: [
      { name: 'Delimiter', type: 'string', value: ',' },
      { name: 'Include alpha', type: 'boolean', value: true },
      { name: 'One pixel per line', type: 'boolean', value: false },
    ],
    run: async (input, args) => {
      const image = await load(input);
      const delimiter = String(arg(args, 'Delimiter', ','));
      const withAlpha = arg(args, 'Include alpha', true);
      const perLine = arg(args, 'One pixel per line', false);

      const pixels: string[] = [];
      for (let i = 0; i < image.data.length; i += 4) {
        const parts = [image.data[i], image.data[i + 1], image.data[i + 2]];
        if (withAlpha) parts.push(image.data[i + 3]);
        pixels.push(parts.join(delimiter));
      }
      return pixels.join(perLine ? '\n' : delimiter);
    },
  },
  {
    id: 'view-bit-plane',
    name: 'View Bit Plane',
    category: 'Forensics',
    description: 'Shows a single bit of one colour channel as a black and white picture.',
    aliases: ['bit plane', 'steganography', 'plane view'],
    budgetMs: 30000,
    args: [
      { name: 'Channel', type: 'option', value: 'Red', options: CHANNELS },
      { name: 'Bit', type: 'number', value: 0, min: 0, max: 7, hint: '0 is the least significant' },
    ],
    run: async (input, args) => {
      const image = await load(input);
      const channel = channelIndex(String(arg(args, 'Channel', 'Red')));
      const bit = Math.min(7, Math.max(0, Number(arg(args, 'Bit', 0))));

      return save(
        eachPixel(image, (rgba) => {
          const value = ((rgba[channel]! >> bit) & 1) === 1 ? 255 : 0;
          return [value, value, value, 255];
        }),
      );
    },
  },
  {
    id: 'extract-lsb',
    name: 'Extract LSB',
    category: 'Forensics',
    description: 'Collects the least significant bits of the pixels into bytes.',
    aliases: ['least significant bit', 'steganography extract', 'lsb steg'],
    budgetMs: 30000,
    args: [
      {
        name: 'Channels',
        type: 'string',
        value: 'RGB',
        hint: 'Any of R, G, B, A, in the order they should be read',
      },
      { name: 'Bits per channel', type: 'number', value: 1, min: 1, max: 8 },
      {
        name: 'Order',
        type: 'option',
        value: 'Row by row',
        options: ['Row by row', 'Column by column'],
      },
    ],
    run: async (input, args) => {
      const image = await load(input);
      const wanted = String(arg(args, 'Channels', 'RGB'))
        .toUpperCase()
        .split('')
        .map((letter) => 'RGBA'.indexOf(letter))
        .filter((index) => index >= 0);
      if (wanted.length === 0) throw new OperationError('Name at least one channel: R, G, B or A.');

      const depth = Math.min(8, Math.max(1, Number(arg(args, 'Bits per channel', 1))));
      const byColumn = arg(args, 'Order', 'Row by row') === 'Column by column';

      const bits: number[] = [];
      const visit = (x: number, y: number): void => {
        const rgba = pixel(image, x, y);
        for (const channel of wanted) {
          for (let b = depth - 1; b >= 0; b--) bits.push((rgba[channel]! >> b) & 1);
        }
      };

      if (byColumn) {
        for (let x = 0; x < image.width; x++) for (let y = 0; y < image.height; y++) visit(x, y);
      } else {
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) visit(x, y);
      }

      const out = new Uint8Array(Math.floor(bits.length / 8));
      for (let i = 0; i < out.length; i++) {
        let byte = 0;
        for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b]!;
        out[i] = byte;
      }
      return bytesToLatin1(out);
    },
  },
  {
    id: 'randomize-colour-palette',
    name: 'Randomize Colour Palette',
    category: 'Forensics',
    description: 'Reassigns every distinct colour at random, which makes flat areas separate.',
    aliases: ['random palette', 'palette shuffle', 'false colour'],
    budgetMs: 30000,
    args: [{ name: 'Seed', type: 'number', value: 1, min: 0 }],
    run: async (input, args) => {
      const image = await load(input);
      const next = random(Number(arg(args, 'Seed', 1)));
      const mapping = new Map<number, number[]>();

      return save(
        eachPixel(image, ([r, g, b, a]) => {
          const key = (r! << 16) | (g! << 8) | b!;
          let replacement = mapping.get(key);
          if (!replacement) {
            replacement = [
              Math.floor(next() * 256),
              Math.floor(next() * 256),
              Math.floor(next() * 256),
            ];
            mapping.set(key, replacement);
          }
          return [replacement[0]!, replacement[1]!, replacement[2]!, a!];
        }),
      );
    },
  },
];
