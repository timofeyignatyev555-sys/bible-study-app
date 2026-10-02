// Group page: what members see from the shared link. Hosting schedule + calendar, read-only except
// their own address and recording a swap. Talks to the worker with the group key, never the leader token.
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
const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem('bsg.' + k); if (v === null) localStorage.removeItem('bsg.' + k); else localStorage.setItem('bsg.' + k, v); } catch { return null; } };

let key = new URLSearchParams(location.search).get('k') || pref('key');
if (key) pref('key', key);
let g = null; try { g = JSON.parse(pref('cache') || 'null'); } catch {}
let netState = 'loading'; // loading | ok | offline | forbidden
let editingAddr = false;

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
  try { take((await call('/group/act', { ...body, by: me() ? me().name : 'Someone' })).group); closeSheet(); toast(ok); return true; }
  catch (e) { toast(e.code === 'forbidden' ? 'This link no longer works. Ask for the new one.' : (e.code === 'http' ? e.message : 'No connection. Try again.')); return false; }
}

// ---------- model helpers over the projection
const hh = id => g.households.find(h => h.id === id) || null;
const me = () => { const id = pref('me'); return id && id !== 'none' && g ? g.people.find(p => p.id === id) || null : null; };
const myH = () => { const p = me(); return p ? hh(p.householdId) : null; };
const upcoming = () => g.meetings.filter(m => !m.past);
const isHome = m => m.status === 'on' && !m.place;
const nextDate = hid => { const m = upcoming().find(x => isHome(x) && x.hostId === hid); return m || null; };
function where(m) { if (m.place) return m.place.name || 'Somewhere else'; const h = hh(m.hostId); return h ? h.label : (m.status === 'on' ? 'Host not set yet' : ''); }
function addrOf(m) { if (m.place) return m.place.address; const h = hh(m.hostId); return h ? h.address : ''; }

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
  if (!pref('me')) { renderPicker(main); return; }
  let html = renderTurn() + renderThisWeek() + renderSchedule();
  if (g.log && g.log.length) html += `<section><h2>Recent changes</h2><div class="list">${g.log.slice().reverse().slice(0, 5).map(e => `<div class="row"><div class="main"><div class="t" style="font-weight:500">${esc(e.text)}</div><div class="s">${fmtStamp(e.at)}</div></div></div>`).join('')}</div></section>`;
  html += `<p class="dim" style="text-align:center">${me() ? `You're ${esc(me().name)}. ` : ''}<button class="linkbtn" data-act="switch">${me() ? 'Not you?' : 'Pick your name'}</button></p>`;
  main.innerHTML = html;
}

function renderPicker(main) {
  const people = [...g.people].sort((a, b) => a.name.localeCompare(b.name));
  main.innerHTML = `<div class="card stack" style="gap:12px"><h2>Who are you?</h2><p class="muted">Pick your name so the page can show your hosting week. It's only saved on this phone.</p>
    <div class="field"><input id="pickSearch" type="search" placeholder="Search your name" autocomplete="off"></div>
    <div class="list picker" id="pickList">${people.map(p => `<button class="row tap" data-act="iam" data-id="${p.id}" data-n="${esc(p.name.toLowerCase())}"><div class="main"><div class="t">${esc(p.name)}</div></div></button>`).join('')}</div>
    <button class="btn ghost" data-act="iam" data-id="none">I'm just looking</button></div>`;
  $('#pickSearch').addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('#pickList .row').forEach(r => r.classList.toggle('hidden', !!q && !r.dataset.n.includes(q))); });
}

