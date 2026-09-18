// Smoke test: drives the app in a phone-sized headless Chrome. Usage: node tools/smoke.mjs <url> <token>
// Loads the cloud state into localStorage (no token) so UI flows never write to the cloud, then checks the real connect flow once.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/timof/Projects/ironforge/package.json');
const { chromium } = require('playwright');
const [BASE = 'http://localhost:8124/index.html', TOKEN = ''] = process.argv.slice(2);
const WORKER = 'https://bible-study-sync.ophir-marketing-agency.workers.dev/state';
mkdirSync('tools/shots', { recursive: true });
const fails = [], errors = [];
const check = (c, m) => { if (!c) { fails.push(m); console.log('FAIL ' + m); } else console.log('ok  ' + m); };

const cloud = await fetch(WORKER, { headers: { 'X-App-Token': TOKEN } }).then(r => r.json());
check(cloud.state && cloud.state.people.length === 30, 'cloud state has 30 people');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const mk = async (init) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Chicago', permissions: ['clipboard-read', 'clipboard-write'] });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/status of 403/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  return { ctx, page };
};
const shot = (page, name, full = true) => page.screenshot({ path: `tools/shots/${name}.png`, fullPage: full });
const tabTo = async (page, t) => { await page.locator(`.tabbar button[data-tab="${t}"]`).click(); await page.waitForTimeout(200); };
const heroText = page => page.locator('#p-week .hero').innerText();

