// Bible Study: roster, calendar, attendance and hosting rotation. Phone-first, local-first, mirrored to the cloud.
import { plan, todayISO, hostStats, attendanceStats, fillSeason, currentQueue, shuffle, isPast, hasAttendance, eligible, countsAsHost, weekdayOf, addDays } from './rotation.js';
import * as store from './store.js';
import * as sync from './sync.js';

const VERSION = '1.1.0';
let state = null;
let tab = 'week';
let peopleFilter = '';

// ---------- helpers
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const today = () => todayISO();
const parts = iso => iso.split('-').map(Number);
function fmtDate(iso) { const [y, m, d] = parts(iso); return `${DOW[weekdayOf(iso)].slice(0, 3)}, ${MON[m - 1]} ${d}`; }
function fmtLong(iso) { const [y, m, d] = parts(iso); return `${DOW[weekdayOf(iso)]}, ${MONL[m - 1]} ${d}`; }
function fmtShort(iso) { const [y, m, d] = parts(iso); return `${MON[m - 1]} ${d}`; }
function fmtTime(t) { if (!t) return ''; const [h, mi] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const hh = ((h + 11) % 12) + 1; return `${hh}:${String(mi).padStart(2, '0')} ${ap}`; }
function fmtStamp(iso) { if (!iso) return 'never'; const d = new Date(iso); return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
const initials = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const mapsUrl = a => 'https://maps.google.com/?q=' + encodeURIComponent(a);
const sorted = () => [...state.meetings].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const hh = id => state.households.find(h => h.id === id) || null;
const person = id => state.people.find(p => p.id === id) || null;
const activePeople = () => state.people.filter(p => p.active !== false);
const members = h => activePeople().filter(p => p.householdId === h.id).map(p => p.name);
const firstNames = h => members(h).map(n => n.split(' ')[0]).join(' & ');
function hostLabel(h) { if (!h) return ''; const m = members(h); return m.length > 1 ? `${h.name} (${firstNames(h)})` : h.name; }
function whereText(m) {
  if (m.location) return m.location.name || 'Other place';
  const h = hh(m.hostHouseholdId);
  return h ? hostLabel(h) : (m.status === 'on' ? 'No host yet' : '');
}
function whereAddr(m) { if (m.location) return m.location.address || ''; const h = hh(m.hostHouseholdId); return h ? h.address || '' : ''; }
function hostStatusText(h) {
  if (h.hostStatus === 'never') return 'never hosts';
  if (h.hostStatus === 'unavailable') return h.unavailableUntil ? `back ${fmtShort(h.unavailableUntil)}` : 'unavailable';
  return '';
}

let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2200); }

// ---------- state lifecycle + undo history (per device, survives relaunch)
const UNDO_MAX = 30;
let lastSaved = null; // JSON of the last committed state, becomes the undo snapshot on the next commit
const hist = k => { try { return JSON.parse(localStorage.getItem('bs.' + k) || '[]'); } catch { return []; } };
const setHist = (k, arr) => { try { localStorage.setItem('bs.' + k, JSON.stringify(arr.slice(-UNDO_MAX))); } catch {} };
function ensureSeason() { const added = fillSeason(state); if (added.length) state.meetings.push(...added); return added.length; }
function replan() { state.meetings = plan(state, today()).meetings; }
function persist() {
  state.updatedAt = new Date().toISOString();
  ensureSeason(); replan();
  store.save(state);
  sync.push(state, adopt);
  lastSaved = JSON.stringify(state);
  render();
}
function commit(msg, label) {
  if (lastSaved) { const u = hist('undo'); u.push({ label: label || msg || 'Change', at: new Date().toISOString(), state: lastSaved }); setHist('undo', u); setHist('redo', []); }
  persist();
  if (msg) toast(msg);
}
function undo() {
  const u = hist('undo'); if (!u.length) { toast('Nothing to undo'); return; }
  const item = u.pop(); setHist('undo', u);
  const r = hist('redo'); r.push({ label: item.label, at: new Date().toISOString(), state: JSON.stringify(state) }); setHist('redo', r);
  state = store.normalize(JSON.parse(item.state), today()); persist(); toast('Undid: ' + item.label);
}
function redo() {
  const r = hist('redo'); if (!r.length) { toast('Nothing to redo'); return; }
  const item = r.pop(); setHist('redo', r);
  const u = hist('undo'); u.push({ label: item.label, at: new Date().toISOString(), state: JSON.stringify(state) }); setHist('undo', u);
  state = store.normalize(JSON.parse(item.state), today()); persist(); toast('Redid: ' + item.label);
}
function adopt(serverState, quiet) {
  state = store.normalize(serverState, today());
  ensureSeason(); replan();
  store.save(state);
  lastSaved = JSON.stringify(state);
  render();
  if (!quiet) toast('Updated from your other device');
}
async function pullAndAdopt() {
  try {
    const r = await sync.pull(state);
    if (r && r.state) adopt(r.state);
    else if (r && (r.empty || r.stale) && state) sync.push(state, adopt);
  } catch {}
}

function showConnect(err) {
  $('#connect').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#tabbar').classList.add('hidden');
  const e = $('#tokenErr'); if (err) { e.textContent = err; e.classList.remove('hidden'); } else e.classList.add('hidden');
}
function showApp() { $('#connect').classList.add('hidden'); $('#app').classList.remove('hidden'); $('#tabbar').classList.remove('hidden'); render(); }

async function boot() {
  const theme = store.getPref('theme'); if (theme) document.documentElement.dataset.theme = theme;
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('token')) { sync.setToken(hash.get('token')); history.replaceState(null, '', location.pathname + location.search); }
  const local = store.load();
  if (local) {
    state = store.normalize(local, today()); ensureSeason(); replan(); lastSaved = JSON.stringify(state); showApp(); pullAndAdopt();
  } else if (sync.token()) {
    try {
      const r = await sync.pull(null);
      if (r && r.state) { adopt(r.state, true); showApp(); toast('Connected'); }
      else { state = store.normalize(store.emptyState(today()), today()); commit(); showApp(); }
    } catch (e) { showConnect(e.code === 'forbidden' ? 'That token was rejected.' : 'Could not reach the sync server. Check your connection and try again.'); }
  } else showConnect();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ---------- render
