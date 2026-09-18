// Smoke test: drives the app in a phone-sized headless Chrome. Usage: node tools/smoke.mjs <url> <token>
// Section A runs on a deterministic fixture injected into localStorage (no token, so nothing is written to the cloud).
// Section B checks the real connect flow once; section C the connect screen and a wrong token.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fillSeason, plan, todayISO, addDays } from '../js/rotation.js';
const require = createRequire('C:/Users/timof/Projects/ironforge/package.json');
const { chromium } = require('playwright');
const [BASE = 'http://localhost:8124/index.html', TOKEN = ''] = process.argv.slice(2);
const WORKER = 'https://bible-study-sync.ophir-marketing-agency.workers.dev/state';
mkdirSync('tools/shots', { recursive: true });
const fails = [], errors = [];
const check = (c, m) => { if (!c) { fails.push(m); console.log('FAIL ' + m); } else console.log('ok  ' + m); };

const cloud = await fetch(WORKER, { headers: { 'X-App-Token': TOKEN } }).then(r => r.json());
check(cloud.state && cloud.state.people.length === 30, 'cloud state has 30 people');

// ---- fixture: the seed shape, anchored on today so "Tonight" and every date check hold on any day
const ORDER = ['David Rachkovskiy', 'Rebecca Isacova', 'Ignatyev', 'Nellie Odushkin', 'Nikita Bodnar', 'Lily Homan', 'Maltseva & Karolina', 'Matthew Kretsu', 'David Legun', 'Karina Matveiciuc', 'Bak', 'Loghinova', 'Veniamin Chubachuk', 'Liza Dumyan', 'Joseph Yefimenko', 'Mark Olaru', 'Ruvim K.', 'Nelli Polyakova', 'Davidka Pinzari', 'Lelyukh', 'Alex Dumyan', 'Max Timoshenko', 'Alex Ivanov', 'Ria Gavrilenko', 'Victoria Grec'];
const T = todayISO();
const fx = JSON.parse(JSON.stringify(cloud.state));
fx.households.forEach(h => { h.address = ''; h.note = ''; h.hostStatus = h.id === 'h_ignatyev' ? 'unavailable' : 'available'; h.unavailableUntil = null; });
fx.people.forEach(p => { p.active = true; p.phone = ''; p.notes = ''; });
fx.settings = { ...fx.settings, name: 'Bible Study', defaultTime: '19:00', weekday: new Date().getDay(), seasonStart: T, seasonEnd: addDays(T, 98) };
fx.rotation.order = ORDER.map(n => { const h = fx.households.find(x => x.name === n); if (!h) throw new Error('missing household ' + n); return h.id; });
fx.meetings = []; fx.meetings = fillSeason(fx);
fx.meetings[0].hostHouseholdId = fx.rotation.order[0]; fx.meetings[0].hostMode = 'pinned';
fx.meetings = plan(fx, T).meetings;
fx.updatedAt = new Date().toISOString();
const D = fx.meetings.map(m => m.date);
check(D.length === 15 && D[0] === T, 'fixture has 15 meetings starting today');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const mk = async (init) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Chicago', permissions: ['clipboard-read', 'clipboard-write'] });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/status of 403|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  return { ctx, page };
};
const shot = (page, name, full = true) => page.screenshot({ path: `tools/shots/${name}.png`, fullPage: full });
const tabTo = async (page, t) => { await page.locator(`.tabbar button[data-tab="${t}"]`).click(); await page.waitForTimeout(200); };
const heroText = page => page.locator('#p-week .hero').innerText();
const hostsOf = page => page.evaluate(() => window.__bs.state.meetings.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(m => m.hostHouseholdId));

