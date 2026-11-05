// Group page: what members see from the shared link. Hosting schedule, calendar, birthdays and who has each devotional.
// Looking needs nothing: you scroll to a name and tap it. Changing anything means tapping your own name and typing your PIN (the worker
// enforces this), and then only your own household: address, phones, hosting week, hold and devotional. Everything else is the leader's,
// in the admin app. Talks to the worker with the group key, never the leader token.
import { calendarHTML, shortName, shiftMonth, startMonth, personShort, birthdaysIn, fmtBirthday } from './calgrid.js';

const WORKER = localStorage.getItem('bs.worker') || 'https://bible-study-sync.ophir-marketing-agency.workers.dev';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = iso => iso.split('-').map(Number);
const dow = iso => { const [y, m, d] = parts(iso); return new Date(y, m - 1, d).getDay(); };
const fmtShort = iso => { const [, m, d] = parts(iso); return `${MON[m - 1]} ${d}`; };
const fmtLong = iso => { const [, m, d] = parts(iso); return `${DOW[dow(iso)]}, ${MONL[m - 1]} ${d}`; };
const fmtTime = t => { if (!t) return ''; const [h, mi] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const fmtStamp = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const mapsUrl = a => 'https://maps.google.com/?q=' + encodeURIComponent(a);
const addDays = (iso, n) => { const [y, m, d] = parts(iso); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem('bsg.' + k); if (v === null) localStorage.removeItem('bsg.' + k); else localStorage.setItem('bsg.' + k, v); } catch { return null; } };

let key = new URLSearchParams(location.search).get('k') || pref('key');
if (key) pref('key', key);
let g = null; try { g = JSON.parse(pref('cache') || 'null'); } catch {}
let me = null; try { me = JSON.parse(pref('me') || 'null'); } catch {} // { id, token }: who this device confirmed itself as, with their PIN
let netState = 'loading'; // loading | ok | offline | forbidden
let calMonth = null;
document.documentElement.dataset.theme = localStorage.getItem('bs.theme') === 'dark' ? 'dark' : 'light';
const setMe = v => { me = v; pref('me', v ? JSON.stringify(v) : null); };

let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2800); }
function openSheet(title, body, foot = []) {
  $('#sheetTitle').textContent = title; $('#sheetBody').innerHTML = body;
  const f = $('#sheetFoot');
  f.innerHTML = foot.map((b, i) => `<button class="btn ${b.cls || ''}" data-foot="${i}">${esc(b.label)}</button>`).join('');
  f.classList.toggle('hidden', !foot.length);
  f.querySelectorAll('[data-foot]').forEach(btn => btn.addEventListener('click', () => foot[+btn.dataset.foot].onClick()));
  $('#backdrop').classList.add('on'); $('#sheet').classList.add('on'); document.body.classList.add('modal'); $('#sheetBody').scrollTop = 0;
}
function closeSheet() { $('#backdrop').classList.remove('on'); $('#sheet').classList.remove('on'); document.body.classList.remove('modal'); }

async function call(path, body) {
  const res = await fetch(WORKER + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Group-Key': key }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw Object.assign(new Error('forbidden'), { code: 'forbidden' });
  if (res.status === 401) throw Object.assign(new Error(data.error || 'Please tap your name and type your PIN again.'), { code: 'whoami' });
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { code: 'http' });
  return data;
}
const failText = e => e.code === 'forbidden' ? 'This link no longer works. Ask Tim for the new one.' : (e.code === 'http' ? e.message : 'No connection. Try again.');
function take(group) { g = group; pref('cache', JSON.stringify(g)); if (me && !person(me.id)) setMe(null); netState = 'ok'; render(); }
async function refresh(quiet) {
  if (!key) { render(); return; }
  try { take((await call('/group')).group); if (!quiet) toast('Up to date'); }
  catch (e) { netState = e.code === 'forbidden' ? 'forbidden' : 'offline'; render(); }
}
async function act(body, ok) {
  try { take((await call('/group/act', { ...body, me })).group); closeSheet(); toast(ok); return true; }
  catch (e) {
    if (e.code === 'whoami') { setMe(null); closeSheet(); render(); toast(e.message); return false; } // Tim reset the PIN, or this device's copy is gone
    toast(failText(e)); return false;
  }
}