function render() {
  if (!state) return;
  $('#appName').textContent = state.settings.name || 'Bible Study';
  document.title = state.settings.name || 'Bible Study';
  renderSyncStatus(sync.status);
  const ms = sorted();
  const held = ms.filter(m => m.status === 'on' && isPast(m, today())).length;
  $('#topRight').innerHTML = `<b>${activePeople().length}</b>people · ${held} held`;
  document.querySelectorAll('.tabbar button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + tab));
  ({ week: renderWeek, calendar: renderCalendar, people: renderPeople, hosting: renderHosting, settings: renderSettings })[tab]();
}
function renderSyncStatus(s) {
  const dot = $('#syncDot'), txt = $('#syncText');
  const map = { local: ['', 'local only'], syncing: ['warn', 'syncing'], ok: ['ok', s.dirty ? 'saving' : 'synced'], offline: ['warn', 'offline, will retry'], forbidden: ['crit', 'token rejected'] };
  const [cls, label] = map[s.state] || ['', s.state];
  dot.className = 'dot ' + cls; txt.textContent = label;
  if (tab === 'settings' && state) { const el = $('#syncLine'); if (el) el.innerHTML = syncLine(); }
}
sync.onStatus(renderSyncStatus);

function chipsFor(m) {
  const c = [];
  if (m.status === 'off') c.push('<span class="chip">off</span>');
  if (m.kind === 'event') c.push('<span class="chip info">event</span>');
  if (m.status === 'on' && m.hostMode === 'pinned' && m.hostHouseholdId && !m.location) c.push('<span class="chip accent">pinned</span>');
  if (m.status === 'on' && hasAttendance(m)) c.push(`<span class="chip ok">${Object.keys(m.attendance).length} came</span>`);
  else if (m.status === 'on' && !m.location && !m.hostHouseholdId && !isPast(m, today())) c.push('<span class="chip crit">no host</span>');
  return c.join('');
}

function renderWeek() {
  const t = today();
  const ms = sorted();
  const upcoming = ms.filter(m => m.date >= t);
  const next = upcoming[0];
  let html = '';
  if (!next) {
    html += `<div class="card"><h2>Season complete</h2><p class="muted" style="margin-top:6px">Extend the season in Settings to plan more weeks.</p></div>`;
  } else {
    const eyebrow = next.date === t ? 'Tonight' : (next.date <= addDays(t, 6) ? 'This week' : 'Next meeting');
    const addr = whereAddr(next);
    const leader = person(next.leaderId);
    const h = hh(next.hostHouseholdId);
    html += `<div class="card hero ${next.status === 'off' ? 'off' : ''}">
      <div class="between"><span class="eyebrow">${eyebrow}</span><span>${chipsFor(next)}</span></div>
      <div class="date">${fmtLong(next.date)}</div>
      ${next.status === 'off' ? `<div class="host muted">No meeting this week</div>` : `
      <div class="host">${next.kind === 'event' && next.title ? esc(next.title) + ' · ' : ''}${next.location ? 'at ' : (next.hostHouseholdId ? 'Hosted by ' : '')}${esc(whereText(next))}</div>
      ${h && members(h).length > 1 ? `<div class="dim">${esc(members(h).join(', '))}</div>` : ''}
      <div class="addr">${addr ? `<a href="${mapsUrl(addr)}" target="_blank" rel="noopener">${esc(addr)}</a>` : `<span class="dim">no address yet${h ? ' · tap Edit host to add' : ''}</span>`}</div>
      <div class="meta"><span>${fmtTime(next.time)}</span>${next.topic ? `<span>${esc(next.topic)}</span>` : ''}${leader ? `<span>led by ${esc(leader.name)}</span>` : ''}</div>`}
      ${next.notes ? `<p class="dim" style="margin-top:8px;white-space:pre-wrap">${esc(next.notes)}</p>` : ''}
      <div class="btn-row" style="margin-top:14px">
        ${next.status === 'on' ? `<button class="btn primary" data-act="attendance" data-id="${next.id}">Attendance${hasAttendance(next) ? ` (${Object.keys(next.attendance).length})` : ''}</button>` : ''}
        ${next.status === 'on' && !next.location ? `<button class="btn" data-act="canthost" data-id="${next.id}" ${next.hostHouseholdId ? '' : 'disabled'}>Can't host</button><button class="btn" data-act="changehost" data-id="${next.id}">Change host</button>` : ''}
        ${next.status === 'on' ? `<button class="btn" data-act="cancel" data-id="${next.id}">Cancel week</button>` : `<button class="btn primary" data-act="restore" data-id="${next.id}">Meeting is on</button>`}
        <button class="btn" data-act="editmeeting" data-id="${next.id}">Edit</button>
        ${h ? `<button class="btn ghost" data-act="edithh" data-id="${h.id}">Edit host</button>` : ''}
        ${next.status === 'on' ? `<button class="btn ghost" data-act="copy" data-id="${next.id}">Copy summary</button>` : ''}
      </div>
    </div>`;
  }
  const rest = upcoming.slice(1, 5);
  if (rest.length) {
    html += `<section><div class="sec-head"><h2>Coming up</h2><button class="btn sm ghost" data-act="tab" data-tab="calendar">Full calendar</button></div><div class="list">` +
      rest.map(m => rowMeeting(m)).join('') + `</div></section>`;
  }
  const st = attendanceStats(state);
  const taken = ms.filter(m => m.status === 'on' && hasAttendance(m));
  const avg = taken.length ? Math.round(taken.reduce((a, m) => a + Object.keys(m.attendance).length, 0) / taken.length) : null;
  html += `<div class="stats"><div class="stat"><b>${activePeople().length}</b><span>people</span></div><div class="stat"><b>${taken.length}</b><span>attendance taken</span></div><div class="stat"><b>${avg ?? '–'}</b><span>avg turnout</span></div></div>`;
  $('#p-week').innerHTML = html;
}

function rowMeeting(m) {
  const t = today();
  const past = isPast(m, t) && m.date < t;
  const leader = person(m.leaderId);
  const sub = [m.status === 'on' ? fmtTime(m.time) : '', m.topic, leader ? 'led by ' + leader.name.split(' ')[0] : ''].filter(Boolean).join(' · ');
  const title = m.status === 'off' ? '<span class="muted">No meeting</span>' : esc((m.kind === 'event' && m.title ? m.title + ' · ' : '') + whereText(m));
  return `<button class="row tap ${past ? 'past' : ''}" data-act="editmeeting" data-id="${m.id}"><div class="when"><b>${fmtShort(m.date)}</b>${DOW[weekdayOf(m.date)].slice(0, 3)}</div><div class="main"><div class="t">${title}</div><div class="s">${esc(sub) || '&nbsp;'}</div></div><div class="k">${chipsFor(m)}</div></button>`;
}

function renderCalendar() {
  const ms = sorted();
  let html = `<div class="between"><h2>Calendar</h2><button class="btn sm" data-act="addevent">+ Add event</button></div>`;
  if (!ms.length) html += `<div class="list"><div class="empty">No meetings yet. Set the season in Settings.</div></div>`;
  let curMonth = '';
  let open = false;
  for (const m of ms) {
    const mk = m.date.slice(0, 7);
    if (mk !== curMonth) {
      if (open) html += '</div>';
      curMonth = mk; const [y, mo] = parts(m.date);
      html += `<div class="eyebrow month">${MONL[mo - 1]} ${y}</div><div class="list">`; open = true;
    }
    html += rowMeeting(m);
  }
  if (open) html += '</div>';
  $('#p-calendar').innerHTML = html;
}

function renderPeople() {
  const st = attendanceStats(state);
  const q = peopleFilter.trim().toLowerCase();
  const groups = [...state.households].sort((a, b) => a.name.localeCompare(b.name));
  let html = `<div class="between"><h2>People <span class="dim">${activePeople().length}</span></h2><button class="btn sm primary" data-act="addperson">+ Add</button></div>
  <div class="field"><input id="peopleSearch" type="search" placeholder="Search" value="${esc(peopleFilter)}" autocomplete="off"></div>`;
  const rowP = p => {
    const s = st[p.id];
    const h = hh(p.householdId);
    return `<button class="row tap" data-act="editperson" data-id="${p.id}"><div class="avatar">${initials(p.name)}</div><div class="main"><div class="t">${esc(p.name)}${p.active === false ? '<span class="chip">inactive</span>' : ''}</div><div class="s">${esc(h && members(h).length > 1 ? h.name + ' household' : (p.phone || ''))}</div></div><div class="k">${s && s.total ? `${s.pct}%<br><span class="dim">${s.present}/${s.total}</span>` : '<span class="dim">no data</span>'}</div></button>`;
  };
  const shown = state.people.filter(p => !q || p.name.toLowerCase().includes(q));
  const inactive = shown.filter(p => p.active === false);
  const active = shown.filter(p => p.active !== false);
  const single = active.filter(p => { const h = hh(p.householdId); return !h || members(h).length <= 1; }).sort((a, b) => a.name.localeCompare(b.name));
  const multi = groups.filter(h => members(h).length > 1);
  if (multi.length) {
    for (const h of multi) {
      const ps = active.filter(p => p.householdId === h.id).sort((a, b) => a.name.localeCompare(b.name));
      if (!ps.length) continue;
      html += `<div class="eyebrow month">${esc(h.name)} household</div><div class="list">${ps.map(rowP).join('')}</div>`;
    }
    if (single.length) html += `<div class="eyebrow month">Everyone else</div>`;
  }
  if (single.length) html += `<div class="list">${single.map(rowP).join('')}</div>`;
  if (inactive.length) html += `<div class="eyebrow month">Inactive</div><div class="list">${inactive.map(rowP).join('')}</div>`;
  if (!shown.length) html += `<div class="list"><div class="empty">${q ? 'No one matches.' : 'No people yet. Tap + Add.'}</div></div>`;
  $('#p-people').innerHTML = html;
  const inp = $('#peopleSearch');
  inp.addEventListener('input', () => { peopleFilter = inp.value; const pos = inp.selectionStart; renderPeople(); const n = $('#peopleSearch'); n.focus(); try { n.setSelectionRange(pos, pos); } catch {} });
}

function renderHosting() {
  const t = today();
  const queue = currentQueue(state, t);
  const stats = hostStats(state, t);
  const ms = sorted();
  const left = ms.filter(m => m.date >= t && m.status === 'on' && !m.location).length;
  const eligibleN = queue.filter(id => { const h = hh(id); return h && h.hostStatus === 'available'; }).length;
  const u = hist('undo'), r = hist('redo');
  let html = `<div class="between"><h2>Hosting</h2><span class="btn-row tight"><button class="btn sm" data-act="undo" ${u.length ? '' : 'disabled'} title="${esc(u.length ? u[u.length - 1].label : '')}">Undo</button><button class="btn sm" data-act="redo" ${r.length ? '' : 'disabled'}>Redo</button><button class="btn sm" data-act="shuffle">Shuffle</button></span></div>
  ${u.length ? `<p class="dim">Undo steps back through your last ${u.length} change${u.length === 1 ? '' : 's'} (latest: ${esc(u[u.length - 1].label)}).</p>` : ''}
  <div class="stats"><div class="stat"><b>${queue.length}</b><span>households</span></div><div class="stat"><b>${eligibleN}</b><span>can host</span></div><div class="stat"><b>${left}</b><span>weeks to fill</span></div></div>
  <p class="dim">Order of who hosts next. Whoever has already hosted this season sits at the back. Move rows with the arrows; tap a name to set the address or availability.</p>`;
  if (!queue.length) html += `<div class="list"><div class="empty">Add people first.</div></div>`;
  else {
    html += `<div class="list">` + queue.map((id, i) => {
      const h = hh(id); const s = stats[id];
      const stt = hostStatusText(h);
      const chip = h.hostStatus === 'never' ? '<span class="chip">never</span>' : h.hostStatus === 'unavailable' ? `<span class="chip warn">${esc(stt)}</span>` : '';
      const k = `${s.hosted}× hosted${s.next ? `<br>next ${fmtShort(s.next)}` : ''}`;
      return `<div class="row"><div class="n">${i + 1}</div><button class="main tap" style="background:none;border:none;padding:0;text-align:left;color:inherit;font:inherit" data-act="edithh" data-id="${id}"><div class="t">${esc(h.name)}${chip}</div><div class="s">${esc(members(h).length > 1 ? members(h).join(', ') : (h.address || 'no address yet'))}</div></button><div class="k">${k}</div><div class="stack" style="gap:4px"><button class="btn icon sm" data-act="move" data-id="${id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button><button class="btn icon sm" data-act="move" data-id="${id}" data-dir="1" ${i === queue.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button></div></div>`;
    }).join('') + `</div>`;
  }
  $('#p-hosting').innerHTML = html;
}

