import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { encodePng, makeImage, setPixel, type Image } from '../core/image';
import { drawText, textWidth } from '../core/font';
import { arg, type Operation } from './types';


interface Palette {
  background: number[];
  axis: number[];
  text: number[];
  point: number[];
}

const DARK: Palette = {
  background: [12, 12, 16, 255],
  axis: [80, 80, 96, 255],
  text: [200, 200, 210, 255],
  point: [140, 110, 230, 255],
};

const LIGHT: Palette = {
  background: [255, 255, 255, 255],
  axis: [140, 140, 150, 255],
  text: [40, 40, 50, 255],
  point: [90, 60, 190, 255],
};

function fill(image: Image, colour: number[]): void {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) setPixel(image, x, y, colour);
  }
}

function clipToImage(
  image: Image,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number, number] | null {
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    return null;
  }
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x <= image.width - 1 && y <= image.height - 1;
  if (inside(x0, y0) && inside(x1, y1)) return [x0, y0, x1, y1];

  const dx = x1 - x0;
  const dy = y1 - y0;
  let enter = 0;
  let leave = 1;
  const edges: [number, number][] = [
    [-dx, x0],
    [dx, image.width - 1 - x0],
    [-dy, y0],
    [dy, image.height - 1 - y0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > leave) return null;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return null;
      if (t < leave) leave = t;
    }
  }
  return [x0 + enter * dx, y0 + enter * dy, x0 + leave * dx, y0 + leave * dy];
}

function line(image: Image, x0: number, y0: number, x1: number, y1: number, colour: number[]): void {
  const clipped = clipToImage(image, x0, y0, x1, y1);
  if (!clipped) return;

  let x = Math.round(clipped[0]);
  let y = Math.round(clipped[1]);
  const endX = Math.round(clipped[2]);
  const endY = Math.round(clipped[3]);

  const dx = Math.abs(endX - x);
  const dy = -Math.abs(endY - y);
  const stepX = x < endX ? 1 : -1;
  const stepY = y < endY ? 1 : -1;
  let error = dx + dy;

  for (;;) {
    if (x >= 0 && y >= 0 && x < image.width && y < image.height) setPixel(image, x, y, colour);
    if (x === endX && y === endY) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
  }
}

function dot(image: Image, x: number, y: number, radius: number, colour: number[]): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
      setPixel(image, px, py, colour);
    }
  }
}

function ramp(value: number, palette: Palette): number[] {
  const t = Math.min(1, Math.max(0, value));
  const from = palette.background;
  const to = palette.point;
  const hot = [255, 210, 120, 255];

  if (t < 0.5) {
    const k = t * 2;
    return [0, 1, 2, 3].map((i) => from[i]! + (to[i]! - from[i]!) * k);
  }
  const k = (t - 0.5) * 2;
  return [0, 1, 2, 3].map((i) => to[i]! + (hot[i]! - to[i]!) * k);
}


interface Row {
  values: number[];
  label?: string;
}

function readRows(input: string, delimiter: string, hasHeader: boolean): { rows: Row[]; headers: string[] } {
  const separator = { Comma: ',', Tab: '\t', Space: ' ', Semicolon: ';' }[delimiter] ?? ',';
  const lines = input.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new OperationError('There is no data here.');

  let headers: string[] = [];
  let start = 0;
  if (hasHeader) {
    headers = lines[0]!.split(separator).map((h) => h.trim());
    start = 1;
  }

  const rows: Row[] = [];
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i]!.split(separator).map((p) => p.trim());
    const values: number[] = [];
    let label: string | undefined;
    for (const part of parts) {
      const value = Number(part);
      if (Number.isFinite(value) && part.length > 0) values.push(value);
      else if (label === undefined) label = part;
    }
    if (values.length > 0) rows.push({ values, label });
  }

  if (rows.length === 0) {
    throw new OperationError('No numbers were found. Check the delimiter, and whether there is a header row.');
  }
  return { rows, headers };
}