// ---------- model helpers over the projection
const hh = id => g.households.find(h => h.id === id) || null;
const person = id => g.people.find(p => p.id === id) || null;
const upcoming = () => g.meetings.filter(m => !m.past);
const isHome = m => m.status === 'on' && !m.place;
const nextDate = hid => upcoming().find(x => isHome(x) && x.hostId === hid) || null;
function where(m) { if (m.place) return m.place.name || 'Somewhere else'; const h = hh(m.hostId); return h ? h.label : (m.status === 'on' ? 'Host not set yet' : ''); }
function addrOf(m) { if (m.place) return m.place.address; const h = hh(m.hostId); return h ? h.address : ''; }
const man = id => (g.men || []).find(x => x.id === id) || null;
const nextDevo = pid => upcoming().find(x => x.status === 'on' && x.devoId === pid) || null;
const devoOf = m => (m.status === 'on' && m.devoId ? person(m.devoId) : null);
const firstName = p => p.name.split(' ')[0];
// This device is confirmed as someone in this household, so it may change this household's things.
const mine = hid => !!me && g.people.some(p => p.id === me.id && p.householdId === hid);
const telUrl = p => 'tel:' + p.replace(/[^0-9+]/g, '');
const smsUrl = p => 'sms:' + p.replace(/[^0-9+]/g, '');

// ---------- render
function render() {
  const dot = $('#gDot'), st = $('#gStatus');
  const labels = { loading: ['warn', 'loading'], ok: ['ok', 'up to date'], offline: ['warn', 'offline, showing last copy'], forbidden: ['crit', 'link no longer works'] };
  const [c, l] = labels[netState]; dot.className = 'dot ' + c; st.textContent = l;
  const main = $('#g');
  if (!key) { main.innerHTML = `<div class="card"><h2>Open the link from Tim</h2><p class="muted" style="margin-top:6px">This page needs the group link that was shared in the chat.</p></div>`; return; }
  if (netState === 'forbidden') { main.innerHTML = `<div class="card"><h2>This link was reset</h2><p class="muted" style="margin-top:6px">Ask Tim for the new group link.</p></div>`; return; }
  if (!g) { main.innerHTML = netState === 'offline' ? `<div class="card"><h2>No connection</h2><p class="muted" style="margin-top:6px">Connect to the internet and tap Refresh.</p></div>` : `<div class="empty">Loading…</div>`; return; }
  $('#gName').textContent = g.name; document.title = g.name + ' · Hosting';
  const view = pref('view') || 'list';
  let html = renderThisWeek() + `<div class="notice info">Find your name and tap it to add your address and phone. Can't host your week or say your devotional? Tap your name too.</div>
    <div class="seg"><button data-act="view" data-v="list" aria-pressed="${view === 'list'}">Hosting list</button><button data-act="view" data-v="cal" aria-pressed="${view === 'cal'}">Calendar</button></div>`;
  html += view === 'cal' ? renderCalendar() : renderSchedule();
  // collapsed like "Earlier weeks"; stays open across refreshes once opened
  if (g.log && g.log.length) html += `<details class="adv" id="recent" ${pref('recentOpen') ? 'open' : ''}><summary>Recent changes (${Math.min(5, g.log.length)})</summary><div class="list" style="margin-top:8px">${g.log.slice().reverse().slice(0, 5).map(e => `<div class="row"><div class="main"><div class="t" style="font-weight:500">${esc(e.text)}</div><div class="s">${fmtStamp(e.at)}</div></div></div>`).join('')}</div></details>`;
  main.innerHTML = html;
}

function renderThisWeek() {
  const m = upcoming()[0]; if (!m) return '';
  const today = g.today;
  const when = m.date === today ? 'Tonight' : (m.date <= addDays(today, 6) ? 'This ' + DOW[dow(m.date)] : 'Next meeting');
  const a = addrOf(m);
  if (m.status !== 'on') return `<div class="card hero off"><span class="eyebrow">${when}</span><div class="date">${fmtLong(m.date)}</div><div class="host muted" style="margin-top:6px">No meeting this week</div></div>`;
  const d = devoOf(m);
  return `<div class="card hero"><span class="eyebrow">${when} · ${fmtTime(m.time)}</span><div class="date">${fmtLong(m.date)}</div>
    ${m.title ? `<div class="evt">${esc(m.title)}</div>` : ''}
    <div class="who"><span class="lbl">${m.place ? 'At' : 'Host'}</span><span class="host">${esc(where(m))}</span></div>
    <div class="addr">${a ? `<a href="${mapsUrl(a)}" target="_blank" rel="noopener">${esc(a)}</a>` : '<span class="dim">Address not added yet</span>'}</div>
    ${d ? `<div class="who sub"><span class="lbl">Devotional</span><span class="host">${esc(d.name)}</span></div>` : ''}
    ${m.topic ? `<div class="meta"><span>${esc(m.topic)}</span></div>` : ''}</div>`;
}

