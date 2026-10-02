// Local end-to-end: leader app + group page against `wrangler dev` seeded with a copy of the real state (never the live worker; it writes).
// Usage: node tools/e2e-local.mjs http://localhost:8124/ http://localhost:8787 <local APP_TOKEN> <shotsDir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/timof/Projects/ironforge/package.json');
const { chromium } = require('playwright');
const [BASE = 'http://localhost:8124/', WORKER = 'http://localhost:8787', TOKEN = 'localtest', SHOTS = 'shots'] = process.argv.slice(2);
mkdirSync(SHOTS, { recursive: true });
const fails = [], errors = [];
const check = (c, m) => { if (!c) { fails.push(m); console.log('FAIL ' + m); } else console.log('ok  ' + m); };
const server = () => fetch(WORKER + '/state', { headers: { 'X-App-Token': TOKEN } }).then(r => r.json()).then(r => r.state);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const mk = async init => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Chicago', permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  return page;
};
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---- leader
const L = await mk(`if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', 1); localStorage.setItem('bs.worker', ${JSON.stringify(WORKER)}); ${WORKER.includes('localhost') ? `localStorage.setItem('bs.token', ${JSON.stringify(TOKEN)});` : ''} }`);
await L.goto(BASE + 'index.html' + (WORKER.includes('localhost') ? '' : '#token=' + TOKEN), { waitUntil: 'networkidle' });
await L.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
await wait(800);
let hero = await L.locator('#p-week .hero').innerText();
console.log('HERO:', hero.replace(/\n+/g, ' | '));
check(/Host/i.test(hero) && /Change this week/.test(hero) && /Attendance/.test(hero), 'This Week hero has host + 2 buttons');
check(await L.locator('#p-week .hero .btn').count() === 2, 'only two buttons on the hero');
await shot(L, '1-week');
await L.locator('#p-week .hero [data-act="week"]').click(); await wait(300);
const ws = await L.locator('#sheetBody').innerText();
check(/Someone else hosts/.test(ws) && /can't host/.test(ws) && /No meeting this week/.test(ws), 'week sheet lists the plain actions');
await shot(L, '2-week-sheet');
await L.locator('#sheetClose').click();
await L.locator('.tabbar [data-tab="hosting"]').click(); await wait(300);
const ht = await L.locator('#p-hosting').innerText();
check(/Schedule/i.test(ht) && /Next in line/i.test(ht) && / & .+\(/.test(ht), 'hosting tab: schedule, next in line, sibling label');
check(await L.locator('#p-hosting [data-act="move"]').count() === 0, 'no queue arrows on hosting tab');
await shot(L, '3-hosting');
// group link
await L.locator('.tabbar [data-tab="settings"]').click(); await wait(200);
await L.locator('#p-settings [data-act="copygroup"], #p-settings [data-act="sharegroup"]').first().click(); await wait(800);
const gkey = await L.evaluate(() => localStorage.getItem('bs.groupKey'));
check(!!gkey, 'group key fetched'); await L.locator('.tabbar [data-tab="settings"]').click(); await wait(200);
await shot(L, '4-settings');
const glink = await L.evaluate(() => document.querySelector('#p-settings .mono')?.textContent);
console.log('LINK:', glink);
check(glink && glink.includes('/group/?k='), 'settings shows the group link');

// ---- member
const G = await mk(`localStorage.setItem('bs.worker', ${JSON.stringify(WORKER)});`);
await G.goto(glink, { waitUntil: 'networkidle' }); await wait(600);
check(/Who are you/.test(await G.locator('#g').innerText()), 'member sees the name picker');
await shot(G, '5-group-picker');
const s0 = await server();
// the member is whoever hosts the second upcoming week; the swap partner hosts a later week (picked from the data, no names in the repo)
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const fut = s0.meetings.filter(m => m.date >= TODAY && m.status === 'on' && !m.location && m.hostHouseholdId).sort((a, b) => a.date < b.date ? -1 : 1);
const nellieMeet = fut[1];
const nellie = s0.people.find(p => p.householdId === nellieMeet.hostHouseholdId && p.active !== false);
const partnerH = fut[fut.length - 2].hostHouseholdId;
await G.locator('#pickSearch').fill(nellie.name.slice(0, 4).toLowerCase()); await G.locator(`[data-act="iam"][data-id="${nellie.id}"]`).click(); await wait(300);
let gt = await G.locator('#g').innerText();
check(/Your turn to host/i.test(gt), 'your-turn card shown');
console.log('MEMBER TURN:', gt.split('\n').slice(0, 8).join(' | '));
await shot(G, '6-group-main');
check(await G.locator('[data-act="editmeeting"], [data-act="addevent"], .tabbar').count() === 0, 'member page has no editing of the calendar');
await G.locator('#myAddr').fill('100 Test Ave, Minneapolis'); await G.locator('[data-act="saveaddr"]').click(); await wait(800);
let s1 = await server();
check(s1.households.find(h => h.id === nellie.householdId).address === '100 Test Ave, Minneapolis', 'member address saved to the cloud');

// leader makes an edit WITHOUT pulling first (conflict + merge path)
await L.evaluate(() => { const st = window.__bs.state; });
await L.locator('.tabbar [data-tab="people"]').click(); await wait(200);
await L.locator('[data-act="addperson"]').click(); await wait(200);
await L.locator('#pName').fill('Test Newperson'); await L.locator('#sheetFoot .btn.primary').click(); await wait(2500);
const toastAdd = await L.locator('#toast').innerText();
console.log('ADD TOAST:', toastAdd);
let s2 = await server();
check(s2.people.some(p => p.name === 'Test Newperson'), 'leader add reached the cloud');
check(s2.households.find(h => h.id === nellie.householdId).address === '100 Test Ave, Minneapolis', 'member address survived the leader push (merged, not overwritten)');
check(await L.evaluate(id => window.__bs.state.households.find(h => h.id === id).address, nellie.householdId) === '100 Test Ave, Minneapolis', 'leader app shows the member address');

// member swap
await G.locator('#gRefresh').click(); await wait(800);
await G.locator('[data-act="swap"]').click(); await wait(300);
await shot(G, '7-group-swap');
const bak = s2.households.find(h => h.id === partnerH);
await G.locator(`#sheetBody [data-to="${bak.id}"]`).click(); await wait(200);
check(/Record this swap/.test(await G.locator('#sheetTitle').innerText()), 'swap asks for confirmation');
await G.locator('#sheetFoot .btn.primary').click(); await wait(900);
gt = await G.locator('#g').innerText();
let s3 = await server();
const m3 = s3.meetings.find(m => m.id === nellieMeet.id);
check(m3.hostHouseholdId === bak.id && m3.hostMode === 'pinned', `member swap: partner now hosts ${nellieMeet.date}`);
check(s3.meetings.some(m => m.hostHouseholdId === nellie.householdId && m.date > nellieMeet.date && m.hostMode === 'pinned'), 'member got the partner\'s old week (trade)');
check(/traded weeks/.test(s3.log.at(-1).text), 'swap logged: ' + s3.log.at(-1).text);
await shot(G, '8-group-after-swap');

// leader sees it after a pull
await L.locator('.tabbar [data-tab="week"]').click();
await L.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(1500);
const weekTxt = await L.locator('#p-week').innerText();
check(/From the group/.test(weekTxt) && /traded weeks/.test(weekTxt), 'leader This Week shows the change from the group');
check(await L.evaluate(id => window.__bs.state.meetings.find(m => m.id === id).hostHouseholdId, nellieMeet.id) === bak.id, 'leader plan has the swap');
await shot(L, '9-week-after');

// leader changes the calendar, member sees it
await L.locator('.tabbar [data-tab="calendar"]').click(); await wait(200);
await L.locator('[data-act="addevent"]').click(); await wait(200);
await L.locator('#eDate').fill('2026-12-19'); await L.locator('#eTitle').fill('Christmas party'); await L.locator('#ePlace').fill('Church'); await L.locator('#sheetFoot .btn.primary').click(); await wait(2000);
await G.locator('#gRefresh').click(); await wait(800);
gt = await G.locator('#g').innerText();
check(/Christmas party/.test(gt), 'member sees the leader\'s new event');
check(/Test Newperson/.test(gt), 'member sees the new person in next in line');
// leader week sheet: someone else hosts (trade) from the app
await L.locator('.tabbar [data-tab="hosting"]').click(); await wait(200);
await L.locator('#p-hosting [data-act="week"]').nth(2).click(); await wait(200);
await L.locator('#sheetBody [data-act="pickhost"]').click(); await wait(200);
await shot(L, '10-pick-host');
await L.locator('#sheetClose').click();
await L.locator('.tabbar [data-tab="people"]').click(); await wait(200);
await L.locator('[data-act="addperson"]').click(); await wait(200);
await shot(L, '11-add-person');
await L.locator('#sheetClose').click();

console.log('\nerrors:', errors.length ? errors.join('\n') : 'none');
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
await browser.close();
