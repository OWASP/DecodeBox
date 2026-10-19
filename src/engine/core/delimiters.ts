export const DELIMITERS: Readonly<Record<string, string>> = {
  Space: ' ',
  Comma: ',',
  'Semi-colon': ';',
  Colon: ':',
  'Line feed': '\n',
  CRLF: '\r\n',
  None: '',
};

export const DELIMITER_OPTIONS = Object.keys(DELIMITERS);

export function delimiterFor(name: string): string {
  return DELIMITERS[name] ?? ' ';
}

export function splitOnAnyDelimiter(input: string): string[] {
  return input.split(/[\s,;:]+/).filter((part) => part.length > 0);
}
