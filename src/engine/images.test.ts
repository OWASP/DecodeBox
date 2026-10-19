import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation } from './operations';
import { decodeImage } from './core/image';
import { asBytes } from './core/bytes';
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

const RGBA2X2 =
  '89504e470d0a1a0a0000000d494844520000000200000002080600000072b60d240000001849' +
  '444154789c63f8cfc0f09fe13f43030303c37f1060000043d308794a4ae4460000000049454e' +
  '44ae426082';

const RGB3X2 =
  '89504e470d0a1a0a0000000d49484452000000030000000208020000001216f14d0000001349' +
  '444154789c63e41291830096a8a828080b0018d802b839d0d4a00000000049454e44ae426082';

const GREY4X1 =
  '89504e470d0a1a0a0000000d4948445200000004000000010800000000dc5750110000000d49' +
  '444154789c6360085df51f00035701ff2d6672ef0000000049454e44ae426082';

const PALETTE2X2 =
  '89504e470d0a1a0a0000000d49484452000000020000000202030000000fd8e5b70000000c50' +
  '4c5445ff000000ff000000ff000000fbbe46e40000000c49444154789c631060d8000000e400' +
  'c127a8e8570000000049454e44ae426082';

const GRADIENT8X8 =
  '89504e470d0a1a0a0000000d49484452000000080000000808020000004b6d29dc0000001b49' +
  '444154789c63646060506010c0442c0c0a020c0c58d0e094000085ae05ce83611c2f00000000' +
  '49454e44ae426082';

const BMP2X2 =
  '424d460000000000000036000000280000000200000002000000010018000000000010000000' +
  'c40e0000c40e00000000000000000000ff0000ffffff00000000ff00ff000000';

async function pixels(
  fixture: string,
  ...entries: Entry[]
): Promise<{ width: number; height: number; data: number[] }> {
  const out = await run(fixture, 'from-hex', ...entries);
  const image = await decodeImage(asBytes(out));
  return { width: image.width, height: image.height, data: Array.from(image.data) };
}

describe('image decoding', () => {
  it('reads every colour type Pillow can write', async () => {
    expect((await pixels(RGBA2X2, 'invert-image', 'invert-image')).data).toEqual([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 0,
    ]);
    expect((await pixels(GREY4X1, 'invert-image', 'invert-image')).data).toEqual([
      0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255,
    ]);
    expect((await pixels(PALETTE2X2, 'invert-image', 'invert-image')).data).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255,
    ]);
  });

  it('reads a BMP as well as a PNG', async () => {
    const { width, height, data } = await pixels(BMP2X2, 'invert-image', 'invert-image');
    expect([width, height]).toEqual([2, 2]);
    expect(data.slice(0, 4)).toEqual([255, 0, 0, 255]);
  });

  it('says what it cannot read rather than producing nothing', async () => {
    const result = await bake('ffd8ffe000104a464946', recipe('from-hex', 'invert-image'));
    expect(result.error?.message).toMatch(/This is a JPEG/);

    const notAnImage = await bake('hello there, not a picture', recipe('invert-image'));
    expect(notAnImage.error?.message).toMatch(/not a picture in a format/);
  });
});

describe('Invert Image', () => {
  it('turns each channel into its complement', async () => {
    const { data } = await pixels(RGBA2X2, 'invert-image');
    expect(data.slice(0, 8)).toEqual([0, 255, 255, 255, 255, 0, 255, 128]);
  });

  it('leaves alpha alone unless told otherwise', async () => {
    const kept = await pixels(RGBA2X2, 'invert-image');
    const flipped = await pixels(RGBA2X2, ['invert-image', { 'Invert alpha too': true }]);
    expect(kept.data[7]).toBe(128);
    expect(flipped.data[7]).toBe(127);
  });
});

describe('Flip Image', () => {
  it('mirrors horizontally', async () => {
    const { data } = await pixels(RGBA2X2, ['flip-image', { Axis: 'Horizontal' }]);
    expect(data.slice(0, 8)).toEqual([0, 255, 0, 128, 255, 0, 0, 255]);
  });

  it('mirrors vertically', async () => {
    const { data } = await pixels(RGBA2X2, ['flip-image', { Axis: 'Vertical' }]);
    expect(data.slice(0, 4)).toEqual([0, 0, 255, 255]);
  });

  it('does both at once', async () => {
    const { data } = await pixels(RGBA2X2, ['flip-image', { Axis: 'Both' }]);
    expect(data.slice(0, 4)).toEqual([255, 255, 255, 0]);
  });
});

