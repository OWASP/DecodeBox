import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { aliases, releasePath } from './sdk-paths.mjs';

const root = process.argv[2] ?? 'dist';
const origin = process.argv[3];
const checksums = [];

async function readArtifact(path) {
  const bytes = await readFile(join(root, path));
  if (!bytes.length) throw new Error('Empty SDK artifact: ' + join(root, path));
  if (origin) {
    const url = new URL(path.slice(1), origin.replace(/\/?$/, '/'));
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const type = (response.headers.get('content-type') ?? '').split(';')[0];
    if (response.status !== 200 || !Buffer.from(await response.arrayBuffer()).equals(bytes))
      throw new Error('Unexpected HTTP status or content for ' + url + ' (' + response.status + ')');
    if (path === '/api' && type === 'application/octet-stream' &&
        !response.headers.has('x-content-type-options')) {
      console.log('/api is served as binary data. Use /api.js for strict MIME consumers.');
    } else if ((path === '/api' || /\.m?js$/.test(path)) &&
               !/^(text|application)\/(java|ecma)script$/i.test(type)) {
      throw new Error('Unexpected script MIME type for ' + url + ': ' + type);
    }
  }
  return bytes;
}

for (const [file, paths] of Object.entries(aliases)) {
  const source = releasePath + '/' + file;
  const expected = await readArtifact(source);
  checksums.push(createHash('sha256').update(expected).digest('hex') + '  ' + file);
  for (const path of paths) {
    if (!(await readArtifact(path)).equals(expected)) {
      throw new Error(path + ' differs from ' + source);
    }
  }
  console.log([source, ...paths].join(', ') + ' verified (' + expected.length + ' bytes each)');
}

if ((await readArtifact(releasePath + '/SHA256SUMS')).toString() !== checksums.join('\n') + '\n')
  throw new Error('SDK release checksums do not match the distribution.');

await import(pathToFileURL(resolve(root, 'api.js')).href);
const { default: esm } = await import(pathToFileURL(resolve(root, 'sdk/decodebox.mjs')).href);
for (const sdk of [globalThis.DecodeBox, esm]) {
  await sdk.ready;
  if (!sdk.getOperation('to-base64') || await sdk.executeOperation('to-base64', 'Hi') !== 'SGk=')
    throw new Error('SDK bundle failed the operation smoke test.');
}