// ---- A: UI flows on the injected fixture
{
  const { ctx, page } = await mk(`if (!localStorage.getItem('bs.state')) { localStorage.clear(); localStorage.setItem('bs.state', ${JSON.stringify(JSON.stringify(fx))}); }`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
  let hero = await heroText(page);
  check(/Tonight/i.test(hero) && /David Rachkovskiy/.test(hero), 'tonight card shows David Rachkovskiy');
  check(/no address yet/i.test(hero), 'address placeholder shown when blank');
  check(await page.locator('#p-week .list .row').count() === 4, 'four upcoming rows');
  await shot(page, '1-week');

  await tabTo(page, 'calendar');
  check(await page.locator('#p-calendar .row').count() === 15, 'calendar has 15 meetings');
  await shot(page, '2-calendar');
  await tabTo(page, 'people');
  check(await page.locator('#p-people .row').count() === 30, 'people list has 30');
  await shot(page, '3-people');
  await tabTo(page, 'hosting');
  check(await page.locator('#p-hosting .list .row').count() === 25, 'hosting queue has 25 households');
  check(/David Rachkovskiy/.test(await page.locator('#p-hosting .list .row').first().innerText()), 'David R first in the queue');
  check(/unavailable/i.test(await page.locator('#p-hosting .list .row', { hasText: 'Ignatyev' }).innerText()), 'Ignatyev household shows unavailable');
  check(await page.locator('[data-act="undo"]').isDisabled(), 'undo disabled with no history');
  await shot(page, '4-hosting');
  await tabTo(page, 'settings');
  await shot(page, '5-settings');

  // can't host tonight -> Rebecca takes tonight, David R next week; unskip restores
  await tabTo(page, 'week');
  await page.locator('[data-act="canthost"]').click(); await page.waitForTimeout(150);
  check(/Rebecca Isacova takes this week/.test(await page.locator('#sheetBody').innerText()), 'cant-host sheet explains the swap');
  await shot(page, '6-canthost-sheet', false);
  await page.locator('#sheetFoot .btn.primary').click(); await page.waitForTimeout(200);
  check(/Rebecca Isacova/.test(await heroText(page)), 'after skip, tonight host is Rebecca');
  let st = await hostsOf(page);
  check(st[0] === 'h_rebecca_isacova' && st[1] === 'h_david_rachkovskiy' && st[2] === 'h_nellie_odushkin', 'David R moved to next week, rest shifted');
  await page.locator('[data-act="editmeeting"]').first().click(); await page.waitForTimeout(150);
  check(await page.locator('[data-act="unskip"]').count() === 1, 'meeting sheet shows the skip with undo');
  await page.locator('[data-act="unskip"]').click(); await page.waitForTimeout(200);
  check(/David Rachkovskiy/.test(await heroText(page)), 'unskip restores David R');

  // change host -> pin Bak; back to automatic -> David R
  await page.locator('[data-act="changehost"]').click(); await page.waitForTimeout(150);
  await page.locator('#sheetBody [data-pick="h_bak"]').click(); await page.waitForTimeout(200);
  hero = await heroText(page);
  check(/Bak \(Anna & David\)/.test(hero) && /pinned/i.test(hero), 'Bak pinned for tonight with both names');
  await page.locator('[data-act="changehost"]').click(); await page.waitForTimeout(150);
  await page.locator('#hostAuto').click(); await page.waitForTimeout(200);
  check(/David Rachkovskiy/.test(await heroText(page)), 'back to automatic gives David R');

  // cancel + restore
  await page.locator('[data-act="cancel"]').click(); await page.waitForTimeout(200);
  check(/No meeting this week/.test(await heroText(page)), 'cancel week shows no meeting');
  st = await hostsOf(page);
  check(st[0] === null && st[1] === 'h_david_rachkovskiy', 'off week has no host; David R slides to next week');
  await page.locator('[data-act="restore"]').click(); await page.waitForTimeout(200);
  check(/David Rachkovskiy/.test(await heroText(page)), 'restore brings the meeting back');

  // attendance: scrolls inside the sheet, Save stays put
  await page.locator('[data-act="attendance"]').click(); await page.waitForTimeout(150);
  check(await page.locator('#attList .check').count() === 30, 'attendance list has 30');
  const scr = await page.evaluate(() => { const b = document.querySelector('#sheetBody'); b.scrollTop = 400; const r = b.getBoundingClientRect(); const f = document.querySelector('#sheetFoot').getBoundingClientRect(); return { canScroll: b.scrollHeight > b.clientHeight, scrolled: b.scrollTop, bodyInView: r.bottom <= window.innerHeight + 1, footInView: f.bottom <= window.innerHeight + 1 }; });
  check(scr.canScroll && scr.scrolled > 0 && scr.bodyInView && scr.footInView, 'attendance list scrolls inside the sheet and Save stays on screen');
  check(await page.evaluate(() => { const b = document.querySelector('#sheetBody'); b.scrollTop = b.scrollHeight; const last = document.querySelector('#attList .check:last-child').getBoundingClientRect(); return last.bottom <= document.querySelector('#sheetFoot').getBoundingClientRect().top + 1; }), 'last person reachable above the Save button');
  await shot(page, '7-attendance-scrolled', false);
  await page.evaluate(() => { document.querySelector('#sheetBody').scrollTop = 0; });
  for (let i = 0; i < 3; i++) await page.locator('#attList .check').nth(i).click();
  check(/3 of 30 present/.test(await page.locator('#attCount').innerText()), 'counter updates');
  await page.locator('#sheetFoot .btn.primary').click(); await page.waitForTimeout(200);
  check(/3 came/i.test(await heroText(page)) && /Attendance \(3\)/.test(await heroText(page)), 'hero shows 3 came');
  await tabTo(page, 'people');
  check(/100%|0%/.test(await page.locator('#p-people .row').first().innerText()), 'people rows show attendance %');

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

  // household edit: address + unavailable until meeting 8's date
  await tabTo(page, 'hosting');
  await page.locator('#p-hosting [data-act="edithh"][data-id="h_rebecca_isacova"]').click(); await page.waitForTimeout(150);
  await page.fill('#hAddr', '123 Main St, Minneapolis');
  await page.locator('#hStatus [data-v="until"]').click(); await page.fill('#hUntil', D[7]);
  await page.locator('#sheetFoot .btn.primary').click(); await page.waitForTimeout(200);
  st = await hostsOf(page);
  check(st[1] === 'h_nellie_odushkin' && st[7] === 'h_rebecca_isacova', 'unavailable-until skips Rebecca to the first week she is back');
  const rebRow = await page.locator('#p-hosting .row', { hasText: 'Rebecca' }).innerText();
  check(/back /i.test(rebRow) && /123 Main St/.test(rebRow), 'hosting row shows back-date and address');

  // move row, then undo / redo
  const q0 = await page.evaluate(() => window.__bs.queue().slice(0, 3));
  await page.locator('#p-hosting .list .row').nth(1).locator('[data-dir="1"]').click(); await page.waitForTimeout(200);
  const q1 = await page.evaluate(() => window.__bs.queue().slice(0, 3));
  check(q1[0] === q0[0] && q1[1] === q0[2] && q1[2] === q0[1], 'move down swaps rows 2 and 3');
  check(!(await page.locator('[data-act="undo"]').isDisabled()) && /Move /.test(await page.locator('[data-act="undo"]').getAttribute('title')), 'undo enabled and labelled with the move');
  await page.locator('[data-act="undo"]').click(); await page.waitForTimeout(200);
  check(JSON.stringify(await page.evaluate(() => window.__bs.queue().slice(0, 3))) === JSON.stringify(q0), 'undo restores the order');
  await page.locator('[data-act="redo"]').click(); await page.waitForTimeout(200);
  check(JSON.stringify(await page.evaluate(() => window.__bs.queue().slice(0, 3))) === JSON.stringify(q1), 'redo re-applies the move');
  await page.locator('[data-act="undo"]').click(); await page.waitForTimeout(200);
  await page.locator('[data-act="undo"]').click(); await page.waitForTimeout(200);
  check(await page.evaluate(() => window.__bs.state.households.find(h => h.id === 'h_rebecca_isacova').hostStatus) === 'available', 'second undo reverts the household edit too');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#app:not(.hidden)'); await tabTo(page, 'hosting');
  check(!(await page.locator('[data-act="redo"]').isDisabled()), 'history survives a reload');
  await shot(page, '4b-hosting-undo');

  // settings: extend the season then shrink it back
  await tabTo(page, 'settings');
  await page.fill('#setEnd', addDays(D[14], 14)); await page.locator('[data-act="savesettings"]').click(); await page.waitForTimeout(200);
  check(await page.evaluate(() => window.__bs.state.meetings.length) === 17, 'extending the season by two weeks adds two meetings');
  await tabTo(page, 'settings');
  await page.fill('#setEnd', D[14]); await page.locator('[data-act="savesettings"]').click(); await page.waitForTimeout(200);
  check(await page.evaluate(() => window.__bs.state.meetings.length) === 15, 'shrinking the season prunes blank future weeks');

  // add event + copy summary
  await tabTo(page, 'calendar');
  await page.locator('[data-act="addevent"]').click(); await page.waitForTimeout(150);
  await page.fill('#eDate', addDays(D[6], 1)); await page.fill('#eTitle', 'Bonfire'); await page.fill('#ePlace', 'Como Park');
  await page.locator('#sheetFoot .btn.primary').click(); await page.waitForTimeout(200);
  check(await page.locator('#p-calendar .row').count() === 16 && await page.locator('#p-calendar .row', { hasText: 'Bonfire' }).count() === 1, 'event added to calendar');
  await tabTo(page, 'week');
  await page.locator('[data-act="copy"]').click(); await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(/Bible Study · .+ at 7:00 PM/.test(clip) && /Hosted by David Rachkovskiy/.test(clip), 'copy summary text');

  await tabTo(page, 'settings');
  await page.locator('[data-act="theme"][data-v="light"]').click(); await page.waitForTimeout(150);
  await tabTo(page, 'week'); await shot(page, '8-week-light');
  await ctx.close();
}

// ---- B: real connect flow with the token in the URL (pull only)
{
  const { ctx, page } = await mk(`localStorage.clear();`);
  await page.goto(BASE + '#token=' + TOKEN, { waitUntil: 'networkidle' });
  await page.waitForSelector('#app:not(.hidden)', { timeout: 20000 });
  check(!page.url().includes('token='), 'token stripped from the URL');
  check(/30/.test(await page.locator('#topRight').innerText()), 'connected device pulled the cloud roster (30 people)');
  await page.waitForTimeout(1500);
  check(/synced/i.test(await page.locator('#syncText').innerText()), 'header shows synced');
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