describe('Rotate Image', () => {
  it('turns a quarter clockwise and swaps the sides', async () => {
    const { width, height, data } = await pixels(RGB3X2, ['rotate-image', { Rotation: '90° clockwise' }]);
    expect([width, height]).toEqual([2, 3]);
    expect(data.slice(0, 3)).toEqual([100, 110, 120]);
  });

  it('turns half way round', async () => {
    const { width, height, data } = await pixels(RGB3X2, ['rotate-image', { Rotation: '180°' }]);
    expect([width, height]).toEqual([3, 2]);
    expect(data.slice(0, 3)).toEqual([160, 170, 180]);
  });

  it('four quarter turns come back to where they started', async () => {
    const once = await pixels(RGB3X2, ['rotate-image', { Rotation: '90° clockwise' }]);
    const round = await pixels(
      RGB3X2,
      ['rotate-image', { Rotation: '90° clockwise' }],
      ['rotate-image', { Rotation: '90° anticlockwise' }],
    );
    expect(round.width).toBe(3);
    expect(once.width).toBe(2);
    expect(round.data.slice(0, 3)).toEqual([10, 20, 30]);
  });
});

describe('Crop Image', () => {
  it('keeps only the rectangle asked for', async () => {
    const { width, height, data } = await pixels(GRADIENT8X8, [
      'crop-image',
      { X: 2, Y: 1, Width: 3, Height: 2 },
    ]);
    expect([width, height]).toEqual([3, 2]);
    expect(data.slice(0, 3)).toEqual([64, 32, 48]);
  });

  it('refuses a rectangle that does not fit', async () => {
    const result = await bake(
      GRADIENT8X8,
      recipe('from-hex', ['crop-image', { X: 4, Y: 4, Width: 8, Height: 8 }]),
    );
    expect(result.error?.message).toMatch(/does not fit/);
  });
});

describe('Resize Image', () => {
  it('changes the size in pixels', async () => {
    const { width, height } = await pixels(GRADIENT8X8, [
      'resize-image',
      { Width: 4, Height: 16 },
    ]);
    expect([width, height]).toEqual([4, 16]);
  });

  it('changes the size as a percentage', async () => {
    const { width, height } = await pixels(GRADIENT8X8, [
      'resize-image',
      { Width: 50, Height: 200, Unit: 'Percent' },
    ]);
    expect([width, height]).toEqual([4, 16]);
  });

  it('keeps the aspect ratio when asked', async () => {
    const { width, height } = await pixels(RGB3X2, [
      'resize-image',
      { Width: 30, Height: 30, 'Keep the aspect ratio': true },
    ]);
    expect([width, height]).toEqual([30, 20]);
  });

  it('samples exactly when smoothing is off', async () => {
    const { data } = await pixels(RGBA2X2, ['resize-image', { Width: 4, Height: 4, Smooth: false }]);
    expect(data.slice(0, 8)).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
  });
});

describe('Contain and Cover Image', () => {
  it('fits the whole picture inside and pads the rest', async () => {
    const { width, height, data } = await pixels(RGB3X2, [
      'contain-image',
      { Width: 6, Height: 6, Background: 'Black' },
    ]);
    expect([width, height]).toEqual([6, 6]);
    expect(data.slice(0, 4)).toEqual([0, 0, 0, 255]);
  });

  it('fills the frame and crops the overflow', async () => {
    const { width, height, data } = await pixels(RGB3X2, ['cover-image', { Width: 6, Height: 6 }]);
    expect([width, height]).toEqual([6, 6]);
    expect(data[3]).toBe(255); 
  });
});

