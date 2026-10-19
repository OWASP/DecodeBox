import { OperationError } from '../types';
import { arg, type Operation } from './types';


const DISTANCE: Record<string, number> = {
  'Nanometres (nm)': 1e-9,
  'Micrometres (µm)': 1e-6,
  'Millimetres (mm)': 1e-3,
  'Centimetres (cm)': 1e-2,
  'Metres (m)': 1,
  'Kilometers (km)': 1e3,
  'Thou (th)': 0.0000254,
  'Inches (in)': 0.0254,
  'Feet (ft)': 0.3048,
  'Yards (yd)': 0.9144,
  'Chains (ch)': 20.1168,
  'Furlongs (fur)': 201.168,
  'Miles (mi)': 1609.344,
  'Leagues (lea)': 4828.032,
  'Fathoms (ftm)': 1.853184,
  Cables: 185.3184,
  'Nautical miles': 1853.184,
  'Cars (4m)': 4,
  'Buses (8.4m)': 8.4,
  'American football fields (91m)': 91,
  'Football pitches (105m)': 105,
  'Earth-to-Moons': 380000000,
  "Earth's equators": 40075016.686,
  'Astronomical units (au)': 149597870700,
  'Light-years (ly)': 9460730472580800,
  'Parsecs (pc)': 3.0856776e16,
};

const AREA: Record<string, number> = {
  'Square metre (sq m)': 1,
  'Square kilometre (sq km)': 1e6,
  'Centiare (ca)': 1,
  'Deciare (da)': 10,
  'Are (a)': 100,
  'Decare (daa)': 1e3,
  'Hectare (ha)': 1e4,
  'Square inch (sq in)': 0.00064516,
  'Square foot (sq ft)': 0.09290304,
  'Square yard (sq yd)': 0.83612736,
  'Square mile (sq mi)': 2589988.110336,
  'Perch (sq per)': 42.21,
  'Rood (ro)': 1011,
  'International acre (ac)': 4046.8564224,
  'US survey acre (ac)': 4046.87261,
  'US survey square mile (sq mi)': 2589998.470305239,
  'US survey township': 93239944.9309886,
  'Yoctobarn (yb)': 1e-52,
  'Zeptobarn (zb)': 1e-49,
  'Attobarn (ab)': 1e-46,
  'Femtobarn (fb)': 1e-43,
  'Picobarn (pb)': 1e-40,
  'Nanobarn (nb)': 1e-37,
  'Microbarn (μb)': 1e-34,
  'Millibarn (mb)': 1e-31,
  'Barn (b)': 1e-28,
  'Kilobarn (kb)': 1e-25,
  'Megabarn (Mb)': 1e-22,
  'Planck area': 2.6e-70,
  Shed: 1e-52,
  Outhouse: 1e-34,
  'Washington D.C.': 176119191.502848,
  'Isle of Wight': 380000000,
  Wales: 20779000000,
  Texas: 696241000000,
};

