import { OperationError } from '../types';
import { arg, type Operation } from './types';


const GEOHASH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';

interface Point {
  latitude: number;
  longitude: number;
}

function checkRange({ latitude, longitude }: Point): Point {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    throw new OperationError(`A latitude runs from -90 to 90; this one is ${latitude}.`);
  }
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new OperationError(`A longitude runs from -180 to 180; this one is ${longitude}.`);
  }
  return { latitude, longitude };
}


function encodeGeohash(point: Point, length: number): string {
  const latitude: [number, number] = [-90, 90];
  const longitude: [number, number] = [-180, 180];

  let hash = '';
  let bits = 0;
  let value = 0;
  let horizontal = true;

  while (hash.length < length) {
    const range = horizontal ? longitude : latitude;
    const target = horizontal ? point.longitude : point.latitude;
    const middle = (range[0] + range[1]) / 2;

    if (target > middle) {
      value = (value << 1) | 1;
      range[0] = middle;
    } else {
      value = value << 1;
      range[1] = middle;
    }
    horizontal = !horizontal;

    if (++bits === 5) {
      hash += GEOHASH_ALPHABET[value];
      bits = 0;
      value = 0;
    }
  }
  return hash;
}

function decodeGeohash(hash: string): Point {
  const latitude: [number, number] = [-90, 90];
  const longitude: [number, number] = [-180, 180];
  let horizontal = true;

  for (const character of hash.toLowerCase()) {
    const index = GEOHASH_ALPHABET.indexOf(character);
    if (index === -1) throw new OperationError(`'${character}' is not a geohash character.`);

    for (let bit = 4; bit >= 0; bit--) {
      const range = horizontal ? longitude : latitude;
      const middle = (range[0] + range[1]) / 2;
      if (((index >> bit) & 1) === 1) range[0] = middle;
      else range[1] = middle;
      horizontal = !horizontal;
    }
  }

  return {
    latitude: (latitude[0] + latitude[1]) / 2,
    longitude: (longitude[0] + longitude[1]) / 2,
  };
}


function parseDegrees(text: string): Point {
  const cleaned = text
    .trim()
    .replace(/[°º]/g, ' ')
    .replace(/['′]/g, ' ')
    .replace(/["″]/g, ' ')
    .replace(/,/g, ' ');

  const hemispheres = cleaned.match(/[NSEWnsew]/g) ?? [];
  const numbers = (cleaned.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

  if (numbers.length < 2) {
    throw new OperationError('That does not have two numbers in it, so it is not a position.');
  }

  const combine = (parts: number[]): number => {
    const sign = parts[0]! < 0 ? -1 : 1;
    let value = Math.abs(parts[0]!);
    if (parts.length > 1) value += parts[1]! / 60;
    if (parts.length > 2) value += parts[2]! / 3600;
    return sign * value;
  };

  const half = numbers.length / 2;
  if (!Number.isInteger(half) || half > 3) {
    throw new OperationError(
      `${numbers.length} numbers is not a position: expected two, four or six.`,
    );
  }

  let latitude = combine(numbers.slice(0, half));
  let longitude = combine(numbers.slice(half));

  const [first, second] = hemispheres;
  if (first === 'S' || first === 's') latitude = -Math.abs(latitude);
  if (first === 'N' || first === 'n') latitude = Math.abs(latitude);
  if (second === 'W' || second === 'w') longitude = -Math.abs(longitude);
  if (second === 'E' || second === 'e') longitude = Math.abs(longitude);

  return checkRange({ latitude, longitude });
}

function formatDms(value: number, isLatitude: boolean, precision: number): string {
  const hemisphere = value < 0 ? (isLatitude ? 'S' : 'W') : isLatitude ? 'N' : 'E';
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = Math.floor((absolute - degrees) * 60);
  const seconds = (absolute - degrees - minutes / 60) * 3600;
  return `${degrees}° ${minutes}' ${seconds.toFixed(precision)}" ${hemisphere}`;
}

function formatDdm(value: number, isLatitude: boolean, precision: number): string {
  const hemisphere = value < 0 ? (isLatitude ? 'S' : 'W') : isLatitude ? 'N' : 'E';
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  return `${degrees}° ${minutes.toFixed(precision)}' ${hemisphere}`;
}

const FORMATS = ['Decimal Degrees', 'Degrees Minutes Seconds', 'Degrees Decimal Minutes', 'Geohash'];

export const geoOperations: Operation[] = [
  {
    id: 'convert-coordinate-format',
    name: 'Convert co-ordinate format',
    category: 'Other',
    description:
      'Converts a position between decimal degrees, degrees and minutes, degrees minutes seconds, and geohash.',
    aliases: ['latitude longitude', 'gps', 'dms', 'geohash', 'coordinates'],
    args: [
      { name: 'Input format', type: 'option', value: 'Auto', options: ['Auto', ...FORMATS] },
      { name: 'Output format', type: 'option', value: 'Decimal Degrees', options: FORMATS },
      { name: 'Decimal places', type: 'number', value: 5, min: 0, max: 12 },
      {
        name: 'Geohash length',
        type: 'number',
        value: 9,
        min: 1,
        max: 12,
        hint: 'Each character narrows the box',
      },
    ],
    run: (input, args) => {
      const text = input.trim();
      if (text.length === 0) throw new OperationError('There is no position here.');

      const declared = String(arg(args, 'Input format', 'Auto'));
      const looksLikeGeohash = /^[0-9bcdefghjkmnpqrstuvwxyz]+$/i.test(text) && !/\d\s|\./.test(text);

      const point =
        declared === 'Geohash' || (declared === 'Auto' && looksLikeGeohash)
          ? checkRange(decodeGeohash(text))
          : parseDegrees(text);

      const places = Number(arg(args, 'Decimal places', 5));
      switch (String(arg(args, 'Output format', 'Decimal Degrees'))) {
        case 'Geohash':
          return encodeGeohash(point, Number(arg(args, 'Geohash length', 9)));
        case 'Degrees Minutes Seconds':
          return `${formatDms(point.latitude, true, places)}, ${formatDms(point.longitude, false, places)}`;
        case 'Degrees Decimal Minutes':
          return `${formatDdm(point.latitude, true, places)}, ${formatDdm(point.longitude, false, places)}`;
        default:
          return `${point.latitude.toFixed(places)}, ${point.longitude.toFixed(places)}`;
      }
    },
  },
];