describe('colour operations', () => {
  it('turns a picture grey by luminance', async () => {
    const { data } = await pixels(RGBA2X2, ['image-filter', { Filter: 'Greyscale' }]);
    expect(data.slice(0, 3)).toEqual([76, 76, 76]);
  });

  it('keeps a single channel', async () => {
    const { data } = await pixels(RGBA2X2, ['image-filter', { Filter: 'Green only' }]);
    expect(data.slice(0, 4)).toEqual([0, 0, 0, 255]);
    expect(data.slice(4, 8)).toEqual([0, 255, 0, 128]);
  });

  it('thresholds to black and white', async () => {
    const { data } = await pixels(GRADIENT8X8, [
      'image-filter',
      { Filter: 'Threshold', Threshold: 128 },
    ]);
    for (let i = 0; i < data.length; i += 4) {
      expect([0, 255]).toContain(data[i]);
    }
  });

  it('changes the opacity of everything', async () => {
    const { data } = await pixels(RGBA2X2, ['image-opacity', { 'Opacity %': 50 }]);
    expect(data[3]).toBe(128);
    expect(data[7]).toBe(64);
  });

  it('brightens and darkens', async () => {
    const brighter = await pixels(GRADIENT8X8, ['image-brightness-contrast', { Brightness: 50 }]);
    const darker = await pixels(GRADIENT8X8, ['image-brightness-contrast', { Brightness: -50 }]);
    expect(brighter.data[0]!).toBeGreaterThan(darker.data[0]!);
    expect(brighter.data[4]!).toBeGreaterThan(32);
  });

  it('stretches a flat picture to the full range', async () => {
    const { data } = await pixels(GRADIENT8X8, 'normalise-image');
    let low = 255;
    let high = 0;
    for (let i = 0; i < data.length; i += 4) {
      low = Math.min(low, data[i]!);
      high = Math.max(high, data[i]!);
    }
    expect(low).toBe(0);
    expect(high).toBe(255);
  });

  it('shifts the hue all the way round and comes back', async () => {
    const original = await pixels(RGB3X2, ['image-hsl', { 'Hue shift (degrees)': 0 }]);
    const shifted = await pixels(RGB3X2, ['image-hsl', { 'Hue shift (degrees)': 180 }]);
    const back = await pixels(
      RGB3X2,
      ['image-hsl', { 'Hue shift (degrees)': 180 }],
      ['image-hsl', { 'Hue shift (degrees)': 180 }],
    );
    expect(shifted.data).not.toEqual(original.data);
    for (let i = 0; i < back.data.length; i++) {
      expect(Math.abs(back.data[i]! - original.data[i]!)).toBeLessThanOrEqual(2);
    }
  });

  it('desaturates to grey', async () => {
    const { data } = await pixels(RGB3X2, ['image-hsl', { 'Saturation %': -100 }]);
    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
  });
});

describe('convolutions', () => {
  it('blurs, which flattens the difference between neighbours', async () => {
    const sharp = await pixels(GRADIENT8X8, ['image-filter', { Filter: 'Greyscale' }]);
    const blurred = await pixels(
      GRADIENT8X8,
      ['image-filter', { Filter: 'Greyscale' }],
      ['blur-image', { Amount: 2 }],
    );

    const spread = (data: number[]): number => {
      let low = 255;
      let high = 0;
      for (let i = 0; i < data.length; i += 4) {
        low = Math.min(low, data[i]!);
        high = Math.max(high, data[i]!);
      }
      return high - low;
    };
    expect(spread(blurred.data)).toBeLessThan(spread(sharp.data));
  });

  it('sharpens, which widens it again', async () => {
    const { width, height } = await pixels(GRADIENT8X8, ['sharpen-image', { Amount: 2 }]);
    expect([width, height]).toEqual([8, 8]);
  });

  it('dithers to nothing but black and white', async () => {
    const { data } = await pixels(GRADIENT8X8, 'dither-image');
    for (let i = 0; i < data.length; i += 4) {
      expect([0, 255]).toContain(data[i]);
      expect(data[i]).toBe(data[i + 1]);
    }
  });
});

describe('Convert Image Format', () => {
  it('writes a BMP that reads back the same', async () => {
    const asBmp = await run(GRADIENT8X8, 'from-hex', ['convert-image-format', { Format: 'BMP' }]);
    expect(asBmp.startsWith('BM')).toBe(true);

    const original = await pixels(GRADIENT8X8, ['convert-image-format', { Format: 'PNG' }]);
    const image = await decodeImage(asBytes(asBmp));
    expect(Array.from(image.data)).toEqual(original.data);
  });
});