// A week. On the hosting list home weeks are tappable (opens that household); under the calendar every week that is on opens its day.
function row(m, inCal) {
  const a = m.status === 'on' ? addrOf(m) : '';
  const tappable = inCal ? m.status === 'on' : (isHome(m) && m.hostId && !m.past);
  const title = m.status !== 'on' ? '<span class="muted">No meeting</span>' : `${m.title ? esc(m.title) + ' · ' : ''}${esc(where(m))}`;
  const sub = m.status !== 'on' ? '&nbsp;' : (a ? esc(a) : (isHome(m) && m.hostId ? (m.past ? '' : '<span class="warn-text">tap to add address</span>') : fmtTime(m.time)));
  const d = inCal ? devoOf(m) : null;
  const inner = `<div class="when"><b>${fmtShort(m.date)}</b>${DOW[dow(m.date)].slice(0, 3)}</div><div class="main"><div class="t">${title}</div><div class="s">${sub || '&nbsp;'}</div>${d ? `<div class="s">Devotional: ${esc(d.name)}</div>` : ''}</div>${m.status === 'on' && m.kind === 'event' ? '<div class="k"><span class="chip info">event</span></div>' : (tappable ? '<div class="k">›</div>' : '')}`;
  const attrs = inCal ? `data-act="calday" data-id="${m.id}"` : `data-act="hh" data-id="${m.hostId}"`;
  return tappable ? `<button class="row tap ${m.past ? 'past' : ''}" ${attrs}>${inner}</button>` : `<div class="row ${m.past ? 'past' : ''}">${inner}</div>`;
}
const hhRow = (h, lead) => `<button class="row tap" data-act="hh" data-id="${h.id}">${lead}<div class="main"><div class="t">${esc(h.label)}${h.status !== 'available' ? ` <span class="chip warn">${esc(h.status === 'never' ? 'not hosting' : (h.until ? 'on hold until ' + fmtShort(h.until) : 'on hold'))}</span>` : ''}</div><div class="s">${h.address ? esc(h.address) : '<span class="warn-text">tap to add address</span>'}</div></div><div class="k">›</div></button>`;

function renderSchedule() {
  const up = upcoming(), past = g.meetings.filter(m => m.past);
  let html = `<section><h2>Schedule</h2>`;
  let cur = '';
  for (const m of up) {
    const mk = m.date.slice(0, 7);
    if (mk !== cur) { if (cur) html += '</div>'; cur = mk; const [y, mo] = parts(m.date); html += `<div class="eyebrow month">${MONL[mo - 1]} ${y}</div><div class="list">`; }
    html += row(m);
  }
  if (cur) html += '</div>'; else html += '<div class="list"><div class="empty">Nothing scheduled yet.</div></div>';
  html += '</section>';
  if (g.nextInLine.length) html += `<section><h2>Next in line</h2><p class="dim">Who hosts after the last scheduled week, in order.</p><div class="list">${g.nextInLine.map((id, i) => hhRow(hh(id), `<div class="n">${i + 1}</div>`)).join('')}</div></section>`;
  // everyone else (not hosting right now) still needs a place to tap their name
  const shown = new Set([...up.map(m => m.hostId), ...g.nextInLine]);
  const rest = g.households.filter(h => !shown.has(h.id) && g.people.some(p => p.householdId === h.id)).sort((a, b) => a.label.localeCompare(b.label));
  if (rest.length) html += `<section><h2>Not hosting right now</h2><div class="list">${rest.map(h => hhRow(h, '')).join('')}</div></section>`;
  if (past.length) html += `<details class="adv"><summary>Earlier weeks (${past.length})</summary><div class="list" style="margin-top:8px">${past.slice().reverse().map(m => row(m)).join('')}</div></details>`;
  return html;
}

