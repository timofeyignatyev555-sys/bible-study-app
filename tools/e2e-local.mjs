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
// leader navigation: home body views (list | cal | people) or the settings screen behind the gear
const go = async (p, v) => {
  if (v === 'settings') { if (!(await p.locator('#p-settings.on').count())) await p.locator('[data-act="tab"][data-tab="settings"]').click(); }
  else { if (await p.locator('#p-settings.on').count()) await p.locator('[data-act="tab"][data-tab="home"]').click(); await p.locator(`[data-act="view"][data-v="${v}"]`).click(); }
  await wait(250);
};

// ---- leader
const L = await mk(`if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', 1); localStorage.setItem('bs.worker', ${JSON.stringify(WORKER)}); ${WORKER.includes('localhost') ? `localStorage.setItem('bs.token', ${JSON.stringify(TOKEN)});` : ''} }`);
await L.goto(BASE + 'index.html' + (WORKER.includes('localhost') ? '' : '#token=' + TOKEN), { waitUntil: 'networkidle' });
await L.waitForSelector('#app:not(.hidden)', { timeout: 15000 });
await wait(800);
let hero = await L.locator('#p-home .hero').innerText();
console.log('HERO:', hero.replace(/\n+/g, ' | '));
check(/Host/i.test(hero) && /Change this week/.test(hero) && /Attendance/.test(hero), 'This Week hero has host + 2 buttons');
check(await L.locator('#p-home .hero .btn').count() === 2, 'only two buttons on the hero');
await shot(L, '1-week');
await L.locator('#p-home .hero [data-act="week"]').click(); await wait(300);
const ws = await L.locator('#sheetBody').innerText();
check(/Someone else hosts/.test(ws) && /can't host/.test(ws) && /No meeting this week/.test(ws), 'week sheet lists the plain actions');
await shot(L, '2-week-sheet');
await L.locator('#sheetClose').click();
await go(L, 'list'); await wait(300);
const ht = await L.locator('#viewBody').innerText();
check(/Schedule/i.test(ht) && /Next in line/i.test(ht) && / & .+\(/.test(ht), 'hosting tab: schedule, next in line, sibling label');
check(await L.locator('#viewBody [data-act="move"]').count() === 0, 'no queue arrows on hosting tab');
await shot(L, '3-hosting');
// group link
await go(L, 'settings'); await wait(200);
await L.locator('#p-settings [data-act="copygroup"], #p-settings [data-act="sharegroup"]').first().click(); await wait(800);
const gkey = await L.evaluate(() => localStorage.getItem('bs.groupKey'));
check(!!gkey, 'group key fetched'); await go(L, 'settings'); await wait(200);
await shot(L, '4-settings');
const glink = await L.evaluate(() => document.querySelector('#p-settings .mono')?.textContent);
console.log('LINK:', glink);
check(glink && glink.includes('/group/?k='), 'settings shows the group link');

// ---- member
const PIN = '4242';
const G = await mk(`localStorage.setItem('bs.worker', ${JSON.stringify(WORKER)});`);
await G.goto(glink, { waitUntil: 'networkidle' }); await wait(600);
// forget who this browser was, tap their name, confirm with their PIN (picks one if they have none yet)
const beMember = async hid => {
  await G.evaluate(() => localStorage.removeItem('bsg.me'));
  await G.reload({ waitUntil: 'networkidle' }); await wait(400);
  await G.locator('[data-act="view"][data-v="list"]').click(); await wait(200);
  await G.locator(`#g [data-act="hh"][data-id="${hid}"]`).first().click(); await wait(300);
  await G.locator('#sheetBody [data-me]').first().click(); await wait(600);
  await G.locator('#pinIn').fill(PIN); await G.locator('#sheetFoot .btn.primary').click(); await wait(800);
  await G.locator('#sheetClose').click(); await wait(150);
};
check(!/Who are you/.test(await G.locator('#g').innerText()) && /tap it to add your address/i.test(await G.locator('#g').innerText()), 'member lands straight on the schedule (no name picker)');
await shot(G, '5-group-picker');
const s0 = await server();
// the member is whoever hosts the second upcoming week; the swap partner hosts a later week (picked from the data, no names in the repo)
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const fut = s0.meetings.filter(m => m.date >= TODAY && m.status === 'on' && !m.location && m.hostHouseholdId).sort((a, b) => a.date < b.date ? -1 : 1);
const nellieMeet = fut[1];
const nellie = s0.people.find(p => p.householdId === nellieMeet.hostHouseholdId && p.active !== false);
const partnerH = fut[fut.length - 2].hostHouseholdId;
await G.locator(`#g [data-act="hh"][data-id="${nellie.householdId}"]`).first().click(); await wait(300);
let gt = await G.locator('#sheetBody').innerText();
check(/Hosting/.test(gt) && await G.locator('#sheetBody input').count() === 0 && await G.locator('#sheetBody [data-me]').count() > 0, 'tapping a name is read only until you confirm it is you');
console.log('MEMBER TURN:', gt.split('\n').slice(0, 8).join(' | '));
await shot(G, '6-group-name-read-only');
await G.locator('#sheetBody [data-me]').first().click(); await wait(600);
check(/pick a PIN/i.test(await G.locator('#sheetTitle').innerText()), 'the first time, a member picks a PIN');
await shot(G, '6b-group-pick-pin');
await G.locator('#pinIn').fill('12'); await G.locator('#sheetFoot .btn.primary').click(); await wait(300);
check(/4 numbers/.test(await G.locator('#pinErr').innerText()), 'a short PIN is refused on the page');
await G.locator('#pinIn').fill(PIN); await G.locator('#sheetFoot .btn.primary').click(); await wait(900);
gt = await G.locator('#sheetBody').innerText();
check(/Address/i.test(gt) && await G.locator('#hAddr').count() === 1, 'after the PIN, your own name opens for changes');
await shot(G, '6c-group-own-name');
check(await G.locator('[data-act="editmeeting"], [data-act="addevent"], .tabbar').count() === 0, 'member page has no editing of the calendar');
await G.locator('#hAddr').fill('100 Test Ave, Minneapolis'); await G.locator('#sheetFoot .btn.primary').click(); await wait(800);
let s1 = await server();
check(s1.households.find(h => h.id === nellie.householdId).address === '100 Test Ave, Minneapolis', 'member address saved to the cloud');

// leader makes an edit WITHOUT pulling first (conflict + merge path)
await L.evaluate(() => { const st = window.__bs.state; });
await go(L, 'people'); await wait(200);
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
await G.locator(`#g [data-act="hh"][data-id="${nellie.householdId}"]`).first().click(); await wait(300); await G.locator('#hSwap').click(); await wait(300);
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
await go(L, 'list');
await L.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(1500);
await L.locator('#recentA summary').click(); await wait(200);
const weekTxt = await L.locator('#p-home').innerText();
check(/Recent changes from the group/.test(weekTxt) && /traded weeks/.test(weekTxt), 'leader This Week shows the change from the group');
check(await L.evaluate(id => window.__bs.state.meetings.find(m => m.id === id).hostHouseholdId, nellieMeet.id) === bak.id, 'leader plan has the swap');
await shot(L, '9-week-after');

// leader changes the calendar, member sees it
await go(L, 'cal'); await wait(200);
await L.locator('[data-act="addevent"]').click(); await wait(200);
await L.locator('#eDate').fill('2026-12-19'); await L.locator('#eTitle').fill('Christmas party'); await L.locator('#ePlace').fill('Church'); await L.locator('#sheetFoot .btn.primary').click(); await wait(2000);
await G.locator('#gRefresh').click(); await wait(800);
gt = await G.locator('#g').innerText();
check(/Christmas party/.test(gt), 'member sees the leader\'s new event');
check(/Test Newperson/.test(gt), 'member sees the new person in next in line');
// leader week sheet: someone else hosts (trade) from the app
await go(L, 'list'); await wait(200);
await L.locator('#viewBody [data-act="week"]').nth(2).click(); await wait(200);
await L.locator('#sheetBody [data-act="pickhost"]').click(); await wait(200);
await shot(L, '10-pick-host');
await L.locator('#sheetClose').click();
await go(L, 'people'); await wait(200);
await L.locator('[data-act="addperson"]').click(); await wait(200);
await shot(L, '11-add-person');
await L.locator('#sheetClose').click();


// calendar views follow the list: swap, address, removal
const calCell = async (page, date) => page.locator('.cal [data-act="calday"]').filter({ has: page.locator('.num', { hasText: new RegExp('^' + Number(date.slice(8)) + '$') }) }).first().innerText();
const goMonth = async (page, date) => { const want = new Date(date + 'T12:00').toLocaleString('en-US', { month: 'long', year: 'numeric' }); for (let i = 0; i < 8; i++) { const h = await page.locator('.cal .nav h3').innerText(); if (h === want) return; const dir = new Date(date + 'T12:00') > new Date(h + ' 15') ? 1 : -1; await page.locator(`.cal [data-act="calnav"][data-dir="${dir}"]`).click(); await wait(150); } };
await G.locator('[data-act="view"][data-v="cal"]').click(); await wait(300);
await goMonth(G, nellieMeet.date);
const cellG = await calCell(G, nellieMeet.date);
check(/\S/.test(cellG) && !/No host/.test(cellG), `group calendar cell ${nellieMeet.date}: ${cellG.replace(/\n/g, ' ')}`);
await shot(G, '12-group-calendar');
await go(L, 'cal'); await wait(300);
await goMonth(L, nellieMeet.date);
const cellL = await calCell(L, nellieMeet.date);
check(cellL === cellG, `leader calendar shows the same host on ${nellieMeet.date} (${cellL.replace(/\n/g, ' ')})`);
await shot(L, '13-leader-calendar');
// leader removes the person hosting a later single-person week; both calendars re-plan
const s4 = await server();
const later = s4.meetings.filter(m => m.date > nellieMeet.date && m.hostMode === 'auto' && m.hostHouseholdId).sort((a, b) => a.date < b.date ? -1 : 1).find(m => s4.people.filter(p => p.householdId === m.hostHouseholdId).length === 1);
const victim = s4.people.find(p => p.householdId === later.hostHouseholdId);
await go(L, 'people'); await wait(200);
await L.locator(`[data-act="editperson"][data-id="${victim.id}"]`).click(); await wait(200);
await L.locator('#sheetFoot .btn.danger').click(); await wait(200); await L.locator('#sheetFoot .btn.danger').click(); await wait(2500);
const s5 = await server();
check(s5.meetings.find(m => m.id === later.id).hostHouseholdId !== later.hostHouseholdId, `removing a person re-plans ${later.date} in the cloud`);
await G.locator('#gRefresh').click(); await wait(900);
await goMonth(G, later.date);
const cellAfter = await calCell(G, later.date);
check(!cellAfter.includes(victim.name.split(' ')[0]), `group calendar no longer shows the removed person on ${later.date} (${cellAfter.replace(/\n/g, ' ')})`);

// phones + hold from the group page
const s6 = await server();
const heldMeet = s6.meetings.filter(m => m.date > TODAY && m.status === 'on' && !m.location && m.hostHouseholdId && m.hostMode === 'auto').sort((a, b) => a.date < b.date ? -1 : 1)[0];
const heldH = heldMeet.hostHouseholdId;
const heldP = s6.people.find(p => p.householdId === heldH && p.active !== false);
await beMember(heldH);
await G.locator(`#g [data-act="hh"][data-id="${heldH}"]`).first().click(); await wait(300);
await G.locator(`#sheetBody input.phone[data-pid="${heldP.id}"]`).fill('612-555-0199'); await G.locator('#sheetFoot .btn.primary').click(); await wait(900);
let s7 = await server();
check(s7.people.find(p => p.id === heldP.id).phone === '612-555-0199', 'member phone saved to the cloud');
await G.locator(`#g [data-act="hh"][data-id="${heldH}"]`).first().click(); await wait(300);
check(/call/.test(await G.locator('#sheetBody').innerText()), 'saved phone shows call/text links');
await G.locator('#hHold').click(); await wait(200);
await shot(G, '14-group-hold');
await G.locator('#sheetFoot .btn.primary').click(); await wait(900);
s7 = await server();
check(s7.households.find(h => h.id === heldH).hostStatus === 'unavailable', 'member put their household on hold');
check(!s7.meetings.some(m => m.date >= TODAY && m.hostHouseholdId === heldH), 'on-hold household is out of the schedule');
check(s7.meetings.find(m => m.id === heldMeet.id).hostHouseholdId && s7.meetings.find(m => m.id === heldMeet.id).hostHouseholdId !== heldH, `their week ${heldMeet.date} went to the next person`);
gt = await G.locator('#g').innerText();
check(/on hold/i.test(gt), 'group list shows "on hold"');
await L.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(1500);
check(await L.evaluate(id => window.__bs.state.households.find(h => h.id === id).hostStatus, heldH) === 'unavailable', 'leader app sees the hold');
check(await L.evaluate(id => window.__bs.state.people.find(p => p.id === id).phone, heldP.id) === '612-555-0199', 'leader app sees the phone');
await G.locator(`#g [data-act="hh"][data-id="${heldH}"]`).first().click(); await wait(300);
await G.locator('#hBack').click(); await wait(900);
s7 = await server();
check(s7.households.find(h => h.id === heldH).hostStatus === 'available' && s7.meetings.some(m => m.date >= TODAY && m.hostHouseholdId === heldH), 'can host again puts them back in the schedule');


// admin home: no tab bar, household sheet edits phones + members, add someone into a household
check(await L.locator('.tabbar').count() === 0, 'leader app has no bottom tab bar');
await go(L, 'list');
const lineH = await L.locator('#viewBody [data-act="edithh"]').first().getAttribute('data-id');
await L.locator(`#viewBody [data-act="edithh"][data-id="${lineH}"]`).first().click(); await wait(300);
const hsText = await L.locator('#sheetBody').innerText();
check(/phone/i.test(hsText) && /Who lives here/i.test(hsText) && /Add someone who lives here/.test(hsText), 'household sheet: phones, members, add someone');
const firstPhone = L.locator('#sheetBody input.hphone').first(); const phonePid = await firstPhone.getAttribute('data-pid');
await firstPhone.fill('651-555-0142'); await L.locator('#sheetFoot .btn.primary').click(); await wait(2200);
let s8 = await server();
check(s8.people.find(p => p.id === phonePid).phone === '651-555-0142', 'admin phone edit reached the cloud');
await L.locator(`#viewBody [data-act="edithh"][data-id="${lineH}"]`).first().click(); await wait(300);
await L.locator('#sheetBody [data-act="addto"]').click(); await wait(300);
check(await L.locator('#pHH').inputValue() === lineH, 'add-someone starts with "Lives with" set to that household');
await L.locator('#pName').fill('Test Sibling'); await L.locator('#sheetFoot .btn.primary').click(); await wait(2200);
s8 = await server();
check(s8.people.some(p => p.name === 'Test Sibling' && p.householdId === lineH), 'new sibling joined the household in the cloud');
await G.locator('#gRefresh').click(); await wait(900);
check((await G.locator('#g').innerText()).includes('Test (') || (await G.locator('#g').innerText()).includes(' & Test'), 'group page shows the new sibling in the household label');
await shot(L, '15-admin-home');

// ---------- birthdays on the calendar
const sB = await server();
const withBirthdays = sB.people.filter(p => p.birthday && p.active !== false);
check(withBirthdays.length >= 30, `people have birthdays in the cloud (${withBirthdays.length})`);
await G.locator('[data-act="view"][data-v="cal"]').click(); await wait(300);
const janBd = withBirthdays.find(p => p.birthday.startsWith('01-'));
await goMonth(G, `2027-${janBd.birthday}`);
check((await G.locator('.cal .nav h3').innerText()) === 'January 2027', 'calendar pages past the last meeting to January');
const janCell = G.locator(`.cal [aria-label^="2027-${janBd.birthday}"]`); // a birthday-only day, or a meeting day with a birthday in it
check(await janCell.count() === 1, `January shows the birthday on ${janBd.birthday}`);
await shot(G, '16-group-january-birthdays');
await janCell.click(); await wait(250);
check((await G.locator('#sheetBody').innerText()).includes(janBd.name), 'tapping a birthday day names the person');
await G.locator('#sheetClose').click();
check(/Birthdays in January/i.test(await G.locator('#g').innerText()), 'birthday list under the January calendar');

// ---------- a long season folds away; the names below stay within reach
await G.locator('[data-act="view"][data-v="list"]').click(); await wait(250);
const sF0 = await server();
const gF = (await (await fetch(WORKER + '/group', { headers: { 'X-Group-Key': gkey } })).json()).group;
const upF = gF.meetings.filter(m => !m.past);
if (upF.length > 30) {
  check(await G.locator('#later').count() === 1 && !(await G.locator('#later .row').first().isVisible()), 'group: later weeks start folded away');
  const foldTxt = await G.locator('#g').innerText();
  const hostLabels = [...new Set(upF.filter(m => m.status === 'on' && m.hostId).map(m => gF.households.find(h => h.id === m.hostId).label))];
  check(hostLabels.every(l => foldTxt.includes(l)), `group: all ${hostLabels.length} hosts can be found without opening them`);
  await shot(G, '34-group-fold');
  await G.locator('#later summary').click(); await wait(200);
  check(await G.locator('#later .row').first().isVisible(), 'group: tapping shows the later weeks');
  const lastUp = upF[upF.length - 1];
  check((await G.locator('#later').innerText()).toUpperCase().includes(new Date(lastUp.date + 'T12:00').toLocaleString('en-US', { month: 'long' }).toUpperCase()), 'group: they run to the end of the season');
  await G.locator('#gRefresh').click(); await wait(800);
  check(await G.locator('#later').evaluate(el => el.open), 'group: and stay open across a refresh');
  await G.locator('#later summary').click(); await wait(200);
  await G.locator('#gRefresh').click(); await wait(800);
  check(!(await G.locator('#later').evaluate(el => el.open)), 'group: closing stays closed');
}
await G.locator('[data-act="view"][data-v="cal"]').click(); await wait(250);

// ---------- the devotional as members see it
const sD = await server();
const nameOfId = (s, id) => s.people.find(p => p.id === id).name;
const dWeeks = sD.meetings.filter(m => m.date >= TODAY && m.status === 'on' && m.devoId && !m.devoOff).sort((a, b) => a.date < b.date ? -1 : 1);
check(dWeeks.length > 0, 'upcoming Fridays have a devotional');
await G.reload({ waitUntil: 'networkidle' }); await wait(500);
const heroG = await G.locator('#g .hero').innerText();
check(/Devotional/i.test(heroG) && heroG.includes(nameOfId(sD, dWeeks[0].devoId)), 'this-week card names who has the devotional');
await goMonth(G, dWeeks[0].date);
const cellD = await calCell(G, dWeeks[0].date);
check(cellD.includes(nameOfId(sD, dWeeks[0].devoId).split(' ')[0]), `calendar cell shows the devotional (${cellD.replace(/\n/g, ' ')})`);
await shot(G, '17-group-november');
await G.locator('.cal [data-act="calday"]').filter({ has: G.locator('.num', { hasText: new RegExp('^' + Number(dWeeks[0].date.slice(8)) + '$') }) }).first().click(); await wait(250);
const dayTxt = await G.locator('#sheetBody').innerText();
check(/Host/i.test(dayTxt) && /Devotional/i.test(dayTxt), 'day sheet shows host and devotional');
await shot(G, '18-group-day-sheet');
await G.locator('#sheetClose').click();
const aWoman = sD.people.find(p => p.gender === 'f');
check(!/\bMen\b/.test(await G.locator('#g').innerText()), 'no men category on the members page');
const gData = JSON.stringify(await (await fetch(WORKER + '/group', { headers: { 'X-Group-Key': gkey } })).json());
check(!gData.includes('gender') && !gData.includes('"men"') && !gData.includes('devoStatus'), 'gender, the men\'s list and the line never reach the members\' page data');
check(!gData.includes('group page PIN'), 'first-PIN log lines stay with the leader');

// ---------- a man moves his own devotional
const man1Week = dWeeks[1]; const man1 = sD.people.find(p => p.id === man1Week.devoId);
const partnerWeek = dWeeks[5]; const partner = sD.people.find(p => p.id === partnerWeek.devoId); // a trade takes his next Friday
await beMember(man1.householdId);
await G.locator(`#g [data-act="hh"][data-id="${man1.householdId}"]`).first().click(); await wait(300);
await shot(G, '19-group-man-sheet');
await G.locator(`#sheetBody [data-devoswap="${man1.id}"]`).click(); await wait(300);
await shot(G, '20-group-devo-swap');
check(!(await G.locator('#sheetBody').innerText()).includes(aWoman.name), 'a woman is not offered as a devotional swap');
await G.locator(`#sheetBody [data-to="${partner.id}"]`).click(); await wait(200);
check(/Record this swap/.test(await G.locator('#sheetTitle').innerText()), 'devotional swap asks for confirmation');
await G.locator('#sheetFoot .btn.primary').click(); await wait(900);
const sD2 = await server();
check(sD2.meetings.find(m => m.id === man1Week.id).devoId === partner.id && sD2.meetings.find(m => m.id === partnerWeek.id).devoId === man1.id, `devotional traded: ${man1Week.date} and ${partnerWeek.date}`);
check(/devotional/i.test(sD2.log.at(-1).text), 'swap logged: ' + sD2.log.at(-1).text);
await L.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(1500);
check(await L.evaluate(id => window.__bs.state.meetings.find(m => m.id === id).devoId, man1Week.id) === partner.id, 'leader app sees the devotional swap');
// on hold, then back
await G.locator(`#g [data-act="hh"][data-id="${man1.householdId}"]`).first().click(); await wait(300);
await G.locator(`#sheetBody [data-devohold="${man1.id}"]`).click(); await wait(250);
await shot(G, '21-group-devo-hold');
await G.locator('#sheetFoot .btn.primary').click(); await wait(900);
let sD3 = await server();
check(sD3.people.find(p => p.id === man1.id).devoStatus === 'unavailable' && !sD3.meetings.some(m => m.date >= TODAY && m.devoId === man1.id), 'a man on hold drops off the Fridays');
await G.locator(`#g [data-act="hh"][data-id="${man1.householdId}"]`).first().click(); await wait(300);
await G.locator(`#sheetBody [data-devoback="${man1.id}"]`).click(); await wait(900);
sD3 = await server();
check(sD3.people.find(p => p.id === man1.id).devoStatus === 'available', 'and comes back');

// ---------- limits: only your own things
const liveH = id => sD3.people.some(p => p.householdId === id && p.active !== false);
const other = sD3.households.find(h => h.id !== man1.householdId && liveH(h.id) && h.hostStatus === 'available');
await G.locator(`#g [data-act="hh"][data-id="${other.id}"]`).first().click(); await wait(300);
check(await G.locator('#sheetBody input').count() === 0 && await G.locator('#hSwap, #hHold, #hBack').count() === 0 && await G.locator('#sheetFoot .btn').count() === 0, 'someone else\'s name is read only, even when you are signed in');
check(await G.locator('#sheetBody [data-me]').count() === 0, 'and cannot be claimed from this phone');
await shot(G, '22-group-other-read-only');
await G.locator('#sheetClose').click();
check(await G.locator('[data-act="editmeeting"], [data-act="addevent"], [data-act="addperson"], [data-act="editperson"], [data-act="man"], [data-act="devoweek"], [data-act="savesettings"], [data-act="attendance"], #p-settings').count() === 0, 'no admin controls exist on the members page');
const meNow = await G.evaluate(() => JSON.parse(localStorage.getItem('bsg.me')));
const stateBefore = JSON.stringify(await server());
const tryAct = async body => (await fetch(WORKER + '/group/act', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Group-Key': gkey }, body: JSON.stringify(body) })).status;
check(await tryAct({ type: 'info', householdId: other.id, address: 'hijacked' }) === 401, 'server: no PIN, no change');
check(await tryAct({ type: 'info', householdId: other.id, address: 'hijacked', me: meNow }) === 400, 'server: your PIN does not open someone else\'s address');
check(await tryAct({ type: 'hold', householdId: other.id, me: meNow }) === 400, 'server: your PIN does not put someone else on hold');
check(await tryAct({ type: 'birthday', personId: meNow.id, birthday: '01-01', me: meNow }) === 400, 'server: birthdays are admin only');
check(JSON.stringify(await server()) === stateBefore, 'none of those changed anything in the cloud');
for (const p of ['/state', '/admin/group-key']) check((await fetch(WORKER + p, { headers: { 'X-Group-Key': gkey } })).status === 403, 'group key cannot open ' + p);

// ---------- wrong PIN, then a new phone
await G.evaluate(() => localStorage.removeItem('bsg.me'));
await G.reload({ waitUntil: 'networkidle' }); await wait(400);
await G.locator('[data-act="view"][data-v="list"]').click(); await wait(200);
await G.locator(`#g [data-act="hh"][data-id="${man1.householdId}"]`).first().click(); await wait(300);
await G.locator('#sheetBody [data-me]').first().click(); await wait(600);
check(!/pick a PIN/i.test(await G.locator('#sheetTitle').innerText()), 'a new phone asks for the PIN they already have');
await G.locator('#pinIn').fill('0000'); await G.locator('#sheetFoot .btn.primary').click(); await wait(600);
check(/not right/.test(await G.locator('#pinErr').innerText()), 'a wrong PIN is refused: ' + await G.locator('#pinErr').innerText());
await shot(G, '23-group-wrong-pin');
await G.locator('#pinIn').fill(PIN); await G.locator('#sheetFoot .btn.primary').click(); await wait(800);
check(await G.locator('#hAddr').count() === 1, 'the right PIN opens it');
await G.locator('#sheetClose').click();

// ---------- the admin side
await go(L, 'men'); await wait(300);
await L.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(1200);
const menTxt = await L.locator('#viewBody').innerText();
const sM = await server();
const allMen = sM.people.filter(p => p.gender === 'm' && p.active !== false);
const missingMen = allMen.filter(p => !menTxt.includes(p.name)).map(p => p.name);
check(!missingMen.length, `Men view lists every man (${allMen.length}${missingMen.length ? '; missing ' + missingMen.join(', ') : ''})`);
check(new RegExp(`All ${allMen.length} men`, 'i').test(menTxt) && await L.locator('#viewBody section [data-act="man"]').count() >= allMen.length, 'Men view has a list of all the men, one row each');
if (sM.meetings.filter(m => m.date >= TODAY).length > 30) {
  check(await L.locator('#laterM').count() === 1 && !(await L.locator('#laterM .row').first().isVisible()), 'Men view: later weeks start folded away');
  await L.locator('#laterM summary').click(); await wait(200);
  check(await L.locator('#laterM .row').first().isVisible(), 'Men view: tapping shows them');
  await L.locator('#laterM summary').click(); await wait(200);
  await go(L, 'list'); await wait(250);
  check(await L.locator('#laterH').count() === 1 && !(await L.locator('#laterH .row').first().isVisible()), 'Hosting list: later weeks start folded away');
  await go(L, 'men'); await wait(250);
}
check(!sM.log.some(e => /group page PIN/.test(e.text)), 'a first PIN is never written into the shared document');
check(/set their group page PIN/.test(await L.locator('#recentA').innerText()), 'the leader sees who set a PIN under recent changes');
const leakedWomen = sM.people.filter(p => p.gender === 'f').filter(p => menTxt.includes(p.name)).filter(f => !sM.meetings.some(m => m.date >= TODAY && (sM.households.find(h => h.id === m.hostHouseholdId) || {}).name === f.name)).map(p => p.name);
check(!leakedWomen.length, 'no women in the men\'s lists (a woman can show only as a Friday\'s host)' + (leakedWomen.length ? ': ' + leakedWomen.join(', ') : ''));
check(sM.people.filter(p => !p.gender && p.active !== false).every(p => menTxt.includes(p.name)), 'people not marked yet are listed to set');
await shot(L, '24-admin-men');
await L.locator('#viewBody [data-act="devoweek"]').first().click(); await wait(250);
const wkTxt = await L.locator('#sheetBody').innerText();
check(/Someone else says it/.test(wkTxt) && /can't do it/.test(wkTxt) && /No devotional this week/.test(wkTxt), 'admin week sheet has the devotional actions');
await shot(L, '25-admin-devo-week');
await L.locator('#sheetBody [data-act="pickdevo"]').click(); await wait(250);
await shot(L, '26-admin-pick-man');
await L.locator('#sheetClose').click();
// can't do it: the next man takes it and the first takes the week after
const firstWeek = sM.meetings.filter(m => m.date >= TODAY && m.devoId && m.status === 'on').sort((a, b) => a.date < b.date ? -1 : 1)[0];
await L.locator(`#viewBody [data-act="devoweek"][data-id="${firstWeek.id}"]`).click(); await wait(200);
await L.locator('#sheetBody [data-act="cantdevo"]').click(); await wait(2200);
const sM2 = await server();
check(sM2.meetings.find(m => m.id === firstWeek.id).devoId !== firstWeek.devoId, 'admin: can\'t do it moves the week to the next man');
check(sM2.meetings.some(m => m.date > firstWeek.date && m.devoId === firstWeek.devoId), 'and he takes a later Friday');
// no devotional this week, then back on
const secondWeek = sM2.meetings.filter(m => m.date > firstWeek.date && m.devoId && m.status === 'on').sort((a, b) => a.date < b.date ? -1 : 1)[0];
await L.locator(`#viewBody [data-act="devoweek"][data-id="${secondWeek.id}"]`).click(); await wait(200);
await L.locator('#sheetBody [data-act="devooff"]').click(); await wait(2200);
const gm = (await (await fetch(WORKER + '/group', { headers: { 'X-Group-Key': gkey } })).json()).group;
check(gm.meetings.find(m => m.id === secondWeek.id).devoId === null, 'admin: no devotional this week reaches members as nobody');
await L.locator(`#viewBody [data-act="devoweek"][data-id="${secondWeek.id}"]`).click(); await wait(200);
await L.locator('#sheetBody [data-act="devoon"]').click(); await wait(1500);
// a man's sheet: earlier in the line
const lineMan = await L.locator('#viewBody [data-act="man"]').last().getAttribute('data-id');
await L.locator(`#viewBody [data-act="man"][data-id="${lineMan}"]`).first().click(); await wait(250);
await shot(L, '27-admin-man-sheet');
const orderBefore = await L.evaluate(() => JSON.stringify(window.__bs.state.devotion.order));
await L.locator('#dUp').click(); await wait(400);
await L.locator('#sheetClose').click(); await wait(1600);
check(await L.evaluate(() => JSON.stringify(window.__bs.state.devotion.order)) !== orderBefore, 'admin: earlier moves a man in the line');
// person sheet: birthday + man/woman + PIN reset, all from the admin app
await go(L, 'people'); await wait(250);
check(/Birthday [A-Z][a-z]{2} \d+/.test(await L.locator('#viewBody').innerText()), 'People rows show the birthday under the name');
await shot(L, '28-admin-people');
const target = man1;
await L.locator(`#viewBody [data-act="editperson"][data-id="${target.id}"]`).click(); await wait(700);
await shot(L, '29-admin-person');
check(/^Set /.test(await L.locator('#pPinState').innerText()), 'admin sees the PIN is set: ' + await L.locator('#pPinState').innerText());
check(await L.locator('#pBMonth').inputValue() !== '', 'person sheet shows the birthday');
await L.locator('#pBMonth').selectOption('2'); await L.locator('#pBDay').selectOption('31');
await L.locator('#sheetFoot .btn.primary').click(); await wait(300);
check(/real month and day/.test(await L.locator('#toast').innerText()), 'Feb 31 is refused');
await L.locator('#pBMonth').selectOption('3'); await L.locator('#pBDay').selectOption('14');
await L.locator('#sheetFoot .btn.primary').click(); await wait(2200);
check((await server()).people.find(p => p.id === target.id).birthday === '03-14', 'admin birthday edit reached the cloud');
await G.locator('#gRefresh').click(); await wait(800);
await G.locator(`#g [data-act="hh"][data-id="${target.householdId}"]`).first().click(); await wait(300);
check(/Mar 14/.test(await G.locator('#sheetBody').innerText()), 'member sees the new birthday under their name');
await G.locator('#sheetClose').click();
// the admin resets the PIN while the member has their own sheet open; the save is refused, and tapping the name asks again
await G.locator(`#g [data-act="hh"][data-id="${target.householdId}"]`).first().click(); await wait(400);
check(await G.locator('#hAddr').count() === 1, 'the member has their own sheet open');
await L.locator(`#viewBody [data-act="editperson"][data-id="${target.id}"]`).click(); await wait(700);
await L.locator('#pPinReset').click(); await wait(900);
check(/Not set/.test(await L.locator('#pPinState').innerText()), 'admin reset clears the PIN');
await L.locator('#sheetClose').click();
await G.locator('#hAddr').fill('200 Reset Ave'); await G.locator('#sheetFoot .btn.primary').click(); await wait(900);
check(/PIN again/.test(await G.locator('#toast').innerText()), 'a save after a reset asks for the PIN again: ' + await G.locator('#toast').innerText());
check((await server()).households.find(h => h.id === target.householdId).address !== '200 Reset Ave', 'and that change did not go through');
await G.locator(`#g [data-act="hh"][data-id="${target.householdId}"]`).first().click(); await wait(400);
check(await G.locator('#hAddr').count() === 0 && await G.locator('#sheetBody [data-me]').count() > 0, 'and their name is read only until they confirm it again');
await G.locator('#sheetClose').click();
// a phone still signed in when the reset happens is caught the moment it taps the name
await beMember(target.householdId);
await G.locator(`#g [data-act="hh"][data-id="${target.householdId}"]`).first().click(); await wait(400);
check(await G.locator('#hAddr').count() === 1, 'they pick a new PIN and their own sheet opens again');
await G.locator('#sheetClose').click();
await fetch(WORKER + '/admin/pin/reset', { method: 'POST', headers: { 'X-App-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ personId: target.id }) });
await G.locator(`#g [data-act="hh"][data-id="${target.householdId}"]`).first().click(); await wait(500);
check(await G.locator('#hAddr').count() === 0 && /PIN again/.test(await G.locator('#toast').innerText()), 'a phone signed in before a reset is asked again as soon as it taps the name');
await G.locator('#sheetClose').click();
// marking someone not a man takes them out of the line
await L.locator(`#viewBody [data-act="editperson"][data-id="${target.id}"]`).click(); await wait(400);
await L.locator('#pGender [data-v="f"]').click(); await L.locator('#sheetFoot .btn.primary').click(); await wait(2200);
check(!(await server()).meetings.some(m => m.date >= TODAY && m.devoId === target.id), 'marking someone not a man takes them off the Fridays');
await L.locator(`#viewBody [data-act="editperson"][data-id="${target.id}"]`).click(); await wait(400);
await L.locator('#pGender [data-v="m"]').click(); await L.locator('#sheetFoot .btn.primary').click(); await wait(1500);
// add a man through the admin app: he joins the line
await L.locator('[data-act="addperson"]').click(); await wait(250);
await L.locator('#pName').fill('Test Brother'); await L.locator('#pGender [data-v="m"]').click();
await L.locator('#pBMonth').selectOption('12'); await L.locator('#pBDay').selectOption('24');
await L.locator('#sheetFoot .btn.primary').click(); await wait(2200);
const sN = await server(); const newMan = sN.people.find(p => p.name === 'Test Brother');
check(newMan && newMan.birthday === '12-24' && sN.devotion.order.includes(newMan.id), 'a man added in the admin app joins the devotional line');
// a household with a woman and a man: signed in as her, the sheet names him instead of saying "me"
const sF = await server();
const mixed = sF.households.find(h => { const ps = sF.people.filter(p => p.householdId === h.id && p.active !== false); return ps.some(p => p.gender === 'f') && ps.some(p => p.gender === 'm'); });
const mixedMan = sF.people.find(p => p.householdId === mixed.id && p.gender === 'm');
const mixedWoman = sF.people.find(p => p.householdId === mixed.id && p.gender === 'f');
await G.evaluate(() => localStorage.removeItem('bsg.me'));
await G.reload({ waitUntil: 'networkidle' }); await wait(400);
await G.locator('[data-act="view"][data-v="list"]').click(); await wait(200);
await G.locator(`#g [data-act="hh"][data-id="${mixed.id}"]`).first().click(); await wait(300);
await G.locator(`#sheetBody [data-me="${mixedWoman.id}"]`).click(); await wait(600);
await G.locator('#pinIn').fill(PIN); await G.locator('#sheetFoot .btn.primary').click(); await wait(800);
const holdLabel = await G.locator(`#sheetBody [data-devohold="${mixedMan.id}"]`).innerText();
check(holdLabel.includes(mixedMan.name.split(' ')[0]) && !/\bme\b/.test(holdLabel), 'a sister signed in sees her brother named on his devotional: ' + holdLabel);
await shot(G, '32-group-mixed-household');
await G.locator('#sheetClose').click();
// a meeting day that also has a birthday
const onMeeting = sF.people.filter(p => p.birthday).map(p => ({ p, date: '2026-' + p.birthday })).find(x => sF.meetings.some(m => m.date === x.date && m.status === 'on'));
await G.locator('[data-act="view"][data-v="cal"]').click(); await wait(300);
await goMonth(G, onMeeting.date);
const bdMeet = await calCell(G, onMeeting.date);
check(bdMeet.includes(onMeeting.p.name.split(' ')[0]), `a meeting day shows the birthday too (${bdMeet.replace(/\n/g, ' ')})`);
await shot(G, '33-group-birthday-on-meeting-day');
await goMonth(G, TODAY);
// the admin calendar list gives the devotional its own line, and the person sheet reads cleanly
await go(L, 'cal'); await wait(300);
const calRow = L.locator('#viewBody .list [data-act="week"]').first();
check(await calRow.locator('.s').count() === 2 && /^Devotional: /.test(await calRow.locator('.s').nth(1).innerText()), 'admin calendar row has the devotional on its own line');
await go(L, 'people'); await wait(250);
await L.locator(`#viewBody [data-act="editperson"][data-id="${mixedMan.id}"]`).click(); await wait(400);
const lineBtn = await L.locator('#sheetBody [data-act="man"]').innerText();
check(/^Devotional: /.test(lineBtn) && !/devotional .*devotional/i.test(lineBtn), 'person sheet line button reads cleanly: ' + lineBtn);
await L.locator('#sheetClose').click();
// the Season end step in Settings: later gives every man a Friday; earlier drops only weeks nobody touched
await go(L, 'settings'); await wait(200);
await L.locator('#setEnd').fill('2026-12-31'); await L.locator('[data-act="savesettings"]').click(); await wait(2200);
await go(L, 'settings'); await wait(200);
await L.locator('#setEnd').fill('2027-03-12'); await L.locator('[data-act="savesettings"]').click(); await wait(2200);
const sE = await server();
const menE = sE.people.filter(p => p.gender === 'm' && p.active !== false);
const gotE = new Set(sE.meetings.filter(m => m.date >= TODAY && m.status === 'on' && !m.devoOff && m.devoId).map(m => m.devoId));
check(menE.every(p => gotE.has(p.id)), `a later season end gives all ${menE.length} men a Friday`);
check(sE.meetings.filter(m => m.date > '2026-12-31').every(m => m.hostHouseholdId && m.devoId), 'and every added Friday has a host and a devotional');
await go(L, 'men'); await wait(300);
check(/Every man is already on the schedule/.test(await L.locator('#viewBody').innerText()), 'and the Men tab says so');
const janWeek = sE.meetings.find(m => m.date === '2027-01-08');
const janHolder = janWeek.devoId;
await L.locator(`#viewBody [data-act="devoweek"][data-id="${janWeek.id}"]`).click(); await wait(250);
await L.locator('#sheetBody [data-act="pickdevo"]').click(); await wait(250);
await L.locator('#sheetBody [data-pick]').first().click(); await wait(2200);
const sE2 = await server();
check(sE2.meetings.find(m => m.id === janWeek.id).devoMode === 'pinned' && sE2.meetings.find(m => m.id === janWeek.id).devoId !== janHolder, 'a devotional can be swapped into January');
const fridaysKept = sE2.meetings.filter(m => m.date <= '2026-12-31').map(m => `${m.id}:${m.hostHouseholdId}:${m.status}`).join();
await go(L, 'settings'); await wait(200);
await L.locator('#setEnd').fill('2026-12-31'); await L.locator('[data-act="savesettings"]').click(); await wait(2200);
const sE3 = await server();
const afterSeason = sE3.meetings.filter(m => m.date > '2026-12-31');
check(afterSeason.some(m => m.id === janWeek.id), 'shrinking the season keeps a week with a swapped devotional');
check(afterSeason.length && afterSeason.every(m => m.devoMode === 'pinned' || m.hostMode === 'pinned'), `and drops the weeks nobody touched (${afterSeason.length} kept of ${sE2.meetings.filter(m => m.date > '2026-12-31').length})`);
check(sE3.meetings.filter(m => m.date <= '2026-12-31').map(m => `${m.id}:${m.hostHouseholdId}:${m.status}`).join() === fridaysKept, 'and this season\'s weeks and hosts are untouched');
// narrow phone
await G.setViewportSize({ width: 360, height: 740 }); await G.locator('[data-act="view"][data-v="cal"]').click(); await wait(300);
check(await G.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll at 360px');
await shot(G, '30-group-360');
await L.setViewportSize({ width: 360, height: 740 }); await go(L, 'men'); await wait(300);
check(await L.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'admin Men view: no sideways scroll at 360px');
check(await L.evaluate(() => [...document.querySelectorAll('.seg.four button')].every(b => b.scrollWidth <= b.clientWidth + 1 && b.offsetHeight < 50)), 'admin switcher stays on one line at 360px');
await shot(L, '31-admin-men-360');

console.log('\nerrors:', errors.length ? errors.join('\n') : 'none');
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
await browser.close();
process.exitCode = fails.length || errors.length ? 1 : 0;