function syncLine() {
  const s = sync.status;
  const t = sync.token();
  if (!t) return `<span class="chip">not connected</span> <span class="dim">This device only.</span>`;
  const label = { ok: 'Synced', syncing: 'Syncing…', offline: 'Offline, will retry', forbidden: 'Token rejected', local: 'Not connected' }[s.state] || s.state;
  return `<span class="chip ${s.state === 'ok' ? 'ok' : s.state === 'forbidden' ? 'crit' : 'warn'}">${label}</span> <span class="dim">last sync ${fmtStamp(s.lastSync)}</span>`;
}

function renderSettings() {
  const s = state.settings;
  const theme = store.getPref('theme') || 'auto';
  $('#p-settings').innerHTML = `
  <section><h2>Group</h2><div class="card stack" style="gap:12px">
    <div class="field"><label for="setName">Name</label><input id="setName" value="${esc(s.name)}"></div>
    <div class="grid2">
      <div class="field"><label for="setDay">Meets on</label><select id="setDay">${DOW.map((d, i) => `<option value="${i}" ${i === s.weekday ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div class="field"><label for="setTime">Default time</label><input id="setTime" type="time" value="${esc(s.defaultTime)}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label for="setStart">Season start</label><input id="setStart" type="date" value="${esc(s.seasonStart)}"></div>
      <div class="field"><label for="setEnd">Season end</label><input id="setEnd" type="date" value="${esc(s.seasonEnd)}"></div>
    </div>
    <p class="dim">Extending the end adds every ${DOW[s.weekday]} up to that date. Past weeks are never removed.</p>
    <button class="btn primary" data-act="savesettings">Save</button>
  </div></section>
  <section><h2>Sync</h2><div class="card stack" style="gap:12px">
    <div id="syncLine">${syncLine()}</div>
    ${sync.token() ? `<div class="btn-row"><button class="btn" data-act="pull">Pull now</button><button class="btn" data-act="disconnect">Disconnect this device</button></div>` : `<div class="field"><label for="setToken">Sync token</label><input id="setToken" type="password" autocomplete="off" placeholder="paste token"></div><div class="err hidden" id="setTokenErr"></div><button class="btn primary" data-act="connect">Connect</button>`}
  </div></section>
  <section><h2>Appearance</h2><div class="card"><div class="seg">${['auto', 'dark', 'light'].map(v => `<button data-act="theme" data-v="${v}" aria-pressed="${theme === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div></section>
  <section><h2>Backup</h2><div class="card stack" style="gap:10px">
    <div class="btn-row"><button class="btn" data-act="export">Export JSON</button><button class="btn" data-act="importpick">Import JSON</button></div>
    <input type="file" id="importFile" accept="application/json,.json" class="hidden">
    <p class="dim">Export saves everything (people, addresses, calendar, attendance) to a file. Import replaces what is on this device and syncs it.</p>
  </div></section>
  <section><h2>Danger</h2><div class="card stack" style="gap:10px">
    <button class="btn danger" data-act="resetlocal">Clear this device</button>
    <p class="dim">Removes the local copy and token from this browser. The cloud copy is untouched; reconnect with your setup link to get it back.</p>
    <p class="dim mono">v${VERSION}</p>
  </div></section>`;
}

// ---------- sheet
function openSheet(title, body, foot = []) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = body;
  const f = $('#sheetFoot');
  f.innerHTML = foot.map((b, i) => `<button class="btn ${b.cls || ''}" data-foot="${i}">${esc(b.label)}</button>`).join('');
  f.classList.toggle('hidden', !foot.length);
  f.querySelectorAll('[data-foot]').forEach(btn => btn.addEventListener('click', () => foot[+btn.dataset.foot].onClick()));
  $('#backdrop').classList.add('on'); $('#sheet').classList.add('on'); document.body.classList.add('modal');
  $('#sheetBody').scrollTop = 0;
}
function closeSheet() { $('#backdrop').classList.remove('on'); $('#sheet').classList.remove('on'); document.body.classList.remove('modal'); }
const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };

function meetingSheet(id) {
  const m = state.meetings.find(x => x.id === id); if (!m) return;
  const isSeasonDay = weekdayOf(m.date) === state.settings.weekday && m.date >= state.settings.seasonStart && m.date <= state.settings.seasonEnd;
  const hhOpts = [...state.households].sort((a, b) => a.name.localeCompare(b.name)).map(h => `<option value="${h.id}" ${m.hostMode === 'pinned' && m.hostHouseholdId === h.id ? 'selected' : ''}>${esc(hostLabel(h))}${h.hostStatus !== 'available' ? ' (' + hostStatusText(h) + ')' : ''}</option>`).join('');
  const autoHost = m.hostMode === 'auto' && m.hostHouseholdId ? hh(m.hostHouseholdId) : null;
  const body = `
  <div class="grid2">
    <div class="field"><label for="mDate">Date</label><input id="mDate" type="date" value="${m.date}"></div>
    <div class="field"><label for="mTime">Time</label><input id="mTime" type="time" value="${esc(m.time)}"></div>
  </div>
  <div class="field"><label>Status</label><div class="seg" id="mStatus"><button data-v="on" aria-pressed="${m.status === 'on'}">Meeting on</button><button data-v="off" aria-pressed="${m.status === 'off'}">No meeting</button></div></div>
  <div class="field"><label>Type</label><div class="seg" id="mKind"><button data-v="study" aria-pressed="${m.kind !== 'event'}">Study</button><button data-v="event" aria-pressed="${m.kind === 'event'}">Special event</button></div></div>
  <div class="field ${m.kind === 'event' ? '' : 'hidden'}" id="mTitleWrap"><label for="mTitle">Event name</label><input id="mTitle" value="${esc(m.title)}" placeholder="e.g. Bonfire night"></div>
  <div class="field"><label>Where</label><div class="seg" id="mWhere"><button data-v="home" aria-pressed="${!m.location}">Someone's home</button><button data-v="place" aria-pressed="${!!m.location}">Other place</button></div></div>
  <div id="mHomeWrap" class="${m.location ? 'hidden' : ''}"><div class="field"><label for="mHost">Host</label><select id="mHost"><option value="">Automatic${autoHost ? ' (' + esc(hostLabel(autoHost)) + ')' : ''}</option>${hhOpts}</select></div><p class="dim" style="margin-top:4px">Choosing a household pins it to this date; the rest of the plan works around it.</p></div>
  <div id="mPlaceWrap" class="grid2 ${m.location ? '' : 'hidden'}"><div class="field"><label for="mPlace">Place</label><input id="mPlace" value="${esc(m.location ? m.location.name : '')}" placeholder="Church"></div><div class="field"><label for="mPlaceAddr">Address</label><input id="mPlaceAddr" value="${esc(m.location ? m.location.address : '')}"></div></div>
  <div class="field"><label for="mTopic">Topic / passage</label><input id="mTopic" value="${esc(m.topic)}" placeholder="e.g. Romans 8"></div>
  <div class="field"><label for="mLeader">Led by</label><select id="mLeader"><option value="">–</option>${activePeople().sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}" ${m.leaderId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
  <div class="field"><label for="mNotes">Notes</label><textarea id="mNotes">${esc(m.notes)}</textarea></div>
  ${m.skipped && m.skipped.length ? `<div class="notice">Skipped this date: ${esc(m.skipped.map(i => (hh(i) || { name: '?' }).name).join(', '))} <button class="btn sm ghost" data-act="unskip" data-id="${m.id}">undo</button></div>` : ''}
  ${!isSeasonDay ? '' : `<p class="dim">This is a regular ${DOW[state.settings.weekday]}; use "No meeting" to cancel it rather than deleting.</p>`}`;
  const foot = [{ label: 'Save', cls: 'primary', onClick: () => {
    const status = $('#mStatus [aria-pressed="true"]').dataset.v, kind = $('#mKind [aria-pressed="true"]').dataset.v, where = $('#mWhere [aria-pressed="true"]').dataset.v;
    const date = v('mDate'); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Pick a date'); return; }
    if (date !== m.date && state.meetings.some(x => x.id !== m.id && x.date === date)) { toast('There is already a meeting on that date'); return; }
    Object.assign(m, { date, time: v('mTime') || state.settings.defaultTime, status, kind, title: v('mTitle').trim(), topic: v('mTopic').trim(), leaderId: v('mLeader') || null, notes: v('mNotes').trim() });
    if (where === 'place') { m.location = { name: v('mPlace').trim() || 'Other place', address: v('mPlaceAddr').trim() }; m.hostHouseholdId = null; m.hostMode = 'auto'; }
    else { m.location = null; const pick = v('mHost'); if (pick) { m.hostHouseholdId = pick; m.hostMode = 'pinned'; } else if (m.hostMode === 'pinned') { m.hostMode = 'auto'; } }
    closeSheet(); commit('Saved');
  } }];
  if (!isSeasonDay) foot.push({ label: 'Delete', cls: 'danger', onClick: () => { state.meetings = state.meetings.filter(x => x.id !== m.id); closeSheet(); commit('Deleted'); } });
  openSheet(fmtDate(m.date), body, foot);
  wireSeg('mStatus'); wireSeg('mWhere', val => { $('#mHomeWrap').classList.toggle('hidden', val !== 'home'); $('#mPlaceWrap').classList.toggle('hidden', val !== 'place'); });
  wireSeg('mKind', val => $('#mTitleWrap').classList.toggle('hidden', val !== 'event'));
}
function wireSeg(id, onChange) {
  const seg = document.getElementById(id);
  seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); onChange && onChange(b.dataset.v); }));
}

