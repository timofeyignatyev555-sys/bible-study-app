// Bible Study: roster, calendar, attendance and hosting rotation. Phone-first, local-first, mirrored to the cloud.
// The group page (group/) reads and writes the same cloud copy through the worker; sync merges those changes in.
import { plan, todayISO, hostStats, attendanceStats, fillSeason, currentQueue, shuffle, isPast, hasAttendance, weekdayOf, addDays, householdLabel, reassignHost, nextInLine, liveHouseholds, setHold } from './rotation.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { calendarHTML, shortName, shiftMonth, startMonth } from './calgrid.js';

const VERSION = '2.1.0';
let state = null;
let tab = 'home'; // home | settings
let view = null;  // home body: list | cal | people (remembered per device)
let peopleFilter = '';
let calMonth = null; // 'YYYY-MM' shown in the month view

// ---------- helpers
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const today = () => todayISO();
const parts = iso => iso.split('-').map(Number);
function fmtDate(iso) { const [, m, d] = parts(iso); return `${DOW[weekdayOf(iso)].slice(0, 3)}, ${MON[m - 1]} ${d}`; }
function fmtLong(iso) { const [, m, d] = parts(iso); return `${DOW[weekdayOf(iso)]}, ${MONL[m - 1]} ${d}`; }
function fmtShort(iso) { const [, m, d] = parts(iso); return `${MON[m - 1]} ${d}`; }
function fmtTime(t) { if (!t) return ''; const [h, mi] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const hh = ((h + 11) % 12) + 1; return `${hh}:${String(mi).padStart(2, '0')} ${ap}`; }
function fmtStamp(iso) { if (!iso) return 'never'; const d = new Date(iso); return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
const initials = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const mapsUrl = a => 'https://maps.google.com/?q=' + encodeURIComponent(a);
const sorted = () => [...state.meetings].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const hh = id => state.households.find(h => h.id === id) || null;
const person = id => state.people.find(p => p.id === id) || null;
const meeting = id => state.meetings.find(m => m.id === id) || null;
const activePeople = () => state.people.filter(p => p.active !== false);
const members = h => activePeople().filter(p => p.householdId === h.id).map(p => p.name);
const hostLabel = h => householdLabel(state, h);
const isHome = m => m.status === 'on' && !m.location;
function whereText(m) {
  if (m.location) return m.location.name || 'Other place';
  const h = hh(m.hostHouseholdId);
  return h ? hostLabel(h) : (m.status === 'on' ? 'No host yet' : '');
}
function whereAddr(m) { if (m.location) return m.location.address || ''; const h = hh(m.hostHouseholdId); return h ? h.address || '' : ''; }
function hostStatusText(h) {
  if (h.hostStatus === 'never') return 'never hosts';
  if (h.hostStatus === 'unavailable') return h.unavailableUntil ? `on hold until ${fmtShort(h.unavailableUntil)}` : 'on hold';
  return '';
}
// Where a household sits in the plan, in words: "hosts Dec 18" or "#3 in line after the season".
function placement(hid) {
  const t = today(); const h = hh(hid); if (!h) return '';
  if (h.hostStatus === 'never') return 'never hosts';
  const st = hostStats(state, t)[hid];
  if (st && st.next) return 'hosts ' + fmtShort(st.next);
  const i = nextInLine(state, t).indexOf(hid);
  if (i >= 0) return `#${i + 1} in line after the season`;
  return hostStatusText(h) || 'not scheduled';
}

// Light unless the user picked dark, or "auto" and the phone is in dark mode.
function applyTheme() {
  const pref = store.getPref('theme') || 'light';
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = dark ? '#101418' : '#FAF8F4';
}

let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600); }

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
  sync.push(state, reconcile);
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
function adopt(next, msg) {
  state = store.normalize(next, today());
  ensureSeason(); replan();
  store.save(state);
  lastSaved = JSON.stringify(state);
  render();
  if (msg) toast(msg);
}
// What changed on the server since `base`, in one line for the toast.
function newsSince(b, server) {
  const seen = new Set((b && b.log || []).map(e => e.id));
  const fresh = (server.log || []).filter(e => !seen.has(e.id));
  if (!fresh.length) return 'Updated from your other device';
  return fresh.length === 1 ? fresh[0].text : `${fresh.length} changes from the group`;
}
// Bring this device and the cloud copy together. Called after every pull and on a push conflict.
function reconcile(server) {
  if (!state) { if (server) { adopt(server); sync.setBase(server); } return; }
  if (!server) { sync.push(state, reconcile); return; }
  if (server.updatedAt === state.updatedAt) { sync.setBase(server); return; }
  const b = sync.base();
  if (!b) { // first sync after the upgrade: newer copy wins once, then we have a base
    sync.setBase(server);
    if ((server.updatedAt || '') > (state.updatedAt || '')) adopt(server, 'Updated from the cloud');
    else sync.push(state, reconcile);
    return;
  }
  const serverMoved = server.updatedAt !== b.updatedAt, localMoved = state.updatedAt !== b.updatedAt;
  if (!serverMoved) { if (localMoved) sync.push(state, reconcile); return; }
  const news = newsSince(b, server);
  sync.setBase(server);
  if (!localMoved) { adopt(server, news); return; }
  const merged = store.merge3(b, state, server, today());
  merged.updatedAt = new Date().toISOString();
  adopt(merged, news);
  sync.push(state, reconcile);
}
async function pullAndAdopt() {
  try { const r = await sync.pull(); if (r) reconcile(r.state); } catch {}
}

function showConnect(err) {
  $('#connect').classList.remove('hidden'); $('#app').classList.add('hidden');
  const e = $('#tokenErr'); if (err) { e.textContent = err; e.classList.remove('hidden'); } else e.classList.add('hidden');
}
function showApp() { $('#connect').classList.add('hidden'); $('#app').classList.remove('hidden'); render(); }