function renderTurn() {
  const h = myH(); if (!h) return '';
  const p = me();
  const others = h.members.filter(n => n !== p.name).map(n => n.split(' ')[0]);
  const next = nextDate(h.id);
  const pos = g.nextInLine.indexOf(h.id);
  let line;
  if (next) line = `<div class="big">${fmtLong(next.date)}</div><div class="muted">${fmtTime(next.time)} · you're hosting${others.length ? ' with ' + esc(others.join(' & ')) : ''}${next.title ? ' · ' + esc(next.title) : ''}</div>`;
  else if (h.status === 'never' || (h.status === 'unavailable' && !h.until)) line = `<div class="big">Not hosting right now</div><div class="muted">Tim has you off the hosting list for now.</div>`;
  else if (pos >= 0) line = `<div class="big">Not this season yet</div><div class="muted">You're #${pos + 1} in line after the last scheduled week.</div>`;
  else line = `<div class="big">Not scheduled</div>`;
  const addr = h.address;
  const addrBlock = (!addr || editingAddr)
    ? `<div class="field"><label for="myAddr">Your address${others.length ? ' (your household)' : ''}</label><input id="myAddr" value="${esc(addr)}" placeholder="Street, City" autocomplete="street-address"></div>
       <div class="btn-row"><button class="btn primary" data-act="saveaddr">Save address</button>${editingAddr ? '<button class="btn" data-act="canceladdr">Cancel</button>' : ''}</div>
       ${addr ? '' : '<p class="dim">So everyone knows where to go when it is your week.</p>'}`
    : `<div class="between"><div><div class="eyebrow">Your address</div><a href="${mapsUrl(addr)}" target="_blank" rel="noopener" style="text-decoration:none;color:var(--info)">${esc(addr)}</a></div><button class="btn sm" data-act="editaddr">Edit</button></div>`;
  return `<div class="card turn stack" style="gap:12px"><div><span class="eyebrow">Your turn to host</span>${line}</div>${addrBlock}
    ${next ? `<button class="btn" data-act="swap" data-id="${next.id}">Can't host ${fmtShort(next.date)}?</button>` : ''}</div>`;
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
function addDays(iso, n) { const [y, m, d] = parts(iso); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }

function row(m) {
  const mine = myH() && m.hostId === myH().id && isHome(m);
  const a = m.status === 'on' ? addrOf(m) : '';
  const title = m.status !== 'on' ? '<span class="muted">No meeting</span>' : `${m.title ? esc(m.title) + ' · ' : ''}${esc(where(m))}${mine ? ' <span class="you">you</span>' : ''}`;
  const sub = m.status !== 'on' ? '' : (a ? `<a href="${mapsUrl(a)}" target="_blank" rel="noopener" style="color:var(--info);text-decoration:none">${esc(a)}</a>` : (isHome(m) && m.hostId ? '<span class="dim">address not added yet</span>' : ''));
  return `<div class="row ${m.past ? 'past' : ''} ${mine ? 'mine' : ''}"><div class="when"><b>${fmtShort(m.date)}</b>${DOW[dow(m.date)].slice(0, 3)}</div><div class="main"><div class="t">${title}</div><div class="s">${sub || (m.status === 'on' ? fmtTime(m.time) : '&nbsp;')}</div></div>${m.status === 'on' && m.kind === 'event' ? '<div class="k"><span class="chip info">event</span></div>' : ''}</div>`;
}

function renderSchedule() {
  const up = upcoming(), past = g.meetings.filter(m => m.past);
  let html = `<section><h2>Schedule</h2><p class="dim">Who hosts each week. If you can't make your week, talk to someone and swap, then record it from "Your turn".</p>`;
  let cur = '';
  for (const m of up) {
    const mk = m.date.slice(0, 7);
    if (mk !== cur) { if (cur) html += '</div>'; cur = mk; const [y, mo] = parts(m.date); html += `<div class="eyebrow month">${MONL[mo - 1]} ${y}</div><div class="list">`; }
    html += row(m);
  }
  if (cur) html += '</div>'; else html += '<div class="list"><div class="empty">Nothing scheduled yet.</div></div>';
  html += '</section>';
  if (g.nextInLine.length) html += `<section><h2>Next in line</h2><p class="dim">Who hosts after the last scheduled week, in order.</p><div class="list">${g.nextInLine.map((id, i) => { const h = hh(id); const mine = myH() && myH().id === id; return `<div class="row ${mine ? 'mine' : ''}"><div class="n">${i + 1}</div><div class="main"><div class="t">${esc(h.label)}${mine ? ' <span class="you">you</span>' : ''}</div></div></div>`; }).join('')}</div></section>`;
  if (past.length) html += `<details class="adv"><summary>Earlier weeks (${past.length})</summary><div class="list" style="margin-top:8px">${past.slice().reverse().map(row).join('')}</div></details>`;
  return html;
}

// ---------- swap flow
function swapSheet(mid) {
  const m = g.meetings.find(x => x.id === mid); const mine = myH(); if (!m || !mine) return;
  const cands = g.households.filter(h => h.id !== mine.id && h.status !== 'never' && g.people.some(p => p.householdId === h.id));
  const withDate = cands.map(h => ({ h, d: nextDate(h.id) })).filter(x => x.d).sort((a, b) => a.d.date < b.d.date ? -1 : 1);
  const without = cands.filter(h => !nextDate(h.id)).sort((a, b) => { const i = g.nextInLine.indexOf(a.id), j = g.nextInLine.indexOf(b.id); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j) || a.label.localeCompare(b.label); });
  const r = (h, sub, extra) => `<button class="row tap" data-to="${h.id}" data-sub="${esc(extra)}"><div class="main"><div class="t">${esc(h.label)}</div><div class="s wrap">${sub}</div></div></button>`;
  openSheet(`Can't host ${fmtShort(m.date)}?`, `
    <div class="notice info">First talk to someone and make sure they can take ${fmtLong(m.date)}. Then pick them here so everyone sees the change.</div>
    <input id="swapSearch" type="search" placeholder="Search a name" autocomplete="off" style="width:100%;background:var(--surface-2);border:1px solid var(--rule);color:var(--ink);border-radius:10px;padding:10px 12px;font-size:1rem">
    ${withDate.length ? `<div class="eyebrow">Already have a week: you trade</div><div class="list">${withDate.map(({ h, d }) => r(h, `Hosts ${fmtShort(d.date)} · you'd take ${fmtShort(d.date)} instead`, `${h.label} hosts ${fmtShort(m.date)} and you host ${fmtShort(d.date)}.`)).join('')}</div>` : ''}
    ${without.length ? `<div class="eyebrow">Not on the schedule yet</div><div class="list">${without.map(h => r(h, `They take ${fmtShort(m.date)} · you host the next open week`, `${h.label} hosts ${fmtShort(m.date)}. You move to the next open week and everyone after shifts by one.`)).join('')}</div>` : ''}
    <p class="dim">Nobody can? Message Tim.</p>`);
  $('#swapSearch').addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); $('#sheetBody').querySelectorAll('[data-to]').forEach(b => b.classList.toggle('hidden', !!q && !b.textContent.toLowerCase().includes(q))); });
  $('#sheetBody').querySelectorAll('[data-to]').forEach(b => b.addEventListener('click', () => {
    const to = hh(b.dataset.to);
    openSheet('Record this swap?', `<p>${esc(b.dataset.sub)}</p><p class="dim">Only record it once ${esc(to.label)} has said yes.</p>`, [
      { label: 'Yes, record it', cls: 'primary', onClick: () => act({ type: 'swap', meetingId: m.id, toHouseholdId: to.id }, 'Swap recorded. Everyone sees it now.') },
      { label: 'Back', onClick: () => swapSheet(mid) }]);
  }));
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const { act: a, id } = b.dataset;
  if (a === 'iam') { pref('me', id); render(); window.scrollTo(0, 0); }
  else if (a === 'switch') { pref('me', null); editingAddr = false; render(); window.scrollTo(0, 0); }
  else if (a === 'editaddr') { editingAddr = true; render(); const i = $('#myAddr'); if (i) i.focus(); }
  else if (a === 'canceladdr') { editingAddr = false; render(); }
  else if (a === 'saveaddr') {
    const v = ($('#myAddr').value || '').trim(); const h = myH();
    if (!v && !h.address) { toast('Type your address first'); return; }
    act({ type: 'address', householdId: h.id, address: v }, 'Address saved').then(ok => { if (ok) { editingAddr = false; render(); } });
  }
  else if (a === 'swap') swapSheet(id);
});
$('#gRefresh').addEventListener('click', () => { netState = 'loading'; render(); refresh(false); });
$('#sheetClose').addEventListener('click', closeSheet); $('#backdrop').addEventListener('click', closeSheet);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(true); });
setInterval(() => { if (document.visibilityState === 'visible' && !document.body.classList.contains('modal') && !editingAddr) refresh(true); }, 120000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});
render();
refresh(true);