function attendanceSheet(id) {
  const m = state.meetings.find(x => x.id === id); if (!m) return;
  const present = { ...(m.attendance || {}) };
  const people = activePeople().sort((a, b) => a.name.localeCompare(b.name));
  const list = people.map(p => `<button class="check" role="checkbox" aria-checked="${!!present[p.id]}" data-p="${p.id}"><span class="box">${present[p.id] ? '✓' : ''}</span><span class="name">${esc(p.name)}</span></button>`).join('');
  openSheet('Attendance · ' + fmtDate(m.date), `<div class="between"><span class="muted" id="attCount"></span><span class="btn-row tight"><button class="btn sm" id="attAll">Everyone</button><button class="btn sm" id="attNone">Clear</button></span></div><div class="list" id="attList">${list}</div>`,
    [{ label: 'Save', cls: 'primary', onClick: () => { m.attendance = present; closeSheet(); commit(`${Object.keys(present).length} marked present`, 'Attendance'); } }]);
  const count = () => { $('#attCount').textContent = `${Object.keys(present).length} of ${people.length} present`; };
  count();
  $('#attList').querySelectorAll('.check').forEach(b => b.addEventListener('click', () => {
    const p = b.dataset.p; if (present[p]) delete present[p]; else present[p] = true;
    b.setAttribute('aria-checked', String(!!present[p])); b.querySelector('.box').textContent = present[p] ? '✓' : ''; count();
  }));
  $('#attAll').addEventListener('click', () => { people.forEach(p => present[p.id] = true); $('#attList').querySelectorAll('.check').forEach(b => { b.setAttribute('aria-checked', 'true'); b.querySelector('.box').textContent = '✓'; }); count(); });
  $('#attNone').addEventListener('click', () => { Object.keys(present).forEach(k => delete present[k]); $('#attList').querySelectorAll('.check').forEach(b => { b.setAttribute('aria-checked', 'false'); b.querySelector('.box').textContent = ''; }); count(); });
}