function extent(values: number[]): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (low === high) {
    const pad = low - 1 !== low ? 1 : Math.abs(low) * 0.05;
    return [low - pad, high + pad];
  }
  return [low, high];
}

const MARGIN = { left: 46, right: 12, top: 14, bottom: 22 };

interface Frame {
  image: Image;
  palette: Palette;
  toX: (value: number) => number;
  toY: (value: number) => number;
}

function drawAxes(
  width: number,
  height: number,
  xRange: [number, number],
  yRange: [number, number],
  palette: Palette,
  title: string,
): Frame {
  const image = makeImage(width, height);
  fill(image, palette.background);

  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;

  const toX = (value: number): number =>
    MARGIN.left + ((value - xRange[0]) / (xRange[1] - xRange[0])) * plotWidth;
  const toY = (value: number): number =>
    height - MARGIN.bottom - ((value - yRange[0]) / (yRange[1] - yRange[0])) * plotHeight;

  line(image, MARGIN.left, MARGIN.top, MARGIN.left, height - MARGIN.bottom, palette.axis);
  line(
    image,
    MARGIN.left,
    height - MARGIN.bottom,
    width - MARGIN.right,
    height - MARGIN.bottom,
    palette.axis,
  );

  const label = (value: number): string => {
    const absolute = Math.abs(value);
    if (absolute >= 100000 || (absolute > 0 && absolute < 0.01)) return value.toExponential(1);
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  };

  for (let i = 0; i <= 4; i++) {
    const yValue = yRange[0] + ((yRange[1] - yRange[0]) * i) / 4;
    const y = Math.round(toY(yValue));
    line(image, MARGIN.left - 3, y, MARGIN.left, y, palette.axis);
    drawText(image, label(yValue), 2, y - 3, palette.text);

    const xValue = xRange[0] + ((xRange[1] - xRange[0]) * i) / 4;
    const x = Math.round(toX(xValue));
    line(image, x, height - MARGIN.bottom, x, height - MARGIN.bottom + 3, palette.axis);
    const text = label(xValue);
    drawText(image, text, x - textWidth(text) / 2, height - MARGIN.bottom + 6, palette.text);
  }

  if (title.length > 0) drawText(image, title, MARGIN.left, 3, palette.text);
  return { image, palette, toX, toY };
}

const SIZE_ARGS = [
  { name: 'Width', type: 'number' as const, value: 640, min: 120, max: 4000 },
  { name: 'Height', type: 'number' as const, value: 400, min: 120, max: 4000 },
  { name: 'Theme', type: 'option' as const, value: 'Dark', options: ['Dark', 'Light'] },
];

const DATA_ARGS = [
  {
    name: 'Delimiter',
    type: 'option' as const,
    value: 'Comma',
    options: ['Comma', 'Tab', 'Space', 'Semicolon'],
  },
  { name: 'First row is a header', type: 'boolean' as const, value: false },
];

function paletteFrom(args: Parameters<Operation['run']>[1]): Palette {
  return arg(args, 'Theme', 'Dark') === 'Light' ? LIGHT : DARK;
}

