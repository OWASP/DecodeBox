
export interface NamedAlphabet {
  label: string;
  spec: string;
}

export const BASE64_ALPHABETS: NamedAlphabet[] = [
  { label: 'Standard (RFC 4648)', spec: 'A-Za-z0-9+/=' },
  { label: 'URL safe (RFC 4648 §5)', spec: 'A-Za-z0-9-_' },
  { label: 'Filename safe', spec: 'A-Za-z0-9+\\-=' },
  { label: 'itoa64', spec: './0-9A-Za-z=' },
  { label: 'XML', spec: 'A-Za-z0-9_.' },
  { label: 'y64', spec: 'A-Za-z0-9._-' },
  { label: 'z64', spec: '0-9a-zA-Z+/=' },
  { label: 'Radix-64 (RFC 4880)', spec: '0-9A-Za-z+/=' },
  { label: 'Uuencoding', spec: '[space]-_' },
  { label: 'Xxencoding', spec: '+\\-0-9A-Za-z' },
  { label: 'BinHex', spec: '!-,-0-689@A-NP-VX-Z[`a-fh-mp-r' },
  { label: 'ROT13', spec: 'N-ZA-Mn-za-m0-9+/=' },
  { label: 'UNIX crypt', spec: './0-9A-Za-z' },
];

export const BASE32_ALPHABETS: NamedAlphabet[] = [
  { label: 'Standard (RFC 4648)', spec: 'A-Z2-7=' },
  { label: 'Extended hex (RFC 4648 §7)', spec: '0-9A-V=' },
  { label: 'z-base-32', spec: 'ybndrfg8ejkmcpqxot1uwisza345h769' },
  { label: 'Crockford', spec: '0-9A-HJKMNP-TV-Z' },
];

export function optionsFor(alphabets: NamedAlphabet[]): {
  options: string[];
  optionLabels: Record<string, string>;
} {
  const options = alphabets.map((a) => a.spec);
  const optionLabels: Record<string, string> = {};
  for (const { label, spec } of alphabets) optionLabels[spec] = label;
  return { options, optionLabels };
}