function cantHostSheet(id) {
  const m = state.meetings.find(x => x.id === id); if (!m || !m.hostHouseholdId) return;
  const h = hh(m.hostHouseholdId);
  const q = currentQueue(state, today()).filter(x => x !== h.id && eligible(hh(x), m.date, m));
  const nxt = q.length ? hh(q[0]) : null;
  openSheet("Can't host", `<p>${esc(hostLabel(h))} can't host on <b>${fmtDate(m.date)}</b>.</p><p class="muted">${nxt ? `${esc(hostLabel(nxt))} takes this week, and ${esc(h.name)} hosts the next open week instead. Everyone after shifts by one.` : 'No one else is available for this date; the week will show "no host" until you pick someone.'}</p>`,
    [{ label: 'Skip them this week', cls: 'primary', onClick: () => { m.skipped = [...(m.skipped || []), h.id]; m.hostMode = 'auto'; closeSheet(); commit(`${h.name} moved to the next open week`, `Skip ${h.name}`); } }, { label: 'Cancel', onClick: closeSheet }]);
}

function changeHostSheet(id) {
  const m = state.meetings.find(x => x.id === id); if (!m) return;
  const hs = [...state.households].filter(h => members(h).length).sort((a, b) => a.name.localeCompare(b.name));
  const stats = hostStats(state, today());
  const list = hs.map(h => `<button class="row tap" data-pick="${h.id}"><div class="main"><div class="t">${esc(hostLabel(h))}${m.hostHouseholdId === h.id ? '<span class="chip accent">current</span>' : ''}${h.hostStatus !== 'available' ? `<span class="chip warn">${esc(hostStatusText(h))}</span>` : ''}</div><div class="s">${esc(h.address || 'no address')}</div></div><div class="k">${stats[h.id].hosted}× hosted</div></button>`).join('');
  openSheet('Host on ' + fmtDate(m.date), `<button class="btn" id="hostAuto">Back to automatic</button><div class="list">${list}</div>`);
  $('#hostAuto').addEventListener('click', () => { m.hostMode = 'auto'; m.location = null; closeSheet(); commit('Host set automatically', 'Automatic host'); });
  $('#sheetBody').querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => { m.hostHouseholdId = b.dataset.pick; m.hostMode = 'pinned'; m.location = null; m.status = 'on'; closeSheet(); commit(`${hh(b.dataset.pick).name} pinned for ${fmtShort(m.date)}`, `Pin ${hh(b.dataset.pick).name}`); }));
}

