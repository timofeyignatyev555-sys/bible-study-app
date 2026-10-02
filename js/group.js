// Group page: what members see from the shared link. Hosting schedule + calendar, read-only except
// a household's address and recording a swap. Nobody signs in or picks who they are: you scroll to your
// name, tap it, and add your address there. Talks to the worker with the group key, never the leader token.
import { calendarHTML, shortName, shiftMonth, startMonth } from './calgrid.js';

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
let netState = 'loading'; // loading | ok | offline | forbidden
let calMonth = null;
document.documentElement.dataset.theme = localStorage.getItem('bs.theme') === 'dark' ? 'dark' : 'light';

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
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { code: 'http' });
  return data;
}
function take(group) { g = group; pref('cache', JSON.stringify(g)); netState = 'ok'; render(); }
async function refresh(quiet) {
  if (!key) { render(); return; }
  try { take((await call('/group')).group); if (!quiet) toast('Up to date'); }
  catch (e) { netState = e.code === 'forbidden' ? 'forbidden' : 'offline'; render(); }
}
async function act(body, ok) {
  try { take((await call('/group/act', body)).group); closeSheet(); toast(ok); return true; }
  catch (e) { toast(e.code === 'forbidden' ? 'This link no longer works. Ask Tim for the new one.' : (e.code === 'http' ? e.message : 'No connection. Try again.')); return false; }
}

// ---------- model helpers over the projection
const hh = id => g.households.find(h => h.id === id) || null;
const upcoming = () => g.meetings.filter(m => !m.past);
const isHome = m => m.status === 'on' && !m.place;
const nextDate = hid => upcoming().find(x => isHome(x) && x.hostId === hid) || null;
function where(m) { if (m.place) return m.place.name || 'Somewhere else'; const h = hh(m.hostId); return h ? h.label : (m.status === 'on' ? 'Host not set yet' : ''); }
function addrOf(m) { if (m.place) return m.place.address; const h = hh(m.hostId); return h ? h.address : ''; }
const canHost = h => h.status === 'available' || (h.status === 'unavailable' && h.until);

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
  let html = renderThisWeek() + `<div class="notice info">Find your name and tap it to add your address. Can't host your week? Tap your name too.</div>
    <div class="seg"><button data-act="view" data-v="list" aria-pressed="${view === 'list'}">Hosting list</button><button data-act="view" data-v="cal" aria-pressed="${view === 'cal'}">Calendar</button></div>`;
  html += view === 'cal' ? renderCalendar() : renderSchedule();
  if (g.log && g.log.length) html += `<section><h2>Recent changes</h2><div class="list">${g.log.slice().reverse().slice(0, 5).map(e => `<div class="row"><div class="main"><div class="t" style="font-weight:500">${esc(e.text)}</div><div class="s">${fmtStamp(e.at)}</div></div></div>`).join('')}</div></section>`;
  main.innerHTML = html;
}

function renderThisWeek() {
  const m = upcoming()[0]; if (!m) return '';
  const today = g.today;
  const when = m.date === today ? 'Tonight' : (m.date <= addDays(today, 6) ? 'This ' + DOW[dow(m.date)] : 'Next meeting');
  const a = addrOf(m);
  if (m.status !== 'on') return `<div class="card hero off"><span class="eyebrow">${when}</span><div class="date">${fmtLong(m.date)}</div><div class="host muted" style="margin-top:6px">No meeting this week</div></div>`;
  return `<div class="card hero"><span class="eyebrow">${when} · ${fmtTime(m.time)}</span><div class="date">${fmtLong(m.date)}</div>
    ${m.title ? `<div class="evt">${esc(m.title)}</div>` : ''}
    <div class="who"><span class="lbl">${m.place ? 'At' : 'Host'}</span><span class="host">${esc(where(m))}</span></div>
    <div class="addr">${a ? `<a href="${mapsUrl(a)}" target="_blank" rel="noopener">${esc(a)}</a>` : '<span class="dim">Address not added yet</span>'}</div>
    ${m.topic ? `<div class="meta"><span>${esc(m.topic)}</span></div>` : ''}</div>`;
}

