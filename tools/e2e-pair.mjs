// Setup-code flow, end to end, against a LOCAL worker (never the live one: it writes KV).
// Usage: node tools/e2e-pair.mjs http://localhost:8124/ http://localhost:8787 <local APP_TOKEN> <shotsDir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/timof/Projects/ironforge/package.json');
const { chromium } = require('playwright');
const [BASE = 'http://localhost:8124/', WORKER = 'http://localhost:8787', TOKEN = 'localtest', SHOTS = 'shots'] = process.argv.slice(2);
mkdirSync(SHOTS, { recursive: true });
const fails = [], errors = [];
const check = (c, m) => { if (!c) { fails.push(m); console.log('FAIL ' + m); } else console.log('ok  ' + m); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const device = async (withToken) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Chicago', permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(`if (!sessionStorage.getItem('i')) { sessionStorage.setItem('i', 1); localStorage.setItem('bs.worker', ${JSON.stringify(WORKER)}); ${withToken ? `localStorage.setItem('bs.token', ${JSON.stringify(TOKEN)});` : ''} }`);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(BASE + 'index.html', { waitUntil: 'networkidle' });
  return page;
};
const connect = async (page, text) => { await page.locator('#tokenIn').fill(text); await page.locator('#tokenGo').click(); await wait(900); };
const makeCode = async leader => {
  await leader.locator('[data-act="pairstart"]').click(); await wait(500);
  const shown = (await leader.locator('.paircode').innerText()).trim();
  await leader.locator('#sheetFoot .btn.primary').click(); await wait(200);
  return shown;
};

const L = await device(true);
await L.waitForSelector('#app:not(.hidden)'); await wait(600);
await L.locator('[data-act="tab"][data-tab="settings"]').click(); await wait(300);
check(await L.locator('[data-act="pairstart"]').count() === 1, 'leader Settings has Connect another device');
let shown = await makeCode(L); await L.locator('[data-act="pairstart"]').click(); await wait(400);
await L.screenshot({ path: `${SHOTS}/pair-1-leader-code.png` }); await L.locator('#sheetFoot .btn.primary').click();
check(/^[A-Z2-9]{4} [A-Z2-9]{4}$/.test(shown), `code is shown as two groups of four (${shown.length} chars)`);
shown = await makeCode(L); // fresh code replaces the one just looked at

// new phone #1: wrong code, then the right one typed sloppily
const N1 = await device(false);
check(await N1.locator('#connect:not(.hidden)').count() === 1, 'new device shows the Connect screen');
check(/Setup code/.test(await N1.locator('#connect').innerText()), 'Connect screen asks for a setup code');
await N1.screenshot({ path: `${SHOTS}/pair-2-connect.png` });
await connect(N1, 'AAAA-AAAA');
check(/not right\. 4 tries left/.test(await N1.locator('#tokenErr').innerText()), 'wrong code: "4 tries left"');
await connect(N1, shown.toLowerCase().replace(' ', ' - '));
check(await N1.locator('#app:not(.hidden)').count() === 1 && await N1.locator('#p-home .hero').count() === 1, 'right code (lowercase, spaced) connects and shows this week');
check(await N1.evaluate(t => localStorage.getItem('bs.token') === t, TOKEN), 'new device stored the sync token');
await N1.screenshot({ path: `${SHOTS}/pair-3-connected.png` });

// reuse: the code is single-use
const N2 = await device(false); await connect(N2, shown);
check(/no active setup code/i.test(await N2.locator('#tokenErr').innerText()), 'used code does not work a second time');

// five wrong guesses cancel a code
shown = await makeCode(L);
const N3 = await device(false);
for (let i = 0; i < 4; i++) await connect(N3, 'BBBBBBBB');
check(/1 try left/.test(await N3.locator('#tokenErr').innerText()), '4 wrong tries leaves 1');
await connect(N3, 'BBBBBBBB');
check(/cancelled/.test(await N3.locator('#tokenErr').innerText()), '5th wrong try cancels the code');
await connect(N3, shown);
check(/no active setup code/i.test(await N3.locator('#tokenErr').innerText()), 'the right code no longer works after cancellation');

// pasting the whole token still works, and Copy the token instead still copies it
const N4 = await device(false); await connect(N4, TOKEN);
check(await N4.locator('#app:not(.hidden)').count() === 1, 'pasting the full token still connects');
await L.locator('[data-act="copytoken"]').click(); await wait(300);
check(await L.evaluate(() => navigator.clipboard.readText()) === TOKEN, 'Copy the token instead copies the token');

check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
await browser.close();