// Month view: the same weeks as the list, drawn as a calendar, with who has the devotional and whose birthday it is. Tap a day for details.
function renderCalendar() {
  const names = g.people.map(p => p.name);
  const rows = g.meetings.map(m => {
    const h = hh(m.hostId);
    const short = m.place ? (m.title || m.place.name || 'Elsewhere') : (m.title || (h ? shortName(h.label) : 'No host'));
    const d = devoOf(m);
    return { id: m.id, date: m.date, status: m.status, kind: m.kind, short, devo: d ? personShort(d.name, names) : '', past: m.past, noAddr: isHome(m) && !!h && !h.address };
  });
  if (!calMonth) calMonth = startMonth(rows, g.today);
  const inMonth = g.meetings.filter(m => m.date.slice(0, 7) === calMonth);
  const bds = birthdaysIn(calMonth, g.people);
  const bdRow = b => `<button class="row tap" data-act="hh" data-id="${b.householdId}"><div class="when"><b>${fmtShort(b.date)}</b>${DOW[dow(b.date)].slice(0, 3)}</div><div class="main"><div class="t">${esc(b.name)}</div></div><div class="k">›</div></button>`;
  return `<section>${calendarHTML(calMonth, rows, g.today, bds)}${inMonth.length ? `<div class="list">${inMonth.map(m => row(m, true)).join('')}</div>` : '<p class="dim">No meetings this month.</p>'}
    ${bds.length ? `<div class="eyebrow month">Birthdays in ${MONL[parts(calMonth)[1] - 1]}</div><div class="list" id="bdList">${bds.map(bdRow).join('')}</div>` : ''}</section>`;
}
const nameRow = (lbl, name, hid) => `<button class="row tap" data-act="hh" data-id="${hid}"><div class="main"><div class="eyebrow">${esc(lbl)}</div><div class="t">${esc(name)}</div></div><div class="k">›</div></button>`;
function daySheet(mid) {
  const m = g.meetings.find(x => x.id === mid); if (!m) return;
  const bds = birthdaysIn(m.date.slice(0, 7), g.people).filter(b => b.date === m.date);
  const bdRows = bds.map(b => nameRow('Birthday', b.name, b.householdId)).join('');
  if (m.status !== 'on') { openSheet(fmtLong(m.date), `<p class="muted">No meeting this week.</p>${bdRows ? `<div class="list">${bdRows}</div>` : ''}`); return; }
  const a = addrOf(m), h = m.place ? null : hh(m.hostId), d = devoOf(m);
  const host = m.place ? `<div class="row"><div class="main"><div class="eyebrow">At</div><div class="t">${esc(where(m))}</div></div></div>`
    : h ? nameRow('Host', h.label, h.id) : `<div class="row"><div class="main"><div class="eyebrow">Host</div><div class="t">${esc(where(m))}</div></div></div>`;
  openSheet(fmtLong(m.date), `${m.title ? `<div class="evt">${esc(m.title)}</div>` : ''}
    <div class="muted">${a ? `<a href="${mapsUrl(a)}" target="_blank" rel="noopener">${esc(a)}</a> · ` : ''}${fmtTime(m.time)}</div>
    ${m.topic ? `<p class="dim">${esc(m.topic)}</p>` : ''}
    <div class="list">${host}${d ? nameRow('Devotional', d.name, d.householdId) : ''}${bdRows}</div>`);
}
function birthdaySheet(iso) {
  const bds = birthdaysIn(iso.slice(0, 7), g.people).filter(b => b.date === iso);
  openSheet(fmtLong(iso), `<div class="list">${bds.map(b => nameRow('Birthday', b.name, b.householdId)).join('')}</div>`);
}

// ---------- tapping a name: everyone can look; only your own name opens for changes
const holdText = h => h.status === 'never' ? 'Not hosting' : (h.status === 'unavailable' ? (h.until ? `On hold until ${fmtShort(h.until)}` : 'On hold for now') : '');
function hostingLine(h) {
  const next = nextDate(h.id), pos = g.nextInLine.indexOf(h.id);
  return next ? `Hosting <b>${fmtLong(next.date)}</b> at ${fmtTime(next.time)}${next.title ? ' · ' + esc(next.title) : ''}`
    : h.status === 'unavailable' || h.status === 'never' ? esc(holdText(h)) : pos >= 0 ? `#${pos + 1} in line after the last scheduled week` : 'Not scheduled yet';
}
function hhSheet(hid) { const h = hh(hid); if (h) (mine(hid) ? ownSheet : viewSheet)(h); }

