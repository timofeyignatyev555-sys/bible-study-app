// Render tools/icon.html to the PNG icons. Uses Playwright from ironforge's node_modules.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire('C:/Users/timof/Projects/ironforge/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [size, file] of [[512, 'icon-512.png'], [192, 'icon-192.png'], [180, 'apple-touch-icon.png']]) {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: size / 512 });
  await page.goto(pathToFileURL('tools/icon.html').href);
  await page.screenshot({ path: 'icons/' + file, clip: { x: 0, y: 0, width: 512, height: 512 } });
  await page.close();
  console.log('wrote icons/' + file);
}
await browser.close();
