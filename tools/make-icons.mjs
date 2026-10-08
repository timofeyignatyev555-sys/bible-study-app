// Render the PNG icons. Uses Playwright from ironforge's node_modules.
//   node tools/make-icons.mjs            both sets
//   node tools/make-icons.mjs admin      only the leader app's icons (icons/admin-*.png, gold tile + gear)
//   node tools/make-icons.mjs members    only the group page's icons (dark tile)
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire('C:/Users/timof/Projects/ironforge/package.json');
const { chromium } = require('playwright');
const SETS = {
  members: { html: 'tools/icon.html', files: [[512, 'icon-512.png'], [192, 'icon-192.png'], [180, 'apple-touch-icon.png']] },
  admin: { html: 'tools/icon-admin.html', files: [[512, 'admin-512.png'], [192, 'admin-192.png'], [180, 'admin-apple-touch.png']] }
};
const pick = process.argv[2];
if (pick && !SETS[pick]) { console.error('unknown set: ' + pick); process.exit(1); }
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const name of pick ? [pick] : Object.keys(SETS)) {
  for (const [size, file] of SETS[name].files) {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: size / 512 });
    await page.goto(pathToFileURL(SETS[name].html).href);
    await page.screenshot({ path: 'icons/' + file, clip: { x: 0, y: 0, width: 512, height: 512 } });
    await page.close();
    console.log('wrote icons/' + file);
  }
}
await browser.close();