describe('Split Colour Channels', () => {
  it('lays the three channels out side by side', async () => {
    const { width, height, data } = await pixels(RGB3X2, 'split-colour-channels');
    expect([width, height]).toEqual([9, 2]);
    expect(data.slice(0, 4)).toEqual([10, 10, 10, 255]);
    expect(data.slice(12, 16)).toEqual([20, 20, 20, 255]);
  });
});

describe('Generate Image', () => {
  it('draws bytes as greyscale pixels', async () => {
    const { width, height, data } = await pixels('00ff8040', 'generate-image');
    expect([width, height]).toEqual([2, 2]);
    expect(data.slice(0, 4)).toEqual([0, 0, 0, 255]);
    expect(data.slice(4, 8)).toEqual([255, 255, 255, 255]);
  });

  it('draws bytes as colours', async () => {
    const { data } = await pixels('ff0000' + '00ff00', ['generate-image', { Mode: 'RGB', Width: 2 }]);
    expect(data.slice(0, 4)).toEqual([255, 0, 0, 255]);
    expect(data.slice(4, 8)).toEqual([0, 255, 0, 255]);
  });

  it('draws one pixel per bit', async () => {
    const { width, data } = await pixels('a0', ['generate-image', { Mode: 'Bits', Width: 8 }]);
    expect(width).toBe(8);
    expect([data[0], data[4], data[8], data[12]]).toEqual([255, 0, 255, 0]);
  });

  it('refuses to draw nothing', async () => {
    const result = await bake('', recipe('generate-image'));
    expect(result.error?.message).toMatch(/nothing to draw/);
  });
});

describe('forensic operations', () => {
  it('writes out the pixel values', async () => {
    expect(await run(RGBA2X2, 'from-hex', 'extract-rgba')).toBe(
      '255,0,0,255,0,255,0,128,0,0,255,255,255,255,255,0',
    );
    expect(
      await run(RGBA2X2, 'from-hex', [
        'extract-rgba',
        { 'Include alpha': false, 'One pixel per line': true },
      ]),
    ).toBe('255,0,0\n0,255,0\n0,0,255\n255,255,255');
  });

  it('shows one bit plane as black and white', async () => {
    const { data } = await pixels(RGBA2X2, ['view-bit-plane', { Channel: 'Red', Bit: 7 }]);
    expect(data.slice(0, 4)).toEqual([255, 255, 255, 255]);
    expect(data.slice(4, 8)).toEqual([0, 0, 0, 255]);
  });

  it('collects the least significant bits into bytes', async () => {
    const out = await run(GRADIENT8X8, 'from-hex', [
      'extract-lsb',
      { Channels: 'RGB', 'Bits per channel': 1 },
    ]);
    expect(out.length).toBe(24); 
  });

  it('reads the channels in the order it is given', async () => {
    const rgb = await run(RGBA2X2, 'from-hex', ['extract-lsb', { Channels: 'RGB' }]);
    const bgr = await run(RGBA2X2, 'from-hex', ['extract-lsb', { Channels: 'BGR' }]);
    expect(rgb.charCodeAt(0)).toBe(0b10001000);
    expect(bgr.charCodeAt(0)).toBe(0b00101010);
  });

  it('refuses a channel list that names nothing', async () => {
    const result = await bake(
      GRADIENT8X8,
      recipe('from-hex', ['extract-lsb', { Channels: 'xyz' }]),
    );
    expect(result.error?.message).toMatch(/at least one channel/);
  });

  it('shuffles the palette the same way every time for a given seed', async () => {
    const first = await pixels(GRADIENT8X8, ['randomize-colour-palette', { Seed: 7 }]);
    const again = await pixels(GRADIENT8X8, ['randomize-colour-palette', { Seed: 7 }]);
    const other = await pixels(GRADIENT8X8, ['randomize-colour-palette', { Seed: 8 }]);

    expect(again.data).toEqual(first.data);
    expect(other.data).not.toEqual(first.data);
    const distinct = (data: number[]): number => {
      const seen = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
      }
      return seen.size;
    };
    const original = await pixels(GRADIENT8X8, ['randomize-colour-palette', { Seed: 0 }]);
    expect(distinct(first.data)).toBe(distinct(original.data));
  });
});