export const chartOperations: Operation[] = [
  {
    id: 'hex-density-chart',
    name: 'Hex Density chart',
    category: 'Multimedia',
    description:
      'Plots each byte against the one after it, which shows the structure of a file at a glance.',
    aliases: ['byte density', 'digraph plot', 'file fingerprint', 'entropy picture'],
    budgetMs: 30000,
    args: [
      { name: 'Scale', type: 'number', value: 2, min: 1, max: 8 },
      { name: 'Theme', type: 'option', value: 'Dark', options: ['Dark', 'Light'] },
      {
        name: 'Contrast',
        type: 'option',
        value: 'Logarithmic',
        options: ['Logarithmic', 'Linear'],
        hint: 'Logarithmic makes rare pairs visible next to common ones',
      },
    ],
    run: async (input, args) => {
      const bytes = asBytes(input);
      if (bytes.length < 2) throw new OperationError('Two bytes at least are needed to make a pair.');

      const counts = new Uint32Array(256 * 256);
      let peak = 0;
      for (let i = 0; i + 1 < bytes.length; i++) {
        const at = bytes[i]! * 256 + bytes[i + 1]!;
        counts[at] = counts[at]! + 1;
        if (counts[at]! > peak) peak = counts[at]!;
      }

      const palette = paletteFrom(args);
      const scale = Math.min(8, Math.max(1, Number(arg(args, 'Scale', 2))));
      const logarithmic = arg(args, 'Contrast', 'Logarithmic') === 'Logarithmic';
      const image = makeImage(256 * scale, 256 * scale);

      const top = logarithmic ? Math.log(peak + 1) : peak;
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const count = counts[x * 256 + y]!;
          const value = count === 0 ? 0 : (logarithmic ? Math.log(count + 1) : count) / top;
          const colour = ramp(value, palette);
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              setPixel(image, x * scale + dx, y * scale + dy, colour);
            }
          }
        }
      }
      return bytesToLatin1(await encodePng(image));
    },
  },
  {
    id: 'scatter-chart',
    name: 'Scatter chart',
    category: 'Multimedia',
    description: 'Plots x and y pairs as points.',
    aliases: ['scatter plot', 'xy chart', 'points'],
    budgetMs: 30000,
    args: [...DATA_ARGS, ...SIZE_ARGS, { name: 'Point size', type: 'number', value: 2, min: 1, max: 10 }],
    run: async (input, args) => {
      const { rows, headers } = readRows(
        input,
        String(arg(args, 'Delimiter', 'Comma')),
        arg(args, 'First row is a header', false),
      );

      const xs = rows.map((row) => row.values[0]!);
      const ys = rows.map((row) => row.values[1] ?? 0);
      if (rows.some((row) => row.values.length < 2)) {
        throw new OperationError('A scatter chart needs two numbers on every row.');
      }

      const palette = paletteFrom(args);
      const title = headers.length >= 2 ? `${headers[0]} / ${headers[1]}` : '';
      const frame = drawAxes(
        Number(arg(args, 'Width', 640)),
        Number(arg(args, 'Height', 400)),
        extent(xs),
        extent(ys),
        palette,
        title,
      );

      const radius = Number(arg(args, 'Point size', 2));
      for (let i = 0; i < rows.length; i++) {
        dot(frame.image, frame.toX(xs[i]!), frame.toY(ys[i]!), radius, palette.point);
      }
      return bytesToLatin1(await encodePng(frame.image));
    },
  },
  {
    id: 'series-chart',
    name: 'Series chart',
    category: 'Multimedia',
    description: 'Draws one or more columns of numbers as lines over a shared x axis.',
    aliases: ['line chart', 'time series', 'plot'],
    budgetMs: 30000,
    args: [...DATA_ARGS, ...SIZE_ARGS],
    run: async (input, args) => {
      const { rows, headers } = readRows(
        input,
        String(arg(args, 'Delimiter', 'Comma')),
        arg(args, 'First row is a header', false),
      );

      const seriesCount = Math.max(...rows.map((row) => row.values.length));
      const everything = rows.flatMap((row) => row.values);
      const palette = paletteFrom(args);

      const frame = drawAxes(
        Number(arg(args, 'Width', 640)),
        Number(arg(args, 'Height', 400)),
        [0, Math.max(1, rows.length - 1)],
        extent(everything),
        palette,
        headers.join(' · '),
      );

      const colourFor = (index: number): number[] => {
        const hue = (index * 137.5) % 360;
        const c = 200;
        const x = Math.round(c * (1 - Math.abs(((hue / 60) % 2) - 1)));
        const table: number[][] = [
          [c, x, 0],
          [x, c, 0],
          [0, c, x],
          [0, x, c],
          [x, 0, c],
          [c, 0, x],
        ];
        const rgb = table[Math.floor(hue / 60) % 6]!;
        return [rgb[0]! + 40, rgb[1]! + 40, rgb[2]! + 40, 255];
      };

      for (let series = 0; series < seriesCount; series++) {
        const colour = seriesCount === 1 ? palette.point : colourFor(series);
        let previous: [number, number] | null = null;
        for (let i = 0; i < rows.length; i++) {
          const value = rows[i]!.values[series];
          if (value === undefined) {
            previous = null;
            continue;
          }
          const point: [number, number] = [frame.toX(i), frame.toY(value)];
          if (previous) line(frame.image, previous[0], previous[1], point[0], point[1], colour);
          previous = point;
        }
      }
      return bytesToLatin1(await encodePng(frame.image));
    },
  },
  {
    id: 'heatmap-chart',
    name: 'Heatmap chart',
    category: 'Multimedia',
    description: 'Bins x and y pairs into a grid and colours each cell by how many landed in it.',
    aliases: ['density plot', '2d histogram', 'heat map'],
    budgetMs: 30000,
    args: [
      ...DATA_ARGS,
      ...SIZE_ARGS,
      { name: 'Columns', type: 'number', value: 32, min: 2, max: 256 },
      { name: 'Rows', type: 'number', value: 24, min: 2, max: 256 },
    ],
    run: async (input, args) => {
      const { rows, headers } = readRows(
        input,
        String(arg(args, 'Delimiter', 'Comma')),
        arg(args, 'First row is a header', false),
      );
      if (rows.some((row) => row.values.length < 2)) {
        throw new OperationError('A heatmap needs two numbers on every row.');
      }

      const xs = rows.map((row) => row.values[0]!);
      const ys = rows.map((row) => row.values[1]!);
      const xRange = extent(xs);
      const yRange = extent(ys);

      const columns = Number(arg(args, 'Columns', 32));
      const rowCount = Number(arg(args, 'Rows', 24));
      const bins = new Uint32Array(columns * rowCount);
      let peak = 0;

      for (let i = 0; i < rows.length; i++) {
        const cx = Math.min(
          columns - 1,
          Math.floor(((xs[i]! - xRange[0]) / (xRange[1] - xRange[0])) * columns),
        );
        const cy = Math.min(
          rowCount - 1,
          Math.floor(((ys[i]! - yRange[0]) / (yRange[1] - yRange[0])) * rowCount),
        );
        const at = cy * columns + cx;
        bins[at] = bins[at]! + 1;
        if (bins[at]! > peak) peak = bins[at]!;
      }

      const palette = paletteFrom(args);
      const frame = drawAxes(
        Number(arg(args, 'Width', 640)),
        Number(arg(args, 'Height', 400)),
        xRange,
        yRange,
        palette,
        headers.join(' / '),
      );

      for (let cy = 0; cy < rowCount; cy++) {
        for (let cx = 0; cx < columns; cx++) {
          const count = bins[cy * columns + cx]!;
          if (count === 0) continue;
          const colour = ramp(count / peak, palette);

          const left = frame.toX(xRange[0] + ((xRange[1] - xRange[0]) * cx) / columns);
          const right = frame.toX(xRange[0] + ((xRange[1] - xRange[0]) * (cx + 1)) / columns);
          const bottom = frame.toY(yRange[0] + ((yRange[1] - yRange[0]) * cy) / rowCount);
          const top = frame.toY(yRange[0] + ((yRange[1] - yRange[0]) * (cy + 1)) / rowCount);

          const yStart = Math.max(0, Math.ceil(top));
          const yEnd = Math.min(frame.image.height, bottom);
          const xStart = Math.max(0, Math.ceil(left));
          const xEnd = Math.min(frame.image.width, right);
          for (let y = yStart; y < yEnd; y++) {
            for (let x = xStart; x < xEnd; x++) {
              if (x < 0 || y < 0 || x >= frame.image.width || y >= frame.image.height) continue;
              setPixel(frame.image, x, y, colour);
            }
          }
        }
      }
      return bytesToLatin1(await encodePng(frame.image));
    },
  },
];