// Someone else's name, or yours before you confirm it: read only.
function viewSheet(h) {
  const people = g.people.filter(p => p.householdId === h.id);
  const rows = people.map(p => {
    const d = man(p.id) ? nextDevo(p.id) : null;
    const facts = [p.birthday ? 'Birthday ' + fmtBirthday(p.birthday) : '', d ? 'Devotional ' + fmtShort(d.date) : ''].filter(Boolean).join(' · ');
    return `<div class="row"><div class="main"><div class="t">${esc(p.name)}</div>${facts ? `<div class="s wrap">${esc(facts)}</div>` : ''}${p.phone ? `<div class="s wrap"><a href="${telUrl(p.phone)}">${esc(p.phone)}</a> · <a href="${smsUrl(p.phone)}">text</a></div>` : ''}</div></div>`;
  }).join('');
  const who = me && person(me.id);
  openSheet(h.label, `
    <p class="muted">${hostingLine(h)}</p>
    <p>${h.address ? `<a href="${mapsUrl(h.address)}" target="_blank" rel="noopener">${esc(h.address)}</a>` : '<span class="dim">No address added yet</span>'}</p>
    <div class="list">${rows}</div>
    ${who ? `<p class="dim">This phone is set to ${esc(who.name)}, so you can only change your own things. <button class="linkbtn" id="vOut">Not ${esc(firstName(who))}?</button></p>`
      : `<div class="notice info">Is this you? Confirm it to change your address, phone, hosting week or devotional.</div>
         ${people.map(p => `<button class="btn primary" style="width:100%" data-me="${esc(p.id)}">${people.length > 1 ? "I'm " + esc(firstName(p)) : 'This is me'}</button>`).join('')}`}`);
  $('#sheetBody').querySelectorAll('[data-me]').forEach(b => b.addEventListener('click', () => pinSheet(b.dataset.me, h.id)));
  if ($('#vOut')) $('#vOut').addEventListener('click', () => { setMe(null); hhSheet(h.id); });
}

async function pinSheet(pid, hid) {
  const p = person(pid); if (!p) return;
  let pinSet;
  try { pinSet = (await call('/group/me', { personId: pid })).pinSet; } catch (e) { toast(failText(e)); return; }
  const send = async () => {
    const pin = ($('#pinIn').value || '').trim();
    const err = $('#pinErr');
    if (!/^\d{4}$/.test(pin)) { err.textContent = 'A PIN is 4 numbers.'; err.classList.remove('hidden'); return; }
    try {
      const r = await call('/group/me', { personId: pid, pin });
      setMe({ id: pid, token: r.token });
      hhSheet(hid);
      toast(pinSet ? `Hi ${firstName(p)}` : 'PIN saved. This phone remembers you.');
    } catch (e) { err.textContent = failText(e); err.classList.remove('hidden'); $('#pinIn').value = ''; }
  };
  openSheet(pinSet ? `Hi ${firstName(p)}` : `Hi ${firstName(p)}, pick a PIN`, `
    <p class="muted">${pinSet ? 'Type your 4-number PIN.' : 'Pick any 4 numbers. It keeps anyone else from changing your address, phone, hosting week or devotional.'}</p>
    <div class="field"><label for="pinIn">PIN</label><input id="pinIn" class="pinin ${pinSet ? 'mask' : ''}" type="tel" inputmode="numeric" maxlength="4" autocomplete="off" autocorrect="off"></div>
    <div class="err hidden" id="pinErr"></div>
    <p class="dim">${pinSet ? 'Forgot it? Message Tim to reset it.' : 'This phone will remember you, so you only need it again on another phone. Forgot it later? Message Tim to reset it.'}</p>`,
    [{ label: pinSet ? 'Continue' : 'Save my PIN', cls: 'primary', onClick: send }, { label: 'Back', onClick: () => viewSheet(hh(hid)) }]);
  $('#pinIn').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  $('#pinIn').focus();
}