const MASS: Record<string, number> = {
  'Yoctogram (yg)': 1e-24,
  'Zeptogram (zg)': 1e-21,
  'Attogram (ag)': 1e-18,
  'Femtogram (fg)': 1e-15,
  'Picogram (pg)': 1e-12,
  'Nanogram (ng)': 1e-9,
  'Microgram (μg)': 1e-6,
  'Milligram (mg)': 1e-3,
  'Centigram (cg)': 1e-2,
  'Decigram (dg)': 1e-1,
  'Gram (g)': 1,
  'Decagram (dag)': 10,
  'Hectogram (hg)': 100,
  'Kilogram (kg)': 1000,
  'Megagram (Mg)': 1e6,
  'Tonne (t)': 1e6,
  'Gigagram (Gg)': 1e9,
  'Teragram (Tg)': 1e12,
  'Petagram (Pg)': 1e15,
  'Exagram (Eg)': 1e18,
  'Zettagram (Zg)': 1e21,
  'Yottagram (Yg)': 1e24,
  'Grain (gr)': 64.79891e-3,
  'Dram (dr)': 1.7718451953125,
  'Ounce (oz)': 28.349523125,
  'Pound (lb)': 453.59237,
  Nail: 3175.14659,
  'Stone (st)': 6.35029318e3,
  'Quarter (qr)': 12700.58636,
  Tod: 12700.58636,
  'US hundredweight (cwt)': 45.359237e3,
  'Imperial hundredweight (cwt)': 50.80234544e3,
  'US ton (t)': 907.18474e3,
  'Imperial ton (t)': 1016.0469088e3,
  'Pennyweight (dwt)': 1.55517384,
  'Troy dram (dr t)': 3.8879346,
  'Troy ounce (oz t)': 31.1034768,
  'Troy pound (lb t)': 373.2417216,
  Mark: 248.8278144,
  Wey: 76.5e3,
  'Wool wey': 101.7e3,
  'Suffolk wey': 161.5e3,
  'Wool sack': 153000,
  'Coal sack': 50.80234544e3,
  Load: 918000,
  Last: 1836000,
  'Flax or feather last': 770e3,
  'Gunpowder last': 1090e3,
  Picul: 60.478982e3,
  'Rice last': 1200e3,
  'Big Ben (14 tonnes)': 14e6,
  'Blue whale (180 tonnes)': 180e6,
  'International Space Station (417 tonnes)': 417e6,
  'Space Shuttle (2,041 tonnes)': 2041e6,
  'RMS Titanic (52,000 tonnes)': 52000e6,
  'Great Pyramid of Giza (6,000,000 tonnes)': 6e12,
  "Earth's oceans (1.4 yottagrams)": 1.4e24,
  'A teaspoon of neutron star (5,500 million tonnes)': 5.5e15,
  'Lunar mass (ML)': 7.342e25,
  'Earth mass (M⊕)': 5.97219e27,
  'Jupiter mass (MJ)': 1.8981411476999997e30,
  'Solar mass (M☉)': 1.98855e33,
  'Sagittarius A* (7.5 x 10^36 kgs-ish)': 7.5e39,
  'Milky Way galaxy (1.2 x 10^42 kgs)': 1.2e45,
  'The observable universe (1.45 x 10^53 kgs)': 1.45e56,
};

const SPEED: Record<string, number> = {
  'Metres per second (m/s)': 1,
  'Kilometres per hour (km/h)': 0.2778,
  'Miles per hour (mph)': 0.44704,
  'Knots (kn)': 0.5144,
  'Human hair growth rate': 4.8e-9,
  'Bamboo growth rate': 1.4e-5,
  "World's fastest snail": 0.00275,
  "Usain Bolt's top speed": 12.42,
  'Jet airliner cruising speed': 250,
  Concorde: 603,
  'SR-71 Blackbird': 981,
  'Space Shuttle': 1400,
  'International Space Station': 7700,
  'Sound in standard atmosphere': 340.3,
  'Sound in water': 1500,
  'Lunar escape velocity': 2375,
  'Earth escape velocity': 11200,
  "Earth's solar orbit": 29800,
  "Solar system's Milky Way orbit": 200000,
  'Milky Way relative to the cosmic microwave background': 552000,
  'Solar escape velocity': 617700,
  'Neutron star escape velocity (0.3c)': 100000000,
  'Light in a diamond (0.4136c)': 124000000,
  'Signal in an optical fibre (0.667c)': 200000000,
  'Light (c)': 299792458,
};

const DATA: Record<string, number> = {
  'Bits (b)': 1,
  Nibbles: 4,
  Octets: 8,
  'Bytes (B)': 8,
  'Kibibits (Kib)': 1024,
  'Mebibits (Mib)': 1048576,
  'Gibibits (Gib)': 1073741824,
  'Tebibits (Tib)': 1099511627776,
  'Pebibits (Pib)': 1125899906842624,
  'Exbibits (Eib)': 1152921504606846976,
  'Zebibits (Zib)': 1180591620717411303424,
  'Yobibits (Yib)': 1208925819614629174706176,
  Decabits: 10,
  Hectobits: 100,
  'Kilobits (Kb)': 1e3,
  'Megabits (Mb)': 1e6,
  'Gigabits (Gb)': 1e9,
  'Terabits (Tb)': 1e12,
  'Petabits (Pb)': 1e15,
  'Exabits (Eb)': 1e18,
  'Zettabits (Zb)': 1e21,
  'Yottabits (Yb)': 1e24,
  'Kibibytes (KiB)': 8192,
  'Mebibytes (MiB)': 8388608,
  'Gibibytes (GiB)': 8589934592,
  'Tebibytes (TiB)': 8796093022208,
  'Pebibytes (PiB)': 9007199254740992,
  'Exbibytes (EiB)': 9223372036854775808,
  'Zebibytes (ZiB)': 9444732965739290427392,
  'Yobibytes (YiB)': 9671406556917033397649408,
  'Kilobytes (KB)': 8e3,
  'Megabytes (MB)': 8e6,
  'Gigabytes (GB)': 8e9,
  'Terabytes (TB)': 8e12,
  'Petabytes (PB)': 8e15,
  'Exabytes (EB)': 8e18,
  'Zettabytes (ZB)': 8e21,
  'Yottabytes (YB)': 8e24,
};

