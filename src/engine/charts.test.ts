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

async function picture(input: string, ...entries: Entry[]) {
  const out = await run(input, ...entries);
  const image = await decodeImage(asBytes(out));
  const colours = new Set<number>();
  for (let i = 0; i < image.data.length; i += 4) {
    colours.add((image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!);
  }
  return { image, colours };
}

const SERIES = ['1,10', '2,20', '3,15', '4,30', '5,25'].join('\n');

const RED_2X2 =
  '89504e470d0a1a0a0000000d494844520000000200000002080600000072b60d240000001849' +
  '444154789c63f8cfc0f09fe13f43030303c37f1060000043d308794a4ae4460000000049454e' +
  '44ae426082';

describe('Hex Density chart', () => {
  it('draws a 256 by 256 grid, scaled', async () => {
    const { image } = await picture('the quick brown fox jumps over the lazy dog', [
      'hex-density-chart',
      { Scale: 1 },
    ]);
    expect([image.width, image.height]).toEqual([256, 256]);

    const scaled = await picture('the quick brown fox', ['hex-density-chart', { Scale: 3 }]);
    expect([scaled.image.width, scaled.image.height]).toEqual([768, 768]);
  }, 60000);

  it('puts a bright pixel where a byte pair actually occurs', async () => {
    const { image } = await picture('ABABABAB', ['hex-density-chart', { Scale: 1 }]);
    const at = (0x42 * image.width + 0x41) * 4;
    expect(image.data[at]! + image.data[at + 1]! + image.data[at + 2]!).toBeGreaterThan(60);

    const empty = (0x10 * image.width + 0x10) * 4;
    expect(image.data[empty]! + image.data[empty + 1]! + image.data[empty + 2]!).toBeLessThan(60);
  }, 60000);

  it('refuses input with no pair in it', async () => {
    const result = await bake('x', recipe('hex-density-chart'));
    expect(result.error?.message).toMatch(/Two bytes at least/);
  });
});

describe('Scatter chart', () => {
  it('draws a picture of the size asked for', async () => {
    const { image } = await picture(SERIES, ['scatter-chart', { Width: 320, Height: 240 }]);
    expect([image.width, image.height]).toEqual([320, 240]);
  }, 60000);

  it('draws something other than an empty frame', async () => {
    const plotted = await picture(SERIES, 'scatter-chart');
    const axesOnly = await picture('0,0', 'scatter-chart');
    expect(plotted.colours.size).toBeGreaterThan(2);
    expect(Array.from(plotted.image.data)).not.toEqual(Array.from(axesOnly.image.data));
  }, 60000);

  it('follows the theme', async () => {
    const dark = await picture(SERIES, ['scatter-chart', { Theme: 'Dark' }]);
    const light = await picture(SERIES, ['scatter-chart', { Theme: 'Light' }]);
    expect(dark.image.data[0]).toBeLessThan(60);
    expect(light.image.data[0]).toBeGreaterThan(200);
  }, 60000);

  it('plots points of extreme and identical large values without stalling', async () => {
    const extreme = ['1e300,-1e300', '-1e300,1e300', '9007199254740993,9007199254740993'].join('\n');
    const { image } = await picture(extreme, 'scatter-chart');
    expect(image.width).toBe(640);
  }, 60000);

  it('refuses rows with only one number', async () => {
    const result = await bake('1\n2\n3', recipe('scatter-chart'));
    expect(result.error?.message).toMatch(/two numbers on every row/);
  });

  it('says so when there are no numbers at all', async () => {
    const result = await bake('alpha,beta\ngamma,delta', recipe('scatter-chart'));
    expect(result.error?.message).toMatch(/No numbers were found/);
  });
});

describe('Series chart', () => {
  it('draws a line per column', async () => {
    const twoSeries = ['1,10,5', '2,20,15', '3,15,25', '4,30,10'].join('\n');
    const { colours } = await picture(twoSeries, 'series-chart');
    expect(colours.size).toBeGreaterThan(4);
  }, 60000);

  it('reads a header row when told to', async () => {
    const withHeader = ['time,value', '1,10', '2,20'].join('\n');
    const { image } = await picture(withHeader, ['series-chart', { 'First row is a header': true }]);
    expect(image.width).toBe(640);
  }, 60000);

  it('draws a flat series without dividing by zero', async () => {
    const flat = ['5', '5', '5', '5'].join('\n');
    const { image } = await picture(flat, 'series-chart');
    expect(image.width).toBe(640);
  }, 60000);

  it('draws a single number too large to step by one without stalling', async () => {
    const { image } = await picture('546865207175696321', 'series-chart');
    expect(image.width).toBe(640);
  }, 60000);

  it('draws values of wildly different magnitude without stalling', async () => {
    const extreme = ['1', '1e300', '-1e300', '5'].join('\n');
    const { image } = await picture(extreme, 'series-chart');
    expect(image.width).toBe(640);
  }, 60000);
});

describe('Heatmap chart', () => {
  it('bins the points into cells', async () => {
    const scattered = Array.from(
      { length: 200 },
      (_, i) => `${i % 20},${Math.floor(i / 20)}`,
    ).join('\n');
    const { image, colours } = await picture(scattered, [
      'heatmap-chart',
      { Columns: 10, Rows: 10 },
    ]);
    expect([image.width, image.height]).toEqual([640, 400]);
    expect(colours.size).toBeGreaterThan(2);
  }, 60000);

  it('bins points that all share one very large value', async () => {
    const same = ['9007199254740993,9007199254740993', '9007199254740993,9007199254740993'].join('\n');
    const { image } = await picture(same, 'heatmap-chart');
    expect(image.width).toBe(640);
  }, 60000);

  it('refuses rows with only one number', async () => {
    const result = await bake('1\n2\n3', recipe('heatmap-chart'));
    expect(result.error?.message).toMatch(/two numbers on every row/);
  });
});

describe('Add Text To Image', () => {
  it('changes the pixels it draws on', async () => {
    const bigger = await run(RED_2X2, 'from-hex', [
      'resize-image',
      { Width: 120, Height: 40, Smooth: false },
    ]);
    const before = await decodeImage(asBytes(bigger));

    const labelled = await run(bigger, [
      'add-text-to-image',
      { Text: 'OWASP', Size: 2, Position: 'Top left', Colour: 'Black' },
    ]);
    const after = await decodeImage(asBytes(labelled));

    expect(after.width).toBe(before.width);
    expect(Array.from(after.data)).not.toEqual(Array.from(before.data));

    let black = 0;
    for (let i = 0; i < after.data.length; i += 4) {
      if (after.data[i] === 0 && after.data[i + 1] === 0 && after.data[i + 2] === 0) black++;
    }
    expect(black).toBeGreaterThan(20);
  }, 60000);

  it('puts the text where it is told', async () => {
    const bigger = await run(RED_2X2, 'from-hex', [
      'resize-image',
      { Width: 200, Height: 60, Smooth: false },
    ]);
    const top = await decodeImage(
      asBytes(
        await run(bigger, [
          'add-text-to-image',
          { Text: 'AB', Position: 'Top left', Colour: 'Black' },
        ]),
      ),
    );
    const bottom = await decodeImage(
      asBytes(
        await run(bigger, [
          'add-text-to-image',
          { Text: 'AB', Position: 'Bottom left', Colour: 'Black' },
        ]),
      ),
    );

    const blackRows = (image: {
      width: number;
      height: number;
      data: Uint8ClampedArray;
    }): number[] => {
      const rows: number[] = [];
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const at = (y * image.width + x) * 4;
          if (image.data[at] === 0 && image.data[at + 1] === 0) {
            rows.push(y);
            break;
          }
        }
      }
      return rows;
    };

    expect(Math.min(...blackRows(top))).toBeLessThan(20);
    expect(Math.max(...blackRows(bottom))).toBeGreaterThan(40);
  }, 60000);

  it('refuses to add nothing', async () => {
    const result = await bake(RED_2X2, recipe('from-hex', 'add-text-to-image'));
    expect(result.error?.message).toMatch(/no text to add/);
  });
});
