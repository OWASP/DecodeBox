import { readFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
export const releasePath = '/sdk/v1/' + version;
export const aliases = {
  'decodebox.js': ['/api', '/api.js', '/sdk/v1/decodebox.js', '/sdk/decodebox.js'],
  'decodebox.mjs': ['/sdk/v1/decodebox.esm.js', '/sdk/decodebox.mjs'],
  'decodebox.d.mts': ['/sdk/decodebox.d.mts'],
};