// A week. Home weeks are tappable (opens that household); events and off weeks are view-only.
function row(m) {
  const a = m.status === 'on' ? addrOf(m) : '';
  const tappable = isHome(m) && m.hostId && !m.past;
  const title = m.status !== 'on' ? '<span class="muted">No meeting</span>' : `${m.title ? esc(m.title) + ' · ' : ''}${esc(where(m))}`;
  const sub = m.status !== 'on' ? '&nbsp;' : (a ? esc(a) : (isHome(m) && m.hostId ? (m.past ? '' : '<span class="warn-text">tap to add address</span>') : fmtTime(m.time)));
  const inner = `<div class="when"><b>${fmtShort(m.date)}</b>${DOW[dow(m.date)].slice(0, 3)}</div><div class="main"><div class="t">${title}</div><div class="s">${sub || '&nbsp;'}</div></div>${m.status === 'on' && m.kind === 'event' ? '<div class="k"><span class="chip info">event</span></div>' : (tappable ? '<div class="k">›</div>' : '')}`;
  return tappable ? `<button class="row tap ${m.past ? 'past' : ''}" data-act="hh" data-id="${m.hostId}">${inner}</button>` : `<div class="row ${m.past ? 'past' : ''}">${inner}</div>`;
}
const hhRow = (h, lead) => `<button class="row tap" data-act="hh" data-id="${h.id}">${lead}<div class="main"><div class="t">${esc(h.label)}</div><div class="s">${h.address ? esc(h.address) : '<span class="warn-text">tap to add address</span>'}</div></div><div class="k">›</div></button>`;

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
  if (past.length) html += `<details class="adv"><summary>Earlier weeks (${past.length})</summary><div class="list" style="margin-top:8px">${past.slice().reverse().map(row).join('')}</div></details>`;
  return html;
}

// Month view: the same weeks as the list, drawn as a calendar. Tap a day for that host.
function renderCalendar() {
  const rows = g.meetings.map(m => {
    const h = hh(m.hostId);
    const short = m.place ? (m.title || m.place.name || 'Elsewhere') : (m.title || (h ? shortName(h.label) : 'No host'));
    return { id: m.id, date: m.date, status: m.status, kind: m.kind, short, past: m.past, noAddr: isHome(m) && !!h && !h.address };
  });
  if (!calMonth) calMonth = startMonth(rows, g.today);
  const inMonth = g.meetings.filter(m => m.date.slice(0, 7) === calMonth);
  return `<section>${calendarHTML(calMonth, rows, g.today)}${inMonth.length ? `<div class="list">${inMonth.map(row).join('')}</div>` : '<p class="dim">No meetings this month.</p>'}</section>`;
}
function daySheet(mid) {
  const m = g.meetings.find(x => x.id === mid); if (!m) return;
  if (isHome(m) && m.hostId && !m.past) { hhSheet(m.hostId); return; }
  const a = m.status === 'on' ? addrOf(m) : '';
  openSheet(fmtLong(m.date), m.status !== 'on' ? '<p class="muted">No meeting this week.</p>'
    : `${m.title ? `<div class="evt">${esc(m.title)}</div>` : ''}<div class="who"><span class="lbl">${m.place ? 'At' : 'Host'}</span><span class="host">${esc(where(m))}</span></div>
       <div class="muted">${a ? `<a href="${mapsUrl(a)}" target="_blank" rel="noopener">${esc(a)}</a> · ` : ''}${fmtTime(m.time)}</div>${m.topic ? `<p class="dim">${esc(m.topic)}</p>` : ''}`);
}

// ---------- tapping a name: address + hosting week
function hhSheet(hid) {
  const h = hh(hid); if (!h) return;
  const next = nextDate(h.id);
  const pos = g.nextInLine.indexOf(h.id);
  const turn = next ? `Hosting <b>${fmtLong(next.date)}</b> at ${fmtTime(next.time)}${next.title ? ' · ' + esc(next.title) : ''}`
    : pos >= 0 ? `#${pos + 1} in line after the last scheduled week` : (canHost(h) ? 'Not scheduled yet' : 'Not hosting right now');
  openSheet(h.label, `
    <p class="muted">${turn}</p>
    <div class="field"><label for="hAddr">Address</label><input id="hAddr" value="${esc(h.address)}" placeholder="Street, City" autocomplete="street-address"></div>
    <p class="dim">So everyone knows where to go when it's ${esc(h.label.split(' (')[0])}'s week.</p>
    ${next ? `<button class="btn" id="hSwap" style="width:100%">Can't host ${fmtShort(next.date)}?</button>` : ''}`,
    [{ label: 'Save address', cls: 'primary', onClick: () => {
      const v = ($('#hAddr').value || '').trim();
      if (!v && !h.address) { toast('Type the address first'); return; }
      if (v === h.address) { closeSheet(); return; }
      act({ type: 'address', householdId: h.id, address: v, by: h.label }, 'Address saved');
    } }]);
  if (next) $('#hSwap').addEventListener('click', () => swapSheet(h.id, next.id));
}