// Your own name: address, phones, hosting week, hold, and your devotional.
function ownSheet(h) {
  const people = g.people.filter(p => p.householdId === h.id);
  const next = nextDate(h.id);
  const held = h.status === 'unavailable';
  const first = h.label.split(' (')[0];
  const bdays = people.filter(p => p.birthday).map(p => (people.length > 1 ? firstName(p) + ' ' : '') + fmtBirthday(p.birthday));
  const menHere = people.filter(p => man(p.id));
  const devo = menHere.map(p => {
    // the household shares one sheet, so name the man unless he is the one holding the phone
    const mn = man(p.id), d = nextDevo(p.id), who = p.id === me.id ? '' : esc(firstName(p));
    const hold = mn.status === 'unavailable';
    const line = d ? `${who ? who + ': ' : ''}<b>${fmtLong(d.date)}</b>`
      : mn.status === 'never' ? `${who ? who + ': ' : ''}Not in the devotional line`
      : hold ? `${who ? who + ': ' : ''}On hold${mn.until ? ' until ' + fmtShort(mn.until) : ''}`
      : `${who ? who + ': ' : ''}In line, not on the calendar yet`;
    return `<p class="muted">${line}</p>
      ${d ? `<button class="btn" style="width:100%" data-devoswap="${esc(p.id)}" data-mid="${esc(d.id)}">${who ? who + " can't" : "Can't"} say it ${fmtShort(d.date)}?</button>` : ''}
      ${mn.status === 'never' ? '' : hold
        ? `<button class="btn" style="width:100%" data-devoback="${esc(p.id)}">${who ? who + ' can' : 'I can'} say devotionals again</button>`
        : `<button class="btn ghost" style="width:100%" data-devohold="${esc(p.id)}">Put ${who || 'me'} on hold from devotionals</button>`}`;
  }).join('');
  openSheet(h.label, `
    <p class="muted">${hostingLine(h)}</p>
    ${bdays.length ? `<p class="dim">Birthday${bdays.length > 1 ? 's' : ''}: ${esc(bdays.join(' · '))}</p>` : ''}
    <div class="field"><label for="hAddr">Address</label><input id="hAddr" value="${esc(h.address)}" placeholder="Street, City" autocomplete="street-address"></div>
    ${people.map(p => `<div class="field"><label for="ph_${esc(p.id)}">${people.length > 1 ? esc(firstName(p)) + "'s phone" : 'Phone'}${p.phone ? ` · <a href="${telUrl(p.phone)}">call</a> · <a href="${smsUrl(p.phone)}">text</a>` : ''}</label><input id="ph_${esc(p.id)}" data-pid="${esc(p.id)}" class="phone" type="tel" value="${esc(p.phone)}" placeholder="(612) 555-0123" autocomplete="tel"></div>`).join('')}
    <p class="dim">Everyone in the group can see these, so you can reach each other about swaps.</p>
    ${next ? `<button class="btn" id="hSwap" style="width:100%">Can't host ${fmtShort(next.date)}?</button>` : ''}
    ${h.status === 'never' ? '' : held
      ? `<div class="notice">${esc(first)} ${people.length > 1 ? 'are' : 'is'} on hold${h.until ? ' until ' + fmtLong(h.until) : ''} and won't be scheduled to host.</div><button class="btn" id="hBack" style="width:100%">${people.length > 1 ? 'We' : 'I'} can host again</button>`
      : `<button class="btn ghost" id="hHold" style="width:100%">Put on hold (can't host for a while)</button>`}
    ${devo ? `<div class="eyebrow month">Friday devotional</div>${devo}` : ''}
    <p class="dim"><button class="linkbtn" id="hOut">Not ${esc(firstName(person(me.id)))}?</button></p>`,
    [{ label: 'Save', cls: 'primary', onClick: () => {
      const address = ($('#hAddr').value || '').trim();
      const phones = {}; document.querySelectorAll('#sheetBody input.phone').forEach(i => { phones[i.dataset.pid] = i.value.trim(); });
      const same = address === (h.address || '') && people.every(p => (phones[p.id] || '') === (p.phone || ''));
      if (same) { closeSheet(); return; }
      act({ type: 'info', householdId: h.id, address, phones }, 'Saved');
    } }]);
  const body = $('#sheetBody');
  if (next) $('#hSwap').addEventListener('click', () => swapSheet(h.id, next.id));
  if ($('#hHold')) $('#hHold').addEventListener('click', () => holdSheet(h.id));
  if ($('#hBack')) $('#hBack').addEventListener('click', () => act({ type: 'available', householdId: h.id }, `${first} can host again`));
  $('#hOut').addEventListener('click', () => { setMe(null); hhSheet(h.id); });
  body.querySelectorAll('[data-devoswap]').forEach(b => b.addEventListener('click', () => devoSwapSheet(b.dataset.devoswap, b.dataset.mid)));
  body.querySelectorAll('[data-devohold]').forEach(b => b.addEventListener('click', () => devoHoldSheet(b.dataset.devohold)));
  body.querySelectorAll('[data-devoback]').forEach(b => b.addEventListener('click', () => act({ type: 'devoavailable', personId: b.dataset.devoback }, 'Back in the devotional line')));
}

// How long a hold lasts: until further notice, or until a date.
function holdForm(title, text, againLabel, onSave, onBack) {
  openSheet(title, `<p>${text}</p>
    <div class="field"><label>How long?</label><div class="seg" id="holdLen"><button data-v="open" aria-pressed="true">Until further notice</button><button data-v="date" aria-pressed="false">Until a date</button></div></div>
    <div class="field hidden" id="holdDateWrap"><label for="holdDate">${esc(againLabel)}</label><input id="holdDate" type="date" min="${addDays(g.today, 1)}"></div>`,
    [{ label: 'Put on hold', cls: 'primary', onClick: () => {
      const dated = $('#holdLen [aria-pressed="true"]').dataset.v === 'date';
      const until = dated ? $('#holdDate').value : null;
      if (dated && !until) { toast('Pick the date'); return; }
      onSave(until);
    } }, { label: 'Back', onClick: onBack }]);
  document.querySelectorAll('#holdLen button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#holdLen button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('#holdDateWrap').classList.toggle('hidden', b.dataset.v !== 'date');
  }));
}
function holdSheet(hid) {
  const h = hh(hid); const next = nextDate(h.id);
  holdForm('Put on hold', `${esc(h.label)} won't be scheduled to host while on hold. ${next ? `Their week on ${fmtShort(next.date)} goes to the next person in line, and everyone after moves up.` : ''}`, 'Can host again from',
    until => act({ type: 'hold', householdId: h.id, until }, 'On hold. The schedule moved up.'), () => hhSheet(hid));
}
function devoHoldSheet(pid) {
  const p = person(pid); const d = nextDevo(pid);
  holdForm('Hold from devotionals', `${esc(p.name)} won't be scheduled for a devotional while on hold. ${d ? `Their Friday, ${fmtShort(d.date)}, goes to the next man in line, and everyone after moves up.` : ''}`, 'Can say devotionals again from',
    until => act({ type: 'devohold', personId: pid, until }, 'On hold. The devotionals moved up.'), () => hhSheet(p.householdId));
}

