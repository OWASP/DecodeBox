import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { aliases, releasePath } from './sdk-paths.mjs';

const base = new URL(process.argv[2]);
const consumer = new URL('__sdk_browser_check__', base).href;
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const file of ['decodebox.js', 'decodebox.mjs']) {
    for (const path of [...aliases[file], releasePath + '/' + file]) {
      const url = new URL(path.slice(1), base).href;
      const page = await browser.newPage();
      try {
        // Only the empty consumer document is synthetic. Every SDK request reaches the host.
        await page.route(consumer, (route) =>
          route.fulfill({ contentType: 'text/html', body: '<title>Consumer</title>' }),
        );
        await page.goto(consumer);
        if (file.endsWith('.js')) await page.addScriptTag({ url });
        const output = await page.evaluate(async ({ file, url }) => {
          const sdk = file.endsWith('.mjs') ? (await import(url)).default : globalThis.DecodeBox;
          await sdk.ready;
          return sdk.executeOperation('from-base64', 'SGVsbG8=');
        }, { file, url });
        assert.equal(output, 'Hello');
        console.log('Chromium loaded', url);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