async function boot() {
  applyTheme();
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('token')) { sync.setToken(hash.get('token')); history.replaceState(null, '', location.pathname + location.search); }
  const local = store.load();
  if (local) {
    state = store.normalize(local, today()); ensureSeason(); replan(); lastSaved = JSON.stringify(state); showApp(); pullAndAdopt();
  } else if (sync.token()) {
    try {
      const r = await sync.pull();
      if (r && r.state) { adopt(r.state); sync.setBase(r.state); showApp(); toast('Connected'); }
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
  const u = hist('undo'), r = hist('redo');
  $('#topRight').innerHTML = `<span class="btn-row tight">${r.length ? `<button class="btn sm ghost" data-act="redo" title="Redo ${esc(r[r.length - 1].label)}">Redo</button>` : ''}<button class="btn sm ghost" data-act="undo" ${u.length ? '' : 'disabled'} title="${esc(u.length ? 'Undo ' + u[u.length - 1].label : 'Nothing to undo')}">Undo</button>${tab === 'home' ? `<button class="btn sm ghost icon" data-act="tab" data-tab="settings" aria-label="Settings"><svg class="gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>` : `<button class="btn sm primary" data-act="tab" data-tab="home">Done</button>`}</span>`;
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + tab));
  ({ home: renderHome, settings: renderSettings })[tab]();
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
  if (isHome(m) && m.hostMode === 'pinned' && m.hostHouseholdId && !isPast(m, today())) c.push('<span class="chip accent">swapped</span>');
  if (m.status === 'on' && hasAttendance(m)) c.push(`<span class="chip ok">${Object.keys(m.attendance).length} came</span>`);
  else if (isHome(m) && !m.hostHouseholdId && !isPast(m, today())) c.push('<span class="chip crit">no host</span>');
  return c.join('');
}

function heroHTML() {
  const t = today();
  const upcoming = sorted().filter(m => m.date >= t);
  const next = upcoming[0];
  let html = '';
  if (!next) {
    html += `<div class="card"><h2>Season complete</h2><p class="muted" style="margin-top:6px">Extend the season in Settings to plan more weeks.</p></div>`;
  } else {
    const when = next.date === t ? 'Tonight' : (next.date <= addDays(t, 6) ? 'This ' + DOW[weekdayOf(next.date)] : 'Next meeting');
    const addr = whereAddr(next);
    const leader = person(next.leaderId);
    const h = hh(next.hostHouseholdId);
    html += `<div class="card hero ${next.status === 'off' ? 'off' : ''}">
      <div class="between"><span class="eyebrow">${when}${next.status === 'on' ? ' · ' + fmtTime(next.time) : ''}</span><span>${chipsFor(next)}</span></div>
      <div class="date">${fmtLong(next.date)}</div>
      ${next.status === 'off' ? `<div class="host muted">No meeting this week</div>` : `
      ${next.kind === 'event' && next.title ? `<div class="evt">${esc(next.title)}</div>` : ''}
      <div class="who"><span class="lbl">${next.location ? 'At' : 'Host'}</span><span class="host">${esc(whereText(next))}</span></div>
      <div class="addr">${addr ? `<a href="${mapsUrl(addr)}" target="_blank" rel="noopener">${esc(addr)}</a>` : `<span class="dim">No address yet</span>${h ? ` <button class="linkbtn" data-act="edithh" data-id="${h.id}">add it</button>` : ''}`}</div>
      ${next.topic || leader ? `<div class="meta">${next.topic ? `<span>${esc(next.topic)}</span>` : ''}${leader ? `<span>led by ${esc(leader.name)}</span>` : ''}</div>` : ''}`}
      ${next.notes ? `<p class="dim" style="margin-top:8px;white-space:pre-wrap">${esc(next.notes)}</p>` : ''}
      <div class="btn-row" style="margin-top:14px">
        ${next.status === 'on' ? `<button class="btn primary" data-act="attendance" data-id="${next.id}">Attendance${hasAttendance(next) ? ` (${Object.keys(next.attendance).length})` : ''}</button>` : ''}
        <button class="btn" data-act="week" data-id="${next.id}">Change this week</button>
      </div>
      ${next.status === 'on' ? `<button class="linkbtn" style="margin-top:10px" data-act="copy" data-id="${next.id}">Copy details for the group chat</button>` : ''}
    </div>`;
  }
  const missing = upcoming.slice(0, 5).filter(m => isHome(m) && m.hostHouseholdId && !whereAddr(m)).length;
  if (missing) html += `<div class="notice">${missing} of the next ${Math.min(5, upcoming.length)} hosts ${missing === 1 ? 'has' : 'have'} no address yet. Share the group link so they can add it.</div>`;
  return html;
}

// The admin home: the same layout the group sees (this week, hosting list, calendar) plus the leader's tools.
function renderHome() {
  if (!view) view = store.getPref('view') || 'list';
  const log = (state.log || []).slice(-8).reverse();
  let html = heroHTML();
  html += `<div class="btn-row admin-actions"><button class="btn" data-act="addperson">+ Add people</button><button class="btn" data-act="addevent">+ Add event</button><button class="btn" data-act="sharegroup">Share link</button></div>
  <div class="seg">${[['list', 'Hosting list'], ['cal', 'Calendar'], ['people', 'People']].map(([k, l]) => `<button data-act="view" data-v="${k}" aria-pressed="${view === k}">${l}</button>`).join('')}</div>
  <div id="viewBody" class="stack" style="gap:20px"></div>`;
  if (log.length) html += `<details class="adv" id="recentA" ${store.getPref('recentOpen') ? 'open' : ''}><summary>Recent changes from the group (${log.length})</summary><div class="list" style="margin-top:8px">${log.map(e => `<div class="row"><div class="main"><div class="t" style="font-weight:500">${esc(e.text)}</div><div class="s">${fmtStamp(e.at)}</div></div></div>`).join('')}</div></details>`;
  $('#p-home').innerHTML = html;
  ({ list: renderHosting, cal: renderCalendar, people: renderPeople })[view]();
}

function rowMeeting(m, opts = {}) {
  const t = today();
  const past = isPast(m, t) && m.date < t;
  const leader = person(m.leaderId);
  const addr = whereAddr(m);
  const sub = opts.hosting
    ? (m.status === 'off' ? '' : (addr || (isHome(m) && m.hostHouseholdId ? 'no address yet' : '')))
    : [m.status === 'on' ? fmtTime(m.time) : '', m.topic, leader ? 'led by ' + leader.name.split(' ')[0] : ''].filter(Boolean).join(' · ');
  const title = m.status === 'off' ? '<span class="muted">No meeting</span>' : esc((m.kind === 'event' && m.title ? m.title + ' · ' : '') + whereText(m));
  return `<button class="row tap ${past ? 'past' : ''}" data-act="week" data-id="${m.id}"><div class="when"><b>${fmtShort(m.date)}</b>${DOW[weekdayOf(m.date)].slice(0, 3)}</div><div class="main"><div class="t">${title}</div><div class="s ${opts.hosting && isHome(m) && m.hostHouseholdId && !addr ? 'warn' : ''}">${esc(sub) || '&nbsp;'}</div></div><div class="k">${chipsFor(m)}</div></button>`;
}

