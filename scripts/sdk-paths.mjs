import project from '../package.json' with { type: 'json' };

// A version is a single path segment, including when testing a prerelease.
if (!/^\d[0-9A-Za-z.+-]*$/.test(project.version)) throw new Error('Invalid SDK version path.');
export const releasePath = '/sdk/v1/' + project.version;
export const aliases = {
  'decodebox.js': ['/api', '/api.js', '/sdk/v1/decodebox.js', '/sdk/decodebox.js'],
  'decodebox.mjs': ['/sdk/v1/decodebox.esm.js', '/sdk/decodebox.mjs'],
  'decodebox.d.mts': ['/sdk/decodebox.d.mts'],
};