function personSheet(id) {
  const p = id ? person(id) : { id: null, name: '', phone: '', notes: '', householdId: '', active: true };
  const hs = [...state.households].sort((a, b) => a.name.localeCompare(b.name));
  const body = `
  <div class="field"><label for="pName">Name</label><input id="pName" value="${esc(p.name)}" autocomplete="off"></div>
  <div class="field"><label for="pPhone">Phone</label><input id="pPhone" type="tel" value="${esc(p.phone)}"></div>
  <div class="field"><label for="pHH">Household (for hosting)</label><select id="pHH"><option value="">Own household</option>${hs.map(h => `<option value="${h.id}" ${p.householdId === h.id ? 'selected' : ''}>${esc(h.name)}${members(h).length ? ' · ' + esc(members(h).map(n => n.split(' ')[0]).join(', ')) : ''}</option>`).join('')}</select></div>
  <p class="dim">Siblings who live together share one household so they host as one.</p>
  <div class="field"><label for="pNotes">Notes</label><textarea id="pNotes">${esc(p.notes)}</textarea></div>
  ${id ? `<div class="field"><label>Status</label><div class="seg" id="pActive"><button data-v="1" aria-pressed="${p.active !== false}">Active</button><button data-v="0" aria-pressed="${p.active === false}">Inactive</button></div></div><p class="dim">Inactive people are hidden from attendance and their household stops hosting; their history stays.</p>` : ''}`;
  const foot = [{ label: 'Save', cls: 'primary', onClick: () => {
    const name = v('pName').trim(); if (!name) { toast('Name is required'); return; }
    let hid = v('pHH');
    const own = !hid;
    if (!id) {
      const np = { id: store.uid('p'), name, phone: v('pPhone').trim(), notes: v('pNotes').trim(), active: true, createdAt: new Date().toISOString(), householdId: hid };
      if (own) { const nh = { id: store.uid('h'), name, address: '', hostStatus: 'available', unavailableUntil: null, note: '' }; state.households.push(nh); np.householdId = nh.id; state.rotation.order.push(nh.id); }
      state.people.push(np);
    } else {
      const prev = hh(p.householdId);
      const oldName = p.name;
      Object.assign(p, { name, phone: v('pPhone').trim(), notes: v('pNotes').trim(), active: $('#pActive [aria-pressed="true"]').dataset.v === '1' });
      const alone = prev && state.people.filter(x => x.householdId === prev.id).length === 1;
      if (own) {
        if (alone) { if (prev.name === oldName) prev.name = name; }
        else { const nh = { id: store.uid('h'), name, address: '', hostStatus: 'available', unavailableUntil: null, note: '' }; state.households.push(nh); p.householdId = nh.id; state.rotation.order.push(nh.id); }
      } else p.householdId = hid;
      pruneEmptyHouseholds();
    }
    closeSheet(); commit('Saved');
  } }];
  if (id) foot.push({ label: 'Delete', cls: 'danger', onClick: () => {
    openSheet('Delete ' + p.name + '?', `<p class="muted">This removes them from the roster permanently. To keep their history, mark them inactive instead.</p>`, [
      { label: 'Delete', cls: 'danger', onClick: () => { state.people = state.people.filter(x => x.id !== id); pruneEmptyHouseholds(); closeSheet(); commit('Deleted'); } },
      { label: 'Keep', onClick: () => personSheet(id) }]);
  } });
  openSheet(id ? 'Edit person' : 'Add person', body, foot);
  if (id) wireSeg('pActive');
}
function pruneEmptyHouseholds() {
  const used = new Set(state.people.map(p => p.householdId));
  const referenced = new Set(state.meetings.filter(m => m.hostHouseholdId).map(m => m.hostHouseholdId));
  state.households = state.households.filter(h => used.has(h.id) || referenced.has(h.id));
  const ids = new Set(state.households.map(h => h.id));
  state.rotation.order = state.rotation.order.filter(id => ids.has(id));
}