// Calendar rows for the month grid: same data as every list, so swaps, new people and addresses show up here too.
function calRows() {
  const t = today();
  return sorted().map(m => {
    const h = hh(m.hostHouseholdId);
    const short = m.location ? (m.kind === 'event' && m.title ? m.title : (m.location.name || 'Elsewhere')) : (m.kind === 'event' && m.title ? m.title : (h ? shortName(hostLabel(h)) : 'No host'));
    return { id: m.id, date: m.date, status: m.status, kind: m.kind, short, past: isPast(m, t) && m.date < t, noAddr: isHome(m) && !!h && !h.address };
  });
}
function renderCalendar() {
  const ms = sorted();
  let html = '';
  if (!ms.length) html += `<div class="list"><div class="empty">No meetings yet. Set the season in Settings.</div></div>`;
  else {
    const rows = calRows();
    if (!calMonth) calMonth = startMonth(rows, today());
    html += calendarHTML(calMonth, rows, today());
    const inMonth = ms.filter(m => m.date.slice(0, 7) === calMonth);
    html += inMonth.length ? `<div class="list">${inMonth.map(m => rowMeeting(m)).join('')}</div>` : '<p class="dim">No meetings this month.</p>';
    html += '<p class="dim">Tap a day to change who hosts, swap, cancel, or take attendance.</p>';
  }
  $('#viewBody').innerHTML = html;
}

function renderPeople() {
  const st = attendanceStats(state);
  const q = peopleFilter.trim().toLowerCase();
  let html = `<div class="field"><input id="peopleSearch" type="search" placeholder="Search ${activePeople().length} people" value="${esc(peopleFilter)}" autocomplete="off"></div>`;
  const rowP = p => {
    const s = st[p.id];
    return `<button class="row tap" data-act="editperson" data-id="${p.id}"><div class="avatar">${initials(p.name)}</div><div class="main"><div class="t">${esc(p.name)}${p.active === false ? '<span class="chip">inactive</span>' : ''}</div><div class="s">${esc(p.active === false ? '' : placement(p.householdId))}</div></div><div class="k">${s && s.total ? `${s.pct}%<br><span class="dim">${s.present}/${s.total}</span>` : '<span class="dim">no data</span>'}</div></button>`;
  };
  const shown = state.people.filter(p => !q || p.name.toLowerCase().includes(q));
  const inactive = shown.filter(p => p.active === false);
  const active = shown.filter(p => p.active !== false);
  const single = active.filter(p => { const h = hh(p.householdId); return !h || members(h).length <= 1; }).sort((a, b) => a.name.localeCompare(b.name));
  const multi = state.households.filter(h => members(h).length > 1).sort((a, b) => hostLabel(a).localeCompare(hostLabel(b)));
  for (const h of multi) {
    const ps = active.filter(p => p.householdId === h.id).sort((a, b) => a.name.localeCompare(b.name));
    if (!ps.length) continue;
    html += `<div class="eyebrow month">${esc(hostLabel(h))}</div><div class="list">${ps.map(rowP).join('')}</div>`;
  }
  if (multi.length && single.length) html += `<div class="eyebrow month">Everyone else</div>`;
  if (single.length) html += `<div class="list">${single.map(rowP).join('')}</div>`;
  if (inactive.length) html += `<div class="eyebrow month">Inactive</div><div class="list">${inactive.map(rowP).join('')}</div>`;
  if (!shown.length) html += `<div class="list"><div class="empty">${q ? 'No one matches.' : 'No people yet. Tap + Add.'}</div></div>`;
  $('#viewBody').innerHTML = html;
  const inp = $('#peopleSearch');
  inp.addEventListener('input', () => { peopleFilter = inp.value; const pos = inp.selectionStart; renderPeople(); const n = $('#peopleSearch'); n.focus(); try { n.setSelectionRange(pos, pos); } catch {} });
}

function renderHosting() {
  const t = today();
  const ms = sorted();
  const upcoming = ms.filter(m => m.date >= t);
  const done = ms.filter(m => isPast(m, t) && m.date < t && m.status === 'on');
  const line = nextInLine(state, t);
  const resting = liveHouseholds(state).filter(h => h.hostStatus !== 'available' && !line.includes(h.id) && !upcoming.some(m => m.hostHouseholdId === h.id)).sort((a, b) => hostLabel(a).localeCompare(hostLabel(b)));
  const hhRow = (h, lead, sub) => `<button class="row tap" data-act="edithh" data-id="${h.id}">${lead}<div class="main"><div class="t">${esc(hostLabel(h))}${h.hostStatus !== 'available' ? ` <span class="chip warn">${esc(hostStatusText(h))}</span>` : ''}</div><div class="s ${h.address ? '' : 'warn'}">${esc(sub ?? (h.address || 'no address yet'))}</div></div></button>`;
  let html = `<section><div class="eyebrow">Schedule · tap a week to change it</div><div class="list">${upcoming.length ? upcoming.map(m => rowMeeting(m, { hosting: true })).join('') : '<div class="empty">No weeks left. Extend the season in Settings.</div>'}</div></section>`;
  html += `<section><div class="eyebrow">Next in line after ${upcoming.length ? fmtShort(upcoming[upcoming.length - 1].date) : 'the season'}</div><div class="list">${line.length ? line.map((id, i) => hhRow(hh(id), `<div class="n">${i + 1}</div>`)).join('') : '<div class="empty">Everyone who can host is already on the schedule.</div>'}</div>
  ${line.length > 1 ? `<button class="btn sm ghost" style="align-self:flex-start" data-act="shuffle">Shuffle this order</button>` : ''}</section>`;
  if (resting.length) html += `<section><div class="eyebrow">On hold / not hosting · tap a name to edit</div><div class="list">${resting.map(h => hhRow(h, '', [hostStatusText(h), h.note].filter(Boolean).join(' · '))).join('')}</div></section>`;
  if (done.length) html += `<details class="adv"><summary>Already hosted (${done.length})</summary><div class="list" style="margin-top:8px">${done.slice().reverse().map(m => rowMeeting(m, { hosting: true })).join('')}</div></details>`;
  $('#viewBody').innerHTML = html;
}