// Who a week could go to, with a search box. Shared by the hosting swap and the devotional swap.
function pickSheet(title, intro, foot, sections, confirm) {
  openSheet(title, `
    <div class="notice info">${intro}</div>
    <input id="swapSearch" type="search" placeholder="Search a name" autocomplete="off" style="width:100%;background:var(--surface-2);border:1px solid var(--rule);color:var(--ink);border-radius:10px;padding:10px 12px;font-size:1rem">
    ${sections.filter(s => s.rows.length).map(s => `<div class="eyebrow">${esc(s.title)}</div><div class="list">${s.rows.join('')}</div>`).join('')}
    <p class="dim">${esc(foot)}</p>`);
  $('#swapSearch').addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); $('#sheetBody').querySelectorAll('[data-to]').forEach(b => b.classList.toggle('hidden', !!q && !b.textContent.toLowerCase().includes(q))); });
  $('#sheetBody').querySelectorAll('[data-to]').forEach(b => b.addEventListener('click', () => confirm(b.dataset.to, b.dataset.sub)));
}
const pickRow = (id, name, sub, phones, extra) => `<button class="row tap" data-to="${esc(id)}" data-sub="${esc(extra)}"><div class="main"><div class="t">${esc(name)}</div><div class="s wrap">${sub}${phones ? ' · ' + esc(phones) : ''}</div></div></button>`;

