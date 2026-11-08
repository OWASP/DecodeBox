import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const homepage = (JSON.parse(readFileSync('package.json', 'utf8')) as { homepage: string }).homepage;
const notFound = readFileSync('public/404.html', 'utf8');

describe('the 404 page', () => {
  /*
   * GitHub Pages serves this one file for every missing path, at any depth,
   * so a link to "/" or "./" lands somewhere else on owasp.github.io. Every
   * link it has must name the site itself, which package.json records.
   */
  it('links only to the site, wherever on it the missing page was', () => {
    const links = [...notFound.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.startsWith(homepage), link).toBe(true);
  });
});