function convert(table: Record<string, number>, input: string, from: string, to: string): string {
  const value = Number(input.trim());
  if (input.trim() === '' || Number.isNaN(value)) {
    throw new OperationError('Input must be a number.');
  }
  const fromFactor = table[from];
  const toFactor = table[to];
  if (fromFactor === undefined || toFactor === undefined) {
    throw new OperationError('Unknown unit.');
  }
  return String((value * fromFactor) / toFactor);
}

function unitArgs(table: Record<string, number>, from: string, to: string) {
  const options = Object.keys(table);
  return [
    { name: 'Input units', type: 'option' as const, value: from, options },
    { name: 'Output units', type: 'option' as const, value: to, options },
  ];
}


const EARTH_RADIUS_METRES = 6371000;

const TO_RADIANS = Math.PI / 180;


function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
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

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [hue / 6, saturation, lightness];
}

export const unitOperations: Operation[] = [
  {
    id: 'convert-distance',
    name: 'Convert distance',
    category: 'Utils',
    description: 'Converts a length between metric, imperial and less usual units.',
    aliases: ['length', 'metres', 'feet', 'miles'],
    args: unitArgs(DISTANCE, 'Metres (m)', 'Kilometers (km)'),
    run: (input, args) =>
      convert(
        DISTANCE,
        input,
        String(arg(args, 'Input units', 'Metres (m)')),
        String(arg(args, 'Output units', 'Kilometers (km)')),
      ),
  },
  {
    id: 'convert-area',
    name: 'Convert area',
    category: 'Utils',
    description: 'Converts an area between metric, imperial and scientific units.',
    aliases: ['square metres', 'acres', 'hectares'],
    args: unitArgs(AREA, 'Square metre (sq m)', 'Square kilometre (sq km)'),
    run: (input, args) =>
      convert(
        AREA,
        input,
        String(arg(args, 'Input units', 'Square metre (sq m)')),
        String(arg(args, 'Output units', 'Square kilometre (sq km)')),
      ),
  },
  {
    id: 'convert-mass',
    name: 'Convert mass',
    category: 'Utils',
    description: 'Converts a mass between metric, imperial, troy and astronomical units.',
    aliases: ['weight', 'grams', 'pounds', 'kilograms'],
    args: unitArgs(MASS, 'Kilogram (kg)', 'Pound (lb)'),
    run: (input, args) =>
      convert(
        MASS,
        input,
        String(arg(args, 'Input units', 'Kilogram (kg)')),
        String(arg(args, 'Output units', 'Pound (lb)')),
      ),
  },
  {
    id: 'convert-speed',
    name: 'Convert speed',
    category: 'Utils',
    description: 'Converts a speed between metric, imperial and scientific units.',
    aliases: ['velocity', 'mph', 'knots', 'km/h'],
    args: unitArgs(SPEED, 'Metres per second (m/s)', 'Kilometres per hour (km/h)'),
    run: (input, args) =>
      convert(
        SPEED,
        input,
        String(arg(args, 'Input units', 'Metres per second (m/s)')),
        String(arg(args, 'Output units', 'Kilometres per hour (km/h)')),
      ),
  },
  {
    id: 'convert-data-units',
    name: 'Convert data units',
    category: 'Utils',
    description: 'Converts a quantity of data between bits, bytes and their multiples.',
    aliases: ['bytes', 'kilobytes', 'gigabytes', 'mebibytes'],
    args: unitArgs(DATA, 'Bytes (B)', 'Kibibytes (KiB)'),
    run: (input, args) =>
      convert(
        DATA,
        input,
        String(arg(args, 'Input units', 'Bytes (B)')),
        String(arg(args, 'Output units', 'Kibibytes (KiB)')),
      ),
  },
  {
    id: 'parse-colour-code',
    name: 'Parse colour code',
    category: 'Utils',
    description: 'Reads a colour in any common notation and prints it in all of them.',
    aliases: ['hex colour', 'rgb', 'hsl', 'cmyk'],
    args: [],
    run: (input) => {
      const text = input.trim();
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 1;
      let match: RegExpMatchArray | null;

      if ((match = /^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i.exec(text))) {
        [r, g, b] = [
          parseInt(match[1] as string, 16),
          parseInt(match[2] as string, 16),
          parseInt(match[3] as string, 16),
        ];
      } else if ((match = /^#?([a-f0-9])([a-f0-9])([a-f0-9])$/i.exec(text))) {
        [r, g, b] = [
          parseInt((match[1] as string).repeat(2), 16),
          parseInt((match[2] as string).repeat(2), 16),
          parseInt((match[3] as string).repeat(2), 16),
        ];
      } else if (
        (match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
          text,
        ))
      ) {
        [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
        a = match[4] === undefined ? 1 : Number(match[4]);
      } else if (
        (match = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
          text,
        ))
      ) {
        [r, g, b] = hslToRgb(Number(match[1]) / 360, Number(match[2]) / 100, Number(match[3]) / 100);
        a = match[4] === undefined ? 1 : Number(match[4]);
      } else if (
        (match = /^cmyk\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(text))
      ) {
        const black = Number(match[4]);
        r = Math.round(255 * (1 - Number(match[1])) * (1 - black));
        g = Math.round(255 * (1 - Number(match[2])) * (1 - black));
        b = Math.round(255 * (1 - Number(match[3])) * (1 - black));
      } else {
        throw new OperationError(
          'Enter a colour as #rrggbb, rgb(), rgba(), hsl(), hsla() or cmyk().',
        );
      }

      const [hue, saturation, lightness] = rgbToHsl(r, g, b);
      const k = 1 - Math.max(r, g, b) / 255;
      const channel = (value: number) => (k === 1 ? '0.00' : ((1 - value / 255 - k) / (1 - k)).toFixed(2));
      const hex = `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

      return [
        `Hex:  ${hex}`,
        `RGB:  rgb(${r}, ${g}, ${b})`,
        `RGBA: rgba(${r}, ${g}, ${b}, ${a})`,
        `HSL:  hsl(${Math.round(hue * 360)}, ${Math.round(saturation * 100)}%, ${Math.round(lightness * 100)}%)`,
        `HSLA: hsla(${Math.round(hue * 360)}, ${Math.round(saturation * 100)}%, ${Math.round(lightness * 100)}%, ${a})`,
        `CMYK: cmyk(${channel(r)}, ${channel(g)}, ${channel(b)}, ${k.toFixed(2)})`,
      ].join('\n');
    },
  },
  {
    id: 'haversine-distance',
    name: 'Haversine distance',
    category: 'Other',
    description: 'The great-circle distance between two latitude and longitude pairs.',
    aliases: ['great circle', 'geo distance', 'coordinates'],
    args: [
      {
        name: 'Units',
        type: 'option',
        value: 'Metres',
        options: ['Metres', 'Kilometres', 'Miles', 'Nautical miles', 'Feet'],
      },
      { name: 'Decimal places', type: 'number', value: 3, min: 0, max: 12 },
    ],
    run: (input, args) => {
      const numbers = input.match(/-?\d+(?:\.\d+)?/g) ?? [];
      if (numbers.length !== 4) {
        throw new OperationError(
          'Expected four numbers: two latitude and longitude pairs, one per line.',
        );
      }
      const [lat1, lon1, lat2, lon2] = numbers.map(Number) as [number, number, number, number];
      for (const latitude of [lat1, lat2]) {
        if (latitude < -90 || latitude > 90) {
          throw new OperationError(`${latitude} is not a latitude.`);
        }
      }

      const dLat = (lat2 - lat1) * TO_RADIANS;
      const dLon = (lon2 - lon1) * TO_RADIANS;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * TO_RADIANS) *
          Math.cos(lat2 * TO_RADIANS) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const metres = EARTH_RADIUS_METRES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      const per: Record<string, number> = {
        Metres: 1,
        Kilometres: 1000,
        Miles: 1609.344,
        'Nautical miles': 1852,
        Feet: 0.3048,
      };
      const unit = String(arg(args, 'Units', 'Metres'));
      const places = Math.max(0, Math.min(12, Number(arg(args, 'Decimal places', 3))));

      return (metres / (per[unit] ?? 1)).toFixed(places);
    },
  },
];