// ---- A: UI flows on injected local state
{
  const seed = JSON.stringify(cloud.state);
  const { ctx, page } = await mk(`localStorage.setItem('bs.state', ${JSON.stringify(seed)}); localStorage.removeItem('bs.token');`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
  let hero = await heroText(page);
  check(/Tonight/i.test(hero) && /David Rachkovskiy/.test(hero), 'tonight card shows David Rachkovskiy');
  check(/no address yet/i.test(hero), 'address placeholder shown when blank');
  check(await page.locator('#p-week .list .row').count() === 4, 'four upcoming rows');
  await shot(page, '1-week');

  await tabTo(page, 'calendar');
  check(await page.locator('#p-calendar .row').count() === 15, 'calendar has 15 Fridays');
  await shot(page, '2-calendar');
  await tabTo(page, 'people');
  check(await page.locator('#p-people .row').count() === 30, 'people list has 30');
  await shot(page, '3-people');
  await tabTo(page, 'hosting');
  check(await page.locator('#p-hosting .list .row').count() === 25, 'hosting queue has 25 households');
  const firstRow = await page.locator('#p-hosting .list .row').first().innerText();
  check(/David Rachkovskiy/.test(firstRow), 'David R first in the queue');
  const igRow = await page.locator('#p-hosting .list .row', { hasText: 'Ignatyev' }).innerText();
  check(/unavailable/i.test(igRow), 'Ignatyev household shows unavailable');
  await shot(page, '4-hosting');
  await tabTo(page, 'settings');
  await shot(page, '5-settings');

  // can't host tonight -> Rebecca takes tonight, David R next week; undo restores
  await tabTo(page, 'week');
  await page.locator('[data-act="canthost"]').click(); await page.waitForTimeout(150);
  check(/Rebecca Isacova takes this week/.test(await page.locator('#sheetBody').innerText()), 'cant-host sheet explains the swap');
  await shot(page, '6-canthost-sheet', false);
  await page.locator('#sheetFoot .btn.primary').click(); await page.waitForTimeout(200);
  hero = await heroText(page);
  check(/Rebecca Isacova/.test(hero), 'after skip, tonight host is Rebecca');
  const st = await page.evaluate(() => window.__bs.state.meetings.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(m => m.hostHouseholdId));
  check(st[0] === 'h_rebecca_isacova' && st[1] === 'h_david_rachkovskiy' && st[2] === 'h_nellie_odushkin', 'David R moved to Sep 25, rest shifted');
  await page.locator('[data-act="editmeeting"]').first().click(); await page.waitForTimeout(150);
  check(await page.locator('[data-act="unskip"]').count() === 1, 'meeting sheet shows the skip with undo');
  await page.locator('[data-act="unskip"]').click(); await page.waitForTimeout(200);
  hero = await heroText(page);
  check(/David Rachkovskiy/.test(hero), 'undo restores David R');

  // change host -> pin Bak; back to automatic -> David R
  await page.locator('[data-act="changehost"]').click(); await page.waitForTimeout(150);
  await page.locator('#sheetBody [data-pick="h_bak"]').click(); await page.waitForTimeout(200);
  hero = await heroText(page);
  check(/Bak \(Anna & David\)/.test(hero) && /pinned/i.test(hero), 'Bak pinned for tonight with both names');
  await page.locator('[data-act="changehost"]').click(); await page.waitForTimeout(150);
  await page.locator('#hostAuto').click(); await page.waitForTimeout(200);
  hero = await heroText(page);
  check(/David Rachkovskiy/.test(hero), 'back to automatic gives David R');

  // cancel + restore
  await page.locator('[data-act="cancel"]').click(); await page.waitForTimeout(200);
  hero = await heroText(page);
  check(/No meeting this week/.test(hero), 'cancel week shows no meeting');
  const afterCancel = await page.evaluate(() => window.__bs.state.meetings.slice().sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 2).map(m => m.hostHouseholdId));
  check(afterCancel[0] === null && afterCancel[1] === 'h_david_rachkovskiy', 'off week has no host; David R slides to Sep 25');
  await page.locator('[data-act="restore"]').click(); await page.waitForTimeout(200);
  check(/David Rachkovskiy/.test(await heroText(page)), 'restore brings the meeting back');

  // attendance
  await page.locator('[data-act="attendance"]').click(); await page.waitForTimeout(150);
  check(await page.locator('#attList .check').count() === 30, 'attendance list has 30');
  for (let i = 0; i < 3; i++) await page.locator('#attList .check').nth(i).click();
  check(/3 of 30 present/.test(await page.locator('#attCount').innerText()), 'counter updates');
  await shot(page, '7-attendance', false);
  await page.locator('#sheetFoot .btn.primary').click(); await page.waitForTimeout(200);
  check(/3 came/i.test(await heroText(page)), 'hero shows 3 came');
  check(/Attendance \(3\)/.test(await heroText(page)), 'button shows count');
  await tabTo(page, 'people');
  const pct = await page.locator('#p-people .row').first().innerText();
  check(/100%|0%/.test(pct), 'people rows show attendance %');

  // add + delete person
  await page.locator('[data-act="addperson"]').click(); await page.waitForTimeout(150);
  await page.fill('#pName', 'Test Person'); await page.locator('#sheetFoot .btn.primary').click(); await page.waitForTimeout(200);
  check(await page.locator('#p-people .row').count() === 31, 'person added');
  check(await page.evaluate(() => window.__bs.state.households.length) === 26, 'own household created');
  await page.locator('#p-people .row', { hasText: 'Test Person' }).click(); await page.waitForTimeout(150);
  await page.locator('#sheetFoot .btn.danger').click(); await page.waitForTimeout(150);
  await page.locator('#sheetFoot .btn.danger').click(); await page.waitForTimeout(200);
  check(await page.locator('#p-people .row').count() === 30, 'person deleted');
  check(await page.evaluate(() => window.__bs.state.households.length) === 25, 'empty household pruned');

  // household edit: address + unavailable until
  await tabTo(page, 'hosting');
  await page.locator('#p-hosting [data-act="edithh"][data-id="h_rebecca_isacova"]').click(); await page.waitForTimeout(150);
  await page.fill('#hAddr', '123 Main St, Minneapolis');
  await page.locator('#hStatus [data-v="until"]').click(); await page.fill('#hUntil', '2026-11-01');
  await page.locator('#sheetFoot .btn.primary').click(); await page.waitForTimeout(200);
  const seq = await page.evaluate(() => window.__bs.state.meetings.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(m => m.date + ':' + m.hostHouseholdId));
  check(seq[1] === '2026-09-25:h_nellie_odushkin' && seq[7] === '2026-11-06:h_rebecca_isacova', 'unavailable-until skips Rebecca to Nov 6');
  const rebRow = await page.locator('#p-hosting .row', { hasText: 'Rebecca' }).innerText();
  check(/back Nov 1/i.test(rebRow) && /123 Main St/.test(rebRow), 'hosting row shows back-date and address');
  // move row
  const before = await page.evaluate(() => window.__bs.queue().slice(0, 3));
  await page.locator('#p-hosting .list .row').nth(1).locator('[data-dir="1"]').click(); await page.waitForTimeout(200);
  const after = await page.evaluate(() => window.__bs.queue().slice(0, 3));
  check(after[0] === before[0] && after[1] === before[2] && after[2] === before[1], 'move down swaps rows 2 and 3');

  // settings: extend the season then shrink it back
  await tabTo(page, 'settings');
  await page.fill('#setEnd', '2027-01-08'); await page.locator('[data-act="savesettings"]').click(); await page.waitForTimeout(200);
  check(await page.evaluate(() => window.__bs.state.meetings.length) === 17, 'extending season to Jan 8 adds Jan 1 and Jan 8');
  await tabTo(page, 'settings');
  await page.fill('#setEnd', '2026-12-31'); await page.locator('[data-act="savesettings"]').click(); await page.waitForTimeout(200);
  check(await page.evaluate(() => window.__bs.state.meetings.length) === 15, 'shrinking season prunes blank future weeks');

  // add event + copy summary
  await tabTo(page, 'calendar');
  await page.locator('[data-act="addevent"]').click(); await page.waitForTimeout(150);
  await page.fill('#eDate', '2026-10-31'); await page.fill('#eTitle', 'Bonfire'); await page.fill('#ePlace', 'Como Park');
  await page.locator('#sheetFoot .btn.primary').click(); await page.waitForTimeout(200);
  check(await page.locator('#p-calendar .row').count() === 16, 'event added to calendar');
  check(await page.locator('#p-calendar .row', { hasText: 'Bonfire' }).count() === 1, 'event row shows title');
  await tabTo(page, 'week');
  await page.locator('[data-act="copy"]').click(); await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(/Bible Study · Fri, Sep 18 at 7:00 PM/.test(clip) && /David Rachkovskiy/.test(clip), 'copy summary text');

  // light theme render
  await tabTo(page, 'settings');
  await page.locator('[data-act="theme"][data-v="light"]').click(); await page.waitForTimeout(150);
  await tabTo(page, 'week'); await shot(page, '8-week-light');
  await ctx.close();
}