function householdSheet(id) {
  const h = hh(id); if (!h) return;
  const st = hostStats(state, today())[id];
  const body = `
  <div class="field"><label for="hName">Household name</label><input id="hName" value="${esc(h.name)}"></div>
  <div class="field"><label for="hAddr">Address</label><input id="hAddr" value="${esc(h.address)}" placeholder="Street, City" autocomplete="street-address"></div>
  <div class="field"><label>Hosting</label><div class="seg" id="hStatus"><button data-v="available" aria-pressed="${h.hostStatus === 'available'}">Available</button><button data-v="until" aria-pressed="${h.hostStatus === 'unavailable' && !!h.unavailableUntil}">Until a date</button><button data-v="indef" aria-pressed="${h.hostStatus === 'unavailable' && !h.unavailableUntil}">Not for now</button><button data-v="never" aria-pressed="${h.hostStatus === 'never'}">Never</button></div></div>
  <div class="field ${h.hostStatus === 'unavailable' && h.unavailableUntil ? '' : 'hidden'}" id="hUntilWrap"><label for="hUntil">Available again from</label><input id="hUntil" type="date" value="${esc(h.unavailableUntil || '')}"></div>
  <div class="field"><label for="hNote">Note</label><input id="hNote" value="${esc(h.note || '')}" placeholder="e.g. remodeling until December"></div>
  <div class="list">${members(h).map(n => `<div class="row"><div class="avatar">${initials(n)}</div><div class="main"><div class="t">${esc(n)}</div></div></div>`).join('') || '<div class="empty">No active members</div>'}</div>
  <p class="dim">Hosted ${st.hosted}× this season${st.lastHosted ? ', last ' + fmtShort(st.lastHosted) : ''}${st.next ? ' · next planned ' + fmtShort(st.next) : ''}.</p>`;
  openSheet('Household', body, [{ label: 'Save', cls: 'primary', onClick: () => {
    const mode = $('#hStatus [aria-pressed="true"]').dataset.v;
    h.name = v('hName').trim() || h.name; h.address = v('hAddr').trim(); h.note = v('hNote').trim();
    if (mode === 'available') { h.hostStatus = 'available'; h.unavailableUntil = null; }
    else if (mode === 'until') { const d = v('hUntil'); if (!d) { toast('Pick the date they are back'); return; } h.hostStatus = 'unavailable'; h.unavailableUntil = d; }
    else if (mode === 'indef') { h.hostStatus = 'unavailable'; h.unavailableUntil = null; }
    else { h.hostStatus = 'never'; h.unavailableUntil = null; }
    closeSheet(); commit('Saved');
  } }]);
  wireSeg('hStatus', val => $('#hUntilWrap').classList.toggle('hidden', val !== 'until'));
}

function addEventSheet() {
  const t = today();
  const body = `<div class="grid2"><div class="field"><label for="eDate">Date</label><input id="eDate" type="date" value="${t}"></div><div class="field"><label for="eTime">Time</label><input id="eTime" type="time" value="${esc(state.settings.defaultTime)}"></div></div>
  <div class="field"><label for="eTitle">Event name</label><input id="eTitle" placeholder="e.g. Christmas party"></div>
  <div class="grid2"><div class="field"><label for="ePlace">Place</label><input id="ePlace" placeholder="Church"></div><div class="field"><label for="eAddr">Address</label><input id="eAddr"></div></div>
  <p class="dim">Leave the place empty to hold it at a host's home; you can pin who from the calendar afterwards.</p>`;
  openSheet('Add event', body, [{ label: 'Add', cls: 'primary', onClick: () => {
    const date = v('eDate'); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Pick a date'); return; }
    if (state.meetings.some(m => m.date === date)) { toast('There is already a meeting on that date. Edit it from the calendar.'); return; }
    const place = v('ePlace').trim();
    state.meetings.push({ id: store.uid('m'), date, status: 'on', kind: 'event', title: v('eTitle').trim(), time: v('eTime') || state.settings.defaultTime, hostHouseholdId: null, hostMode: 'auto', location: place ? { name: place, address: v('eAddr').trim() } : null, topic: '', leaderId: null, notes: '', attendance: {}, skipped: [] });
    closeSheet(); commit('Event added');
  } }]);
}