function swapSheet(fromId, mid) {
  const m = g.meetings.find(x => x.id === mid); const from = hh(fromId); if (!m || !from) return;
  const cands = g.households.filter(h => h.id !== from.id && h.status !== 'never' && g.people.some(p => p.householdId === h.id));
  const withDate = cands.map(h => ({ h, d: nextDate(h.id) })).filter(x => x.d).sort((a, b) => a.d.date < b.d.date ? -1 : 1);
  const without = cands.filter(h => !nextDate(h.id)).sort((a, b) => { const i = g.nextInLine.indexOf(a.id), j = g.nextInLine.indexOf(b.id); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j) || a.label.localeCompare(b.label); });
  const r = (h, sub, extra) => `<button class="row tap" data-to="${h.id}" data-sub="${esc(extra)}"><div class="main"><div class="t">${esc(h.label)}</div><div class="s wrap">${sub}</div></div></button>`;
  const fromName = from.label.split(' (')[0];
  openSheet(`Can't host ${fmtShort(m.date)}?`, `
    <div class="notice info">First talk to someone and make sure they can take ${fmtLong(m.date)}. Then pick them here so everyone sees the change.</div>
    <input id="swapSearch" type="search" placeholder="Search a name" autocomplete="off" style="width:100%;background:var(--surface-2);border:1px solid var(--rule);color:var(--ink);border-radius:10px;padding:10px 12px;font-size:1rem">
    ${withDate.length ? `<div class="eyebrow">Already have a week: you trade</div><div class="list">${withDate.map(({ h, d }) => r(h, `Hosts ${fmtShort(d.date)} · ${esc(fromName)} would take ${fmtShort(d.date)}`, `${h.label} hosts ${fmtShort(m.date)} and ${fromName} hosts ${fmtShort(d.date)}.`)).join('')}</div>` : ''}
    ${without.length ? `<div class="eyebrow">Not on the schedule yet</div><div class="list">${without.map(h => r(h, `Takes ${fmtShort(m.date)} · ${esc(fromName)} hosts the next open week`, `${h.label} hosts ${fmtShort(m.date)}. ${fromName} moves to the next open week and everyone after shifts by one.`)).join('')}</div>` : ''}
    <p class="dim">Nobody can? Message Tim.</p>`);
  $('#swapSearch').addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); $('#sheetBody').querySelectorAll('[data-to]').forEach(b => b.classList.toggle('hidden', !!q && !b.textContent.toLowerCase().includes(q))); });
  $('#sheetBody').querySelectorAll('[data-to]').forEach(b => b.addEventListener('click', () => {
    const to = hh(b.dataset.to);
    openSheet('Record this swap?', `<p>${esc(b.dataset.sub)}</p><p class="dim">Only record it once ${esc(to.label)} has said yes.</p>`, [
      { label: 'Yes, record it', cls: 'primary', onClick: () => act({ type: 'swap', meetingId: m.id, toHouseholdId: to.id, by: from.label }, 'Swap recorded. Everyone sees it now.') },
      { label: 'Back', onClick: () => swapSheet(fromId, mid) }]);
  }));
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'hh') hhSheet(b.dataset.id);
  else if (a === 'calday') daySheet(b.dataset.id);
  else if (a === 'calnav') { calMonth = shiftMonth(calMonth, +b.dataset.dir); render(); }
  else if (a === 'view') { pref('view', b.dataset.v); render(); }
});
$('#gRefresh').addEventListener('click', () => { netState = 'loading'; render(); refresh(false); });
$('#sheetClose').addEventListener('click', closeSheet); $('#backdrop').addEventListener('click', closeSheet);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !document.body.classList.contains('modal')) refresh(true); });
setInterval(() => { if (document.visibilityState === 'visible' && !document.body.classList.contains('modal')) refresh(true); }, 120000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});
render();
refresh(true);