function syncLine() {
  const s = sync.status;
  if (!sync.token()) return `<span class="chip">not connected</span> <span class="dim">This device only.</span>`;
  const label = { ok: 'Synced', syncing: 'Syncing…', offline: 'Offline, will retry', forbidden: 'Token rejected', local: 'Not connected' }[s.state] || s.state;
  return `<span class="chip ${s.state === 'ok' ? 'ok' : s.state === 'forbidden' ? 'crit' : 'warn'}">${label}</span> <span class="dim">last sync ${fmtStamp(s.lastSync)}</span>`;
}

function renderSettings() {
  const s = state.settings;
  const theme = store.getPref('theme') || 'light';
  const link = sync.cachedGroupLink();
  $('#p-settings').innerHTML = `
  <section><h2>Group link</h2><div class="card stack" style="gap:12px">
    <p class="muted">Members see the hosting schedule and the calendar, and nothing else. They can add their own address and record a swap when they can't host. Their changes show up here.</p>
    ${sync.token() ? `${link ? `<div class="mono dim" style="word-break:break-all">${esc(link)}</div>` : ''}
    <div class="btn-row"><button class="btn primary" data-act="sharegroup">${link ? 'Share link' : 'Get link'}</button>${link ? `<button class="btn" data-act="copygroup">Copy</button><button class="btn" data-act="openGroup">Open</button>` : ''}</div>
    ${link ? `<button class="linkbtn" data-act="resetgroup">Reset the link (the old one stops working)</button>` : ''}` : `<p class="dim">Connect sync below first.</p>`}
  </div></section>
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
    ${sync.token() ? `<div class="btn-row"><button class="btn" data-act="pull">Pull now</button><button class="btn" data-act="copytoken">Copy token</button><button class="btn" data-act="disconnect">Disconnect this device</button></div>
    <p class="dim">Setting up another phone, or adding this app to the home screen again? Tap Copy token first, then paste it on the new device's Connect screen. Keep it private: it unlocks the whole roster.</p>` : `<div class="field"><label for="setToken">Sync token</label><input id="setToken" type="password" autocomplete="off" placeholder="paste token"></div><div class="err hidden" id="setTokenErr"></div><button class="btn primary" data-act="connect">Connect</button>`}
  </div></section>
  <section><h2>Appearance</h2><div class="card"><div class="seg">${['light', 'dark', 'auto'].map(v => `<button data-act="theme" data-v="${v}" aria-pressed="${theme === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div></section>
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
function wireSeg(id, onChange) {
  const seg = document.getElementById(id);
  seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); onChange && onChange(b.dataset.v); }));
}
const actRow = (act, id, title, sub, cls = '') => `<button class="row tap ${cls}" data-act="${act}" data-id="${id}"><div class="main"><div class="t">${title}</div>${sub ? `<div class="s wrap">${sub}</div>` : ''}</div><div class="k">›</div></button>`;

// One sheet for everything about a week: who hosts, swap, can't host, cancel, details.
function weekSheet(id) {
  const m = meeting(id); if (!m) return;
  const t = today();
  const past = isPast(m, t) && m.date < t;
  const h = hh(m.hostHouseholdId);
  const addr = whereAddr(m);
  let head;
  if (m.status === 'off') head = `<div class="who"><span class="host muted">No meeting this week</span></div>`;
  else head = `${m.kind === 'event' && m.title ? `<div class="evt">${esc(m.title)}</div>` : ''}
    <div class="who"><span class="lbl">${m.location ? 'At' : 'Host'}</span><span class="host">${esc(whereText(m))}</span></div>
    <div class="addr">${addr ? `<a href="${mapsUrl(addr)}" target="_blank" rel="noopener">${esc(addr)}</a>` : '<span class="dim">No address yet</span>'} · ${fmtTime(m.time)}</div>
    ${isHome(m) && m.hostMode === 'pinned' && !past ? '<p class="dim">Set by hand (a swap or your pick). The rest of the schedule works around it.</p>' : ''}`;
  const acts = [];
  if (!past && isHome(m)) {
    acts.push(actRow('pickhost', m.id, h ? 'Someone else hosts' : 'Pick a host', h ? `Pick who takes ${fmtShort(m.date)}. If they already have a week, the two of them trade.` : 'Nobody is free in the line for this week.'));
    if (h) acts.push(actRow('canthost', m.id, `${esc(hostLabel(h))} can't host`, `The next person in line takes this week and ${esc(hostLabel(h))} hosts the week after. Everyone after shifts by one.`));
    if (m.hostMode === 'pinned') acts.push(actRow('autohost', m.id, 'Back to the normal order', 'Undo the swap or pick for this week.'));
  }
  if (h) acts.push(actRow('edithh', h.id, `${esc(hostLabel(h))}: address and availability`, esc(h.address || 'No address yet')));
  if (m.status === 'on' && (m.date <= t || hasAttendance(m))) acts.push(actRow('attendance', m.id, 'Attendance', hasAttendance(m) ? `${Object.keys(m.attendance).length} marked present` : 'Mark who came'));
  if (!past) acts.push(m.status === 'on' ? actRow('cancel', m.id, 'No meeting this week', 'Nobody loses their turn; the host moves to the next week.') : actRow('restore', m.id, 'Meeting is on after all', ''));
  acts.push(actRow('editmeeting', m.id, 'Edit time, topic, place, notes', ''));
  if (m.status === 'on') acts.push(actRow('copy', m.id, 'Copy details for the group chat', ''));
  openSheet(fmtLong(m.date), `<div class="sheet-hero">${head}</div><div class="list">${acts.join('')}</div>`);
}

function pickHostSheet(id) {
  const m = meeting(id); if (!m) return;
  const t = today();
  const st = hostStats(state, t);
  const cur = m.hostHouseholdId ? hh(m.hostHouseholdId) : null;
  const line = nextInLine(state, t);
  const cands = liveHouseholds(state).filter(h => h.id !== m.hostHouseholdId && h.hostStatus !== 'never');
  const scheduled = cands.filter(h => st[h.id].next).sort((a, b) => st[a.id].next < st[b.id].next ? -1 : 1);
  const waiting = cands.filter(h => !st[h.id].next).sort((a, b) => { const i = line.indexOf(a.id), j = line.indexOf(b.id); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j) || hostLabel(a).localeCompare(hostLabel(b)); });
  const row = (h, sub) => `<button class="row tap" data-pick="${h.id}"><div class="main"><div class="t">${esc(hostLabel(h))}${h.hostStatus !== 'available' ? `<span class="chip warn">${esc(hostStatusText(h))}</span>` : ''}</div><div class="s wrap">${sub}</div></div></button>`;
  const curName = cur ? esc(hostLabel(cur)) : '';
  const body = `<p class="muted">Who hosts ${fmtLong(m.date)}?</p>
  ${scheduled.length ? `<div class="eyebrow">Already have a week: trade</div><div class="list">${scheduled.map(h => row(h, `Hosts ${fmtShort(st[h.id].next)}${cur ? ` · ${curName} takes ${fmtShort(st[h.id].next)} instead` : ''}`)).join('')}</div>` : ''}
  ${waiting.length ? `<div class="eyebrow">Not on the schedule yet</div><div class="list">${waiting.map(h => row(h, `${line.includes(h.id) ? `#${line.indexOf(h.id) + 1} in line` : 'not hosting right now'}${cur ? ` · ${curName} moves to the next week` : ''}`)).join('')}</div>` : ''}`;
  openSheet('Someone else hosts', body);
  $('#sheetBody').querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
    const r = reassignHost(state, m.id, b.dataset.pick, t);
    if (r.error) { toast(r.error); return; }
    const to = hostLabel(hh(r.to));
    closeSheet();
    commit(r.kind === 'trade' ? `${to} hosts ${fmtShort(r.date)}; ${hostLabel(hh(r.from))} hosts ${fmtShort(r.otherDate)}` : `${to} hosts ${fmtShort(r.date)}`, `${to} hosts ${fmtShort(r.date)}`);
  }));
}