function swapSheet(fromId, mid) {
  const m = g.meetings.find(x => x.id === mid); const from = hh(fromId); if (!m || !from) return;
  const cands = g.households.filter(h => h.id !== from.id && h.status === 'available' && g.people.some(p => p.householdId === h.id));
  const withDate = cands.map(h => ({ h, d: nextDate(h.id) })).filter(x => x.d).sort((a, b) => a.d.date < b.d.date ? -1 : 1);
  const without = cands.filter(h => !nextDate(h.id)).sort((a, b) => { const i = g.nextInLine.indexOf(a.id), j = g.nextInLine.indexOf(b.id); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j) || a.label.localeCompare(b.label); });
  const phonesOf = h => g.people.filter(p => p.householdId === h.id && p.phone).map(p => p.phone).join(', ');
  const fromName = from.label.split(' (')[0];
  pickSheet(`Can't host ${fmtShort(m.date)}?`, `First talk to someone and make sure they can take ${fmtLong(m.date)}. Then pick them here so everyone sees the change.`, "People on hold aren't listed. Nobody can? Message Tim.", [
    { title: 'Already have a week: you trade', rows: withDate.map(({ h, d }) => pickRow(h.id, h.label, `Hosts ${fmtShort(d.date)} · ${esc(fromName)} would take ${fmtShort(d.date)}`, phonesOf(h), `${h.label} hosts ${fmtShort(m.date)} and ${fromName} hosts ${fmtShort(d.date)}.`)) },
    { title: 'Not on the schedule yet', rows: without.map(h => pickRow(h.id, h.label, `Takes ${fmtShort(m.date)} · ${esc(fromName)} hosts the next open week`, phonesOf(h), `${h.label} hosts ${fmtShort(m.date)}. ${fromName} moves to the next open week and everyone after shifts by one.`)) }
  ], (toId, sub) => {
    const to = hh(toId);
    openSheet('Record this swap?', `<p>${esc(sub)}</p><p class="dim">Only record it once ${esc(to.label)} has said yes.</p>`, [
      { label: 'Yes, record it', cls: 'primary', onClick: () => act({ type: 'swap', meetingId: m.id, toHouseholdId: to.id }, 'Swap recorded. Everyone sees it now.') },
      { label: 'Back', onClick: () => swapSheet(fromId, mid) }]);
  });
}

function devoSwapSheet(pid, mid) {
  const m = g.meetings.find(x => x.id === mid); const from = person(pid); if (!m || !from) return;
  const cands = (g.men || []).filter(x => x.id !== pid && x.status === 'available').map(x => person(x.id)).filter(Boolean);
  const withDate = cands.map(p => ({ p, d: nextDevo(p.id) })).filter(x => x.d).sort((a, b) => a.d.date < b.d.date ? -1 : 1);
  const without = cands.filter(p => !nextDevo(p.id)); // already in line order
  const fromName = firstName(from);
  pickSheet(`Can't say it ${fmtShort(m.date)}?`, `First talk to someone and make sure they can take ${fmtLong(m.date)}. Then pick them here so everyone sees the change.`, "Men on hold aren't listed. Nobody can? Message Tim.", [
    { title: 'Already have a Friday: you trade', rows: withDate.map(({ p, d }) => pickRow(p.id, p.name, `Has ${fmtShort(d.date)} · ${esc(fromName)} would take ${fmtShort(d.date)}`, p.phone, `${p.name} says the devotional ${fmtShort(m.date)} and ${fromName} says it ${fmtShort(d.date)}.`)) },
    { title: 'Not on the calendar yet', rows: without.map(p => pickRow(p.id, p.name, `Takes ${fmtShort(m.date)} · ${esc(fromName)} moves to the next open Friday`, p.phone, `${p.name} says the devotional ${fmtShort(m.date)}. ${fromName} moves to the next open Friday and everyone after shifts by one.`)) }
  ], (toId, sub) => {
    const to = person(toId);
    openSheet('Record this swap?', `<p>${esc(sub)}</p><p class="dim">Only record it once ${esc(to.name)} has said yes.</p>`, [
      { label: 'Yes, record it', cls: 'primary', onClick: () => act({ type: 'devoswap', meetingId: m.id, toPersonId: to.id }, 'Swap recorded. Everyone sees it now.') },
      { label: 'Back', onClick: () => devoSwapSheet(pid, mid) }]);
  });
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'hh') hhSheet(b.dataset.id);
  else if (a === 'calday') daySheet(b.dataset.id);
  else if (a === 'calbday') birthdaySheet(b.dataset.date);
  else if (a === 'calnav') { calMonth = shiftMonth(calMonth, +b.dataset.dir); render(); }
  else if (a === 'view') { pref('view', b.dataset.v); render(); }
});
document.addEventListener('toggle', e => { if (e.target.id === 'recent') pref('recentOpen', e.target.open ? '1' : null); }, true);
$('#gRefresh').addEventListener('click', () => { netState = 'loading'; render(); refresh(false); });
$('#sheetClose').addEventListener('click', closeSheet); $('#backdrop').addEventListener('click', closeSheet);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !document.body.classList.contains('modal')) refresh(true); });
setInterval(() => { if (document.visibilityState === 'visible' && !document.body.classList.contains('modal')) refresh(true); }, 120000);
if ('serviceWorker' in navigator && location.pathname.includes('/group/')) navigator.serviceWorker.register('../sw.js').catch(() => {});
render();
refresh(true);