// ---- B: real connect flow with the token in the URL (pull only + one harmless push)
{
  const { ctx, page } = await mk(`localStorage.clear();`);
  await page.goto(BASE + '#token=' + TOKEN, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app:not(.hidden)', { timeout: 20000 });
  check(!page.url().includes('token='), 'token stripped from the URL');
  check(/David Rachkovskiy/.test(await heroText(page)), 'connected device pulled the cloud state');
  await page.waitForTimeout(1500);
  check(/synced/.test(await page.locator('#syncText').innerText()), 'header shows synced');
  await tabTo(page, 'settings');
  check(/Synced/i.test(await page.locator('#syncLine').innerText()), 'settings shows synced');
  await ctx.close();
}
// ---- C: no token, no state -> connect screen; wrong token rejected
{
  const { ctx, page } = await mk(`localStorage.clear();`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check(await page.locator('#connect').isVisible(), 'connect screen without token');
  await shot(page, '0-connect', false);
  await page.fill('#tokenIn', 'wrong'); await page.locator('#tokenGo').click(); await page.waitForTimeout(1500);
  check(/rejected/.test(await page.locator('#tokenErr').innerText()), 'wrong token rejected');
  await ctx.close();
}
await browser.close();
if (errors.length) { console.log('\nBrowser errors:'); errors.forEach(e => console.log('  ' + e)); }
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall checks passed');
process.exit(fails.length || errors.length ? 1 : 0);