function cantHost(id) {
  const m = meeting(id); if (!m || !m.hostHouseholdId) return;
  const h = hh(m.hostHouseholdId);
  m.skipped = [...(m.skipped || []), h.id]; m.hostMode = 'auto';
  closeSheet();
  commit(null, `${hostLabel(h)} can't host ${fmtShort(m.date)}`);
  const nm = meeting(id); const nh = hh(nm.hostHouseholdId);
  toast(`${nh ? hostLabel(nh) : 'Nobody'} hosts ${fmtShort(nm.date)}; ${hostLabel(h)} ${placement(h.id)}`);
}

function meetingSheet(id) {
  const m = meeting(id); if (!m) return;
  const isSeasonDay = weekdayOf(m.date) === state.settings.weekday && m.date >= state.settings.seasonStart && m.date <= state.settings.seasonEnd;
  const body = `
  <div class="grid2">
    <div class="field"><label for="mDate">Date</label><input id="mDate" type="date" value="${m.date}"></div>
    <div class="field"><label for="mTime">Time</label><input id="mTime" type="time" value="${esc(m.time)}"></div>
  </div>
  <div class="field"><label>Type</label><div class="seg" id="mKind"><button data-v="study" aria-pressed="${m.kind !== 'event'}">Study</button><button data-v="event" aria-pressed="${m.kind === 'event'}">Special event</button></div></div>
  <div class="field ${m.kind === 'event' ? '' : 'hidden'}" id="mTitleWrap"><label for="mTitle">Event name</label><input id="mTitle" value="${esc(m.title)}" placeholder="e.g. Bonfire night"></div>
  <div class="field"><label>Where</label><div class="seg" id="mWhere"><button data-v="home" aria-pressed="${!m.location}">At the host's home</button><button data-v="place" aria-pressed="${!!m.location}">Somewhere else</button></div></div>
  <div id="mPlaceWrap" class="grid2 ${m.location ? '' : 'hidden'}"><div class="field"><label for="mPlace">Place</label><input id="mPlace" value="${esc(m.location ? m.location.name : '')}" placeholder="Church"></div><div class="field"><label for="mPlaceAddr">Address</label><input id="mPlaceAddr" value="${esc(m.location ? m.location.address : '')}"></div></div>
  <div class="field"><label for="mTopic">Topic / passage</label><input id="mTopic" value="${esc(m.topic)}" placeholder="e.g. Romans 8"></div>
  <div class="field"><label for="mLeader">Led by</label><select id="mLeader"><option value="">–</option>${activePeople().sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}" ${m.leaderId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
  <div class="field"><label for="mNotes">Notes (only you see these)</label><textarea id="mNotes">${esc(m.notes)}</textarea></div>
  ${m.skipped && m.skipped.length ? `<div class="notice">Couldn't host this date: ${esc(m.skipped.map(i => hostLabel(hh(i)) || '?').join(', '))} <button class="btn sm ghost" data-act="unskip" data-id="${m.id}">undo</button></div>` : ''}
  ${isSeasonDay ? `<p class="dim">This is a regular ${DOW[state.settings.weekday]}; use "No meeting this week" to cancel it rather than deleting.</p>` : ''}`;
  const foot = [{ label: 'Save', cls: 'primary', onClick: () => {
    const kind = $('#mKind [aria-pressed="true"]').dataset.v, where = $('#mWhere [aria-pressed="true"]').dataset.v;
    const date = v('mDate'); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Pick a date'); return; }
    if (date !== m.date && state.meetings.some(x => x.id !== m.id && x.date === date)) { toast('There is already a meeting on that date'); return; }
    Object.assign(m, { date, time: v('mTime') || state.settings.defaultTime, kind, title: v('mTitle').trim(), topic: v('mTopic').trim(), leaderId: v('mLeader') || null, notes: v('mNotes').trim() });
    if (where === 'place') { m.location = { name: v('mPlace').trim() || 'Other place', address: v('mPlaceAddr').trim() }; m.hostHouseholdId = null; m.hostMode = 'auto'; }
    else m.location = null;
    closeSheet(); commit('Saved');
  } }];
  if (!isSeasonDay) foot.push({ label: 'Delete', cls: 'danger', onClick: () => { state.meetings = state.meetings.filter(x => x.id !== m.id); closeSheet(); commit('Deleted'); } });
  openSheet(fmtDate(m.date), body, foot);
  wireSeg('mWhere', val => $('#mPlaceWrap').classList.toggle('hidden', val !== 'place'));
  wireSeg('mKind', val => $('#mTitleWrap').classList.toggle('hidden', val !== 'event'));
}

function attendanceSheet(id) {
  const m = meeting(id); if (!m) return;
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

function newHousehold(name, address = '') {
  const nh = { id: store.uid('h'), name, address, hostStatus: 'available', unavailableUntil: null, note: '' };
  state.households.push(nh); state.rotation.order.push(nh.id);
  return nh;
}
function householdOptions(selected) {
  return [...state.households].filter(h => members(h).length).sort((a, b) => hostLabel(a).localeCompare(hostLabel(b)))
    .map(h => `<option value="${h.id}" ${selected === h.id ? 'selected' : ''}>${esc(hostLabel(h))}</option>`).join('');
}

function personSheet(id, presetHid = '') {
  const p = id ? person(id) : { id: null, name: '', phone: '', notes: '', householdId: '', active: true };
  const ownH = id ? hh(p.householdId) : null;
  const alone = ownH && state.people.filter(x => x.householdId === ownH.id).length === 1;
  const body = `
  ${id ? '' : `<div class="seg" id="pMode"><button data-v="one" aria-pressed="true">One person</button><button data-v="many" aria-pressed="false">Several at once</button></div>`}
  <div id="pOne" class="stack" style="gap:14px">
    <div class="field"><label for="pName">Name</label><input id="pName" value="${esc(p.name)}" autocomplete="off" placeholder="First and last name"></div>
    <div class="field"><label for="pHH">Lives with</label><select id="pHH"><option value="">Nobody in the group (hosts on their own)</option>${householdOptions(id && !alone ? p.householdId : presetHid)}</select></div>
    <div class="field" id="pAddrWrap"><label for="pAddr">Address for hosting</label><input id="pAddr" value="${esc(alone ? ownH.address : '')}" placeholder="Street, City (optional)" autocomplete="off"></div>
    <div class="field"><label for="pPhone">Phone</label><input id="pPhone" type="tel" value="${esc(p.phone)}"></div>
    <div class="field"><label for="pNotes">Notes</label><textarea id="pNotes">${esc(p.notes)}</textarea></div>
    ${id ? `<div class="field"><label>Status</label><div class="seg" id="pActive"><button data-v="1" aria-pressed="${p.active !== false}">Active</button><button data-v="0" aria-pressed="${p.active === false}">Inactive</button></div></div><p class="dim">Inactive people are hidden from attendance and their household stops hosting; their history stays.</p>` : `<p class="dim">They can add their address themselves from the group link. New people join the hosting line right after everyone who hasn't hosted yet.</p>`}
  </div>
  ${id ? '' : `<div id="pMany" class="stack hidden" style="gap:10px"><div class="field"><label for="pNames">Names, one per line</label><textarea id="pNames" style="min-height:160px" placeholder="Anna Smith&#10;John Smith"></textarea></div><p class="dim">Each person hosts on their own and joins the end of the hosting line. To put siblings together, open a person afterwards and set "Lives with".</p></div>`}`;
  const save = () => {
    if (!id && $('#pMode [aria-pressed="true"]').dataset.v === 'many') {
      const names = v('pNames').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!names.length) { toast('Type at least one name'); return; }
      const now = new Date().toISOString();
      for (const name of names) { const nh = newHousehold(name); state.people.push({ id: store.uid('p'), name, phone: '', notes: '', active: true, createdAt: now, householdId: nh.id }); }
      closeSheet(); commit(`Added ${names.length} ${names.length === 1 ? 'person' : 'people'} to the hosting line`, `Add ${names.length} people`);
      return;
    }
    const name = v('pName').trim(); if (!name) { toast('Name is required'); return; }
    const hid = v('pHH'); const addr = v('pAddr').trim();
    let target;
    if (!id) {
      const np = { id: store.uid('p'), name, phone: v('pPhone').trim(), notes: v('pNotes').trim(), active: true, createdAt: new Date().toISOString(), householdId: hid };
      if (!hid) np.householdId = newHousehold(name, addr).id;
      state.people.push(np); target = np;
    } else {
      const oldName = p.name;
      Object.assign(p, { name, phone: v('pPhone').trim(), notes: v('pNotes').trim(), active: $('#pActive [aria-pressed="true"]').dataset.v === '1' });
      if (!hid) {
        if (alone) { if (ownH.name === oldName) ownH.name = name; ownH.address = addr; }
        else p.householdId = newHousehold(name, addr).id;
      } else p.householdId = hid;
      pruneEmptyHouseholds(); target = p;
    }
    closeSheet(); commit(null, id ? `Edit ${name}` : `Add ${name}`);
    toast(`${id ? 'Saved' : 'Added'}: ${hostLabel(hh(target.householdId))} ${placement(target.householdId)}`);
  };
  const foot = [{ label: id ? 'Save' : 'Add', cls: 'primary', onClick: save }];
  if (id) foot.push({ label: 'Delete', cls: 'danger', onClick: () => {
    openSheet('Delete ' + p.name + '?', `<p class="muted">This removes them from the roster permanently. To keep their history, mark them inactive instead.</p>`, [
      { label: 'Delete', cls: 'danger', onClick: () => { state.people = state.people.filter(x => x.id !== id); pruneEmptyHouseholds(); closeSheet(); commit('Deleted'); } },
      { label: 'Keep', onClick: () => personSheet(id) }]);
  } });
  openSheet(id ? 'Edit person' : 'Add people', body, foot);
  const syncAddr = () => $('#pAddrWrap').classList.toggle('hidden', !!v('pHH'));
  $('#pHH').addEventListener('change', syncAddr); syncAddr();
  if (id) wireSeg('pActive');
  else wireSeg('pMode', val => { $('#pOne').classList.toggle('hidden', val !== 'one'); $('#pMany').classList.toggle('hidden', val !== 'many'); });
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
  const t = today();
  const st = hostStats(state, t)[id];
  const q = currentQueue(state, t); const pos = q.indexOf(id);
  const body = `
  <div class="sheet-hero"><div class="who"><span class="host">${esc(hostLabel(h))}</span></div><div class="dim">${esc(placement(id))}${st.hosted ? ` · hosted ${st.hosted}× (last ${fmtShort(st.lastHosted)})` : ''}</div></div>
  <div class="field"><label for="hAddr">Address</label><input id="hAddr" value="${esc(h.address)}" placeholder="Street, City" autocomplete="street-address"></div>
  <div class="field"><label>Can they host?</label><div class="seg" id="hStatus"><button data-v="available" aria-pressed="${h.hostStatus === 'available'}">Yes</button><button data-v="until" aria-pressed="${h.hostStatus === 'unavailable' && !!h.unavailableUntil}">Hold until</button><button data-v="indef" aria-pressed="${h.hostStatus === 'unavailable' && !h.unavailableUntil}">On hold</button><button data-v="never" aria-pressed="${h.hostStatus === 'never'}">Never</button></div></div>
  <div class="field ${h.hostStatus === 'unavailable' && h.unavailableUntil ? '' : 'hidden'}" id="hUntilWrap"><label for="hUntil">Can host again from</label><input id="hUntil" type="date" value="${esc(h.unavailableUntil || '')}"></div>
  <div class="field"><label for="hNote">Note</label><input id="hNote" value="${esc(h.note || '')}" placeholder="e.g. remodeling until December"></div>
  ${pos >= 0 ? `<div class="field"><label>Place in the hosting order</label><div class="between"><span class="muted">#${pos + 1} of ${q.length}</span><span class="btn-row tight"><button class="btn sm" id="hUp" ${pos === 0 ? 'disabled' : ''}>Earlier</button><button class="btn sm" id="hDown" ${pos === q.length - 1 ? 'disabled' : ''}>Later</button></span></div></div>` : ''}
  <div class="field"><label for="hName">Household name</label><input id="hName" value="${esc(h.name)}"><p class="dim">For siblings, use the last name; it shows as "${esc(hostLabel(h))}".</p></div>
  ${activePeople().filter(p => p.householdId === h.id).map(p => `<div class="field"><label for="hp_${p.id}">${esc(p.name.split(' ')[0])}'s phone</label><input id="hp_${p.id}" data-pid="${p.id}" class="hphone" type="tel" value="${esc(p.phone)}" placeholder="(612) 555-0123"></div>`).join('')}
  <div class="eyebrow">Who lives here</div>
  <div class="list">${activePeople().filter(p => p.householdId === h.id).map(p => `<button class="row tap" data-act="editperson" data-id="${p.id}"><div class="avatar">${initials(p.name)}</div><div class="main"><div class="t">${esc(p.name)}</div><div class="s">edit or remove</div></div><div class="k">›</div></button>`).join('') || '<div class="empty">No active members</div>'}</div>
  <button class="btn ghost" data-act="addto" data-id="${h.id}">+ Add someone who lives here</button>`;
  openSheet('Household', body, [{ label: 'Save', cls: 'primary', onClick: () => {
    const mode = $('#hStatus [aria-pressed="true"]').dataset.v;
    h.name = v('hName').trim() || h.name; h.address = v('hAddr').trim(); h.note = v('hNote').trim();
    document.querySelectorAll('#sheetBody input.hphone').forEach(i => { const p = person(i.dataset.pid); if (p) p.phone = i.value.trim(); });
    if (mode === 'never') { h.hostStatus = 'never'; h.unavailableUntil = null; }
    else {
      if (h.hostStatus === 'never') h.hostStatus = 'available';
      const until = mode === 'until' ? v('hUntil') : null;
      if (mode === 'until' && !until) { toast('Pick the date they can host again'); return; }
      const r = setHold(state, h.id, mode !== 'available', until, today()); // also hands their swapped weeks back to the order
      if (r.error) { toast(r.error); return; }
    }
    closeSheet(); commit(null, `Edit ${hostLabel(h)}`); toast(`Saved: ${hostLabel(h)} ${placement(h.id)}`);
  } }]);
  wireSeg('hStatus', val => $('#hUntilWrap').classList.toggle('hidden', val !== 'until'));
  const mv = dir => { moveHousehold(id, dir); householdSheet(id); toast(`${hostLabel(h)} ${placement(id)}`); };
  if ($('#hUp')) { $('#hUp').addEventListener('click', () => mv(-1)); $('#hDown').addEventListener('click', () => mv(1)); }
}

function addEventSheet() {
  const t = today();
  const body = `<div class="grid2"><div class="field"><label for="eDate">Date</label><input id="eDate" type="date" value="${t}"></div><div class="field"><label for="eTime">Time</label><input id="eTime" type="time" value="${esc(state.settings.defaultTime)}"></div></div>
  <div class="field"><label for="eTitle">Event name</label><input id="eTitle" placeholder="e.g. Christmas party"></div>
  <div class="grid2"><div class="field"><label for="ePlace">Place</label><input id="ePlace" placeholder="Church"></div><div class="field"><label for="eAddr">Address</label><input id="eAddr"></div></div>
  <p class="dim">Leave the place empty to hold it at the next host's home. Everyone in the group link sees it.</p>`;
  openSheet('Add event', body, [{ label: 'Add', cls: 'primary', onClick: () => {
    const date = v('eDate'); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Pick a date'); return; }
    if (state.meetings.some(m => m.date === date)) { toast('There is already a meeting on that date. Edit it from the calendar.'); return; }
    const place = v('ePlace').trim();
    state.meetings.push({ id: store.uid('m'), date, status: 'on', kind: 'event', title: v('eTitle').trim(), time: v('eTime') || state.settings.defaultTime, hostHouseholdId: null, hostMode: 'auto', location: place ? { name: place, address: v('eAddr').trim() } : null, topic: '', leaderId: null, notes: '', attendance: {}, skipped: [] });
    closeSheet(); commit('Event added');
  } }]);
}