// ---------- actions
function copySummary(id) {
  const m = state.meetings.find(x => x.id === id); if (!m) return;
  const addr = whereAddr(m);
  const lines = [`${state.settings.name} · ${fmtDate(m.date)} at ${fmtTime(m.time)}`, `${m.kind === 'event' && m.title ? m.title + ' · ' : ''}${m.location ? 'at ' : (m.hostHouseholdId ? 'Hosted by ' : '')}${whereText(m)}${addr ? ': ' + addr : ''}`];
  if (m.topic) lines.push('Topic: ' + m.topic);
  const leader = person(m.leaderId); if (leader) lines.push('Led by ' + leader.name);
  const text = lines.join('\n');
  const done = () => toast('Copied');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => openSheet('Summary', `<textarea class="mono" style="width:100%;min-height:120px">${esc(text)}</textarea>`));
  else openSheet('Summary', `<textarea style="width:100%;min-height:120px">${esc(text)}</textarea>`);
}
function saveSettings() {
  const s = state.settings;
  const name = v('setName').trim() || 'Bible Study', weekday = +v('setDay'), defaultTime = v('setTime') || '19:00', seasonStart = v('setStart'), seasonEnd = v('setEnd');
  if (!seasonStart || !seasonEnd || seasonEnd < seasonStart) { toast('Season end must be after the start'); return; }
  const oldDay = s.weekday, oldEnd = s.seasonEnd;
  Object.assign(s, { name, weekday, defaultTime, seasonStart, seasonEnd });
  const t = today();
  const blank = m => m.status === 'on' && m.kind === 'study' && !m.topic && !m.notes && !m.leaderId && !hasAttendance(m) && m.hostMode !== 'pinned' && !m.location && !(m.skipped || []).length;
  // drop untouched future weeks that no longer belong to the season
  state.meetings = state.meetings.filter(m => !(m.date >= t && blank(m) && (weekdayOf(m.date) !== weekday || m.date > seasonEnd || m.date < seasonStart)));
  commit(oldDay !== weekday || oldEnd !== seasonEnd ? 'Season updated' : 'Saved');
}
function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bible-study-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importJSON(file) {
  const r = new FileReader();
  r.onload = () => { try { const s = JSON.parse(r.result); if (!s || !Array.isArray(s.people)) throw 0; state = store.normalize(s, today()); commit('Imported'); } catch { toast('That file is not a Bible Study backup'); } };
  r.readAsText(file);
}
function shuffleRemaining() {
  const t = today();
  const stats = hostStats(state, t);
  const q = currentQueue(state, t);
  const fresh = q.filter(id => !stats[id].hosted), done = q.filter(id => stats[id].hosted);
  state.rotation.order = [...shuffle(fresh), ...done];
  commit('Order shuffled for everyone who has not hosted yet', 'Shuffle');
}
function moveHousehold(id, dir) {
  const q = currentQueue(state, today());
  const i = q.indexOf(id); const j = i + dir; if (i < 0 || j < 0 || j >= q.length) return;
  [q[i], q[j]] = [q[j], q[i]]; state.rotation.order = q; commit(null, `Move ${hh(id).name} ${dir < 0 ? 'up' : 'down'}`);
}
async function connectWith(t, errEl) {
  if (!t) return;
  const r = await sync.verify(t).catch(() => ({ ok: false, why: 'Could not reach the sync server.' }));
  if (!r.ok) { if (errEl) { errEl.textContent = r.why; errEl.classList.remove('hidden'); } toast(r.why); return; }
  sync.setToken(t);
  if (r.state && (!state || (r.state.updatedAt || '') > (state.updatedAt || '') || !state.people.length)) adopt(r.state, true);
  else if (!state) { state = store.normalize(store.emptyState(today()), today()); }
  commit('Connected'); showApp();
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const { act, id } = b.dataset;
  const acts = {
    tab: () => { tab = b.dataset.tab; render(); window.scrollTo(0, 0); },
    attendance: () => attendanceSheet(id), canthost: () => cantHostSheet(id), changehost: () => changeHostSheet(id), editmeeting: () => meetingSheet(id),
    cancel: () => { const m = state.meetings.find(x => x.id === id); m.status = 'off'; commit('Week cancelled; the host moves to the next week', 'Cancel week'); },
    restore: () => { const m = state.meetings.find(x => x.id === id); m.status = 'on'; commit('Meeting is back on', 'Restore week'); },
    copy: () => copySummary(id), edithh: () => householdSheet(id), addperson: () => personSheet(null), editperson: () => personSheet(id), addevent: () => addEventSheet(),
    unskip: () => { const m = state.meetings.find(x => x.id === id); m.skipped = []; closeSheet(); commit('Skip undone'); },
    shuffle: () => shuffleRemaining(), move: () => moveHousehold(id, +b.dataset.dir), undo, redo,
    savesettings: saveSettings, pull: () => { pullAndAdopt().then(() => toast('Pulled')); }, disconnect: () => { sync.setToken(null); render(); toast('Disconnected'); },
    connect: () => connectWith(v('setToken').trim(), $('#setTokenErr')),
    theme: () => { const val = b.dataset.v; store.setPref('theme', val === 'auto' ? null : val); if (val === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = val; render(); },
    export: exportJSON, importpick: () => $('#importFile').click(),
    resetlocal: () => openSheet('Clear this device?', '<p class="muted">The local copy and token are removed from this browser. Your cloud copy stays.</p>', [{ label: 'Clear', cls: 'danger', onClick: () => { store.clear(); sync.setToken(null); location.reload(); } }, { label: 'Keep', onClick: closeSheet }])
  };
  if (acts[act]) acts[act]();
});
document.addEventListener('change', e => { if (e.target.id === 'importFile' && e.target.files[0]) importJSON(e.target.files[0]); });
document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
$('#sheetClose').addEventListener('click', closeSheet); $('#backdrop').addEventListener('click', closeSheet);
$('#tokenGo').addEventListener('click', () => connectWith(v('tokenIn').trim(), $('#tokenErr')));
$('#tokenIn').addEventListener('keydown', e => { if (e.key === 'Enter') connectWith(v('tokenIn').trim(), $('#tokenErr')); });
$('#startLocal').addEventListener('click', () => { state = store.normalize(store.emptyState(today()), today()); ensureSeason(); replan(); store.save(state); lastSaved = JSON.stringify(state); showApp(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state) { replan(); render(); pullAndAdopt(); } });
window.addEventListener('online', () => sync.flushNow());
window.addEventListener('pagehide', () => sync.flushNow());

window.__bs = { get state() { return state; }, plan: () => plan(state, today()), queue: () => currentQueue(state, today()), today, version: VERSION };
boot();