// ---------- actions
function copyText(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => openSheet('Copy', `<textarea class="mono" style="width:100%;min-height:120px">${esc(text)}</textarea>`));
  else openSheet('Copy', `<textarea style="width:100%;min-height:120px">${esc(text)}</textarea>`);
}
function copySummary(id) {
  const m = meeting(id); if (!m) return;
  const addr = whereAddr(m);
  const lines = [`${state.settings.name} · ${fmtDate(m.date)} at ${fmtTime(m.time)}`, `${m.kind === 'event' && m.title ? m.title + ' · ' : ''}${m.location ? 'at ' : (m.hostHouseholdId ? 'Hosted by ' : '')}${whereText(m)}${addr ? ': ' + addr : ''}`];
  if (m.topic) lines.push('Topic: ' + m.topic);
  const leader = person(m.leaderId); if (leader) lines.push('Led by ' + leader.name);
  copyText(lines.join('\n'), () => toast('Copied'));
}
async function getGroupLink(reset) {
  if (!sync.token()) { toast('Connect sync in Settings first'); return null; }
  try { return (!reset && sync.cachedGroupLink()) || await sync.groupLink(reset); }
  catch { toast('Could not reach the sync server'); return null; }
}
async function shareGroup() {
  const url = await getGroupLink(); if (!url) return;
  if (tab === 'settings') render();
  const text = `${state.settings.name} hosting schedule. Pick your name, add your address, and if you can't host your week, find someone to swap with and record it here.`;
  if (navigator.share) { try { await navigator.share({ title: state.settings.name + ' hosting', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  copyText(text + '\n' + url, () => toast('Group link copied'));
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
function shuffleLine() {
  const t = today();
  const line = nextInLine(state, t);
  const set = new Set(line);
  const mixed = shuffle(line);
  state.rotation.order = currentQueue(state, t).map(id => set.has(id) ? mixed.shift() : id);
  commit('Shuffled who is next in line', 'Shuffle');
}
function moveHousehold(id, dir) {
  const q = currentQueue(state, today());
  const i = q.indexOf(id); const j = i + dir; if (i < 0 || j < 0 || j >= q.length) return;
  [q[i], q[j]] = [q[j], q[i]]; state.rotation.order = q; commit(null, `Move ${hostLabel(hh(id))} ${dir < 0 ? 'earlier' : 'later'}`);
}
async function connectWith(t, errEl) {
  if (!t) return;
  const r = await sync.verify(t).catch(() => ({ ok: false, why: 'Could not reach the sync server.' }));
  if (!r.ok) { if (errEl) { errEl.textContent = r.why; errEl.classList.remove('hidden'); } toast(r.why); return; }
  sync.setToken(t);
  if (r.state && (!state || (r.state.updatedAt || '') > (state.updatedAt || '') || !state.people.length)) adopt(r.state);
  else if (!state) { state = store.normalize(store.emptyState(today()), today()); }
  if (r.state) sync.setBase(r.state);
  commit('Connected'); showApp();
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const { act, id } = b.dataset;
  const acts = {
    tab: () => { tab = b.dataset.tab; render(); window.scrollTo(0, 0); },
    week: () => weekSheet(id), calday: () => weekSheet(id),
    view: () => { view = b.dataset.v; store.setPref('view', view); render(); },
    addto: () => personSheet(null, id),
    calnav: () => { calMonth = shiftMonth(calMonth, +b.dataset.dir); render(); },
    pickhost: () => pickHostSheet(id), canthost: () => cantHost(id),
    autohost: () => { const m = meeting(id); m.hostMode = 'auto'; closeSheet(); commit(null, 'Back to normal order'); const nm = meeting(id); toast(`${nm.hostHouseholdId ? hostLabel(hh(nm.hostHouseholdId)) : 'Nobody'} hosts ${fmtShort(nm.date)}`); },
    attendance: () => attendanceSheet(id), editmeeting: () => meetingSheet(id),
    cancel: () => { const m = meeting(id); m.status = 'off'; closeSheet(); commit('No meeting that week; the host moves to the next week', 'Cancel week'); },
    restore: () => { const m = meeting(id); m.status = 'on'; closeSheet(); commit('Meeting is back on', 'Restore week'); },
    copy: () => copySummary(id), edithh: () => householdSheet(id), addperson: () => personSheet(null), editperson: () => personSheet(id), addevent: () => addEventSheet(),
    unskip: () => { const m = meeting(id); m.skipped = []; closeSheet(); commit('Skip undone'); },
    shuffle: shuffleLine, undo, redo,
    copytoken: () => { const t = sync.token(); if (t) copyText(t, () => toast('Token copied. Paste it on the new device.')); },
    sharegroup: shareGroup, copygroup: async () => { const u = await getGroupLink(); if (u) copyText(u, () => toast('Group link copied')); },
    openGroup: async () => { const u = await getGroupLink(); if (u) window.open(u, '_blank', 'noopener'); },
    resetgroup: () => openSheet('Reset the group link?', '<p class="muted">The current link stops working for everyone. You will need to send the new link to the group.</p>', [{ label: 'Reset', cls: 'danger', onClick: async () => { closeSheet(); const u = await getGroupLink(true); if (u) { render(); toast('New link ready; share it with the group'); } } }, { label: 'Keep', onClick: closeSheet }]),
    savesettings: saveSettings, pull: () => { pullAndAdopt().then(() => toast('Pulled')); }, disconnect: () => { sync.setToken(null); render(); toast('Disconnected'); },
    connect: () => connectWith(v('setToken').trim(), $('#setTokenErr')),
    theme: () => { const val = b.dataset.v; store.setPref('theme', val === 'light' ? null : val); applyTheme(); render(); },
    export: exportJSON, importpick: () => $('#importFile').click(),
    resetlocal: () => openSheet('Clear this device?', '<p class="muted">The local copy and token are removed from this browser. Your cloud copy stays.</p>', [{ label: 'Clear', cls: 'danger', onClick: () => { store.clear(); sync.setToken(null); location.reload(); } }, { label: 'Keep', onClick: closeSheet }])
  };
  if (acts[act]) acts[act]();
});
document.addEventListener('change', e => { if (e.target.id === 'importFile' && e.target.files[0]) importJSON(e.target.files[0]); });
document.addEventListener('toggle', e => { if (e.target.id === 'recentA') store.setPref('recentOpen', e.target.open ? '1' : null); }, true);
$('#sheetClose').addEventListener('click', closeSheet); $('#backdrop').addEventListener('click', closeSheet);
$('#tokenGo').addEventListener('click', () => connectWith(v('tokenIn').trim(), $('#tokenErr')));
$('#tokenIn').addEventListener('keydown', e => { if (e.key === 'Enter') connectWith(v('tokenIn').trim(), $('#tokenErr')); });
$('#startLocal').addEventListener('click', () => { state = store.normalize(store.emptyState(today()), today()); ensureSeason(); replan(); store.save(state); lastSaved = JSON.stringify(state); showApp(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state) { replan(); render(); pullAndAdopt(); } });
setInterval(() => { if (document.visibilityState === 'visible' && state && sync.token() && !document.body.classList.contains('modal')) pullAndAdopt(); }, 60000);
window.addEventListener('online', () => sync.flushNow());
window.addEventListener('pagehide', () => sync.flushNow());

window.__bs = { get state() { return state; }, plan: () => plan(state, today()), queue: () => currentQueue(state, today()), today, version: VERSION };
boot();
