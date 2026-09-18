// Bible Study rotation engine. Pure functions over the state document; nothing here touches the DOM or storage.
// See docs/superpowers/specs/2026-09-18-bible-study-app-design.md, "Generator".

export function todayISO(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return todayISO(dt);
}

export function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

// every date with the given weekday (0=Sun..6=Sat) in [start, end]
export function datesOfWeekday(start, end, weekday) {
  const out = [];
  let cur = start;
  const shift = (weekday - weekdayOf(start) + 7) % 7;
  cur = addDays(start, shift);
  while (cur <= end) { out.push(cur); cur = addDays(cur, 7); }
  return out;
}

export function hasAttendance(m) {
  return !!m.attendance && Object.keys(m.attendance).length > 0;
}

export function isPast(m, today) {
  return m.date < today || hasAttendance(m);
}

export function countsAsHost(m) {
  return m.status === 'on' && !!m.hostHouseholdId && !m.location;
}

export function eligible(h, date, meeting) {
  if (!h) return false;
  if (h.hostStatus === 'never') return false;
  if (h.hostStatus === 'unavailable') {
    if (!h.unavailableUntil) return false;
    if (date < h.unavailableUntil) return false;
  }
  if ((meeting.skipped || []).includes(h.id)) return false;
  return true;
}

function sortMeetings(ms) {
  return [...ms].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1)));
}

function moveToBack(queue, id) {
  const i = queue.indexOf(id);
  if (i === -1) return;
  queue.splice(i, 1);
  queue.push(id);
}

// Households that can be planned at all: exist and have at least one active person.
export function liveHouseholds(state) {
  const active = new Set(state.people.filter(p => p.active !== false).map(p => p.householdId));
  return state.households.filter(h => active.has(h.id));
}

// The queue as it stands "now": rotation order, plus missing households, with everyone who already hosted at the back.
export function currentQueue(state, today) {
  const live = liveHouseholds(state);
  const liveIds = new Set(live.map(h => h.id));
  const queue = (state.rotation?.order || []).filter(id => liveIds.has(id));
  const seen = new Set(queue);
  live.filter(h => !seen.has(h.id)).sort((a, b) => a.name.localeCompare(b.name)).forEach(h => queue.push(h.id));
  for (const m of sortMeetings(state.meetings)) {
    if (isPast(m, today) && countsAsHost(m)) moveToBack(queue, m.hostHouseholdId);
  }
  return queue;
}

// Returns { meetings, queue }. meetings = fresh array with future auto hosts (re)assigned; queue = order after replay, before future fill.
export function plan(state, today) {
  const byId = Object.fromEntries(state.households.map(h => [h.id, h]));
  const queue = currentQueue(state, today);
  const upNext = [...queue];
  const meetings = sortMeetings(state.meetings).map(m => ({ ...m, skipped: [...(m.skipped || [])], attendance: { ...(m.attendance || {}) } }));

  // pinned future hosts go to the back first so they are not also auto-assigned an earlier week
  for (const m of meetings) {
    if (isPast(m, today)) continue;
    if (m.status === 'on' && !m.location && m.hostMode === 'pinned' && m.hostHouseholdId) moveToBack(queue, m.hostHouseholdId);
  }

  for (const m of meetings) {
    if (isPast(m, today)) continue;
    if (m.status !== 'on') { if (m.hostMode !== 'pinned') m.hostHouseholdId = null; continue; }
    if (m.location) { m.hostHouseholdId = null; m.hostMode = 'auto'; continue; }
    if (m.hostMode === 'pinned' && m.hostHouseholdId && byId[m.hostHouseholdId]) { moveToBack(queue, m.hostHouseholdId); continue; }
    m.hostMode = 'auto';
    const pick = queue.find(id => eligible(byId[id], m.date, m));
    if (pick) { m.hostHouseholdId = pick; moveToBack(queue, pick); }
    else m.hostHouseholdId = null;
  }
  return { meetings, queue: upNext };
}

// Per-household numbers for the Hosting tab.
export function hostStats(state, today) {
  const out = {};
  for (const h of state.households) out[h.id] = { hosted: 0, lastHosted: null, next: null, planned: 0 };
  for (const m of sortMeetings(state.meetings)) {
    if (!countsAsHost(m)) continue;
    const s = out[m.hostHouseholdId]; if (!s) continue;
    if (isPast(m, today)) { s.hosted++; s.lastHosted = m.date; }
    else { s.planned++; if (!s.next) s.next = m.date; }
  }
  return out;
}

// Per-person attendance for the People tab: only meetings where attendance was actually taken count.
export function attendanceStats(state) {
  const taken = state.meetings.filter(m => m.status === 'on' && hasAttendance(m));
  const out = {};
  for (const p of state.people) {
    const present = taken.filter(m => m.attendance[p.id]).length;
    out[p.id] = { present, total: taken.length, pct: taken.length ? Math.round(100 * present / taken.length) : null };
  }
  return out;
}

// Make sure every season weekday has a meeting row; never removes anything.
export function fillSeason(state) {
  const s = state.settings;
  const have = new Set(state.meetings.map(m => m.date));
  const added = [];
  for (const date of datesOfWeekday(s.seasonStart, s.seasonEnd, s.weekday)) {
    if (have.has(date)) continue;
    added.push({ id: 'm_' + date, date, status: 'on', kind: 'study', title: '', time: s.defaultTime, hostHouseholdId: null, hostMode: 'auto', location: null, topic: '', leaderId: null, notes: '', attendance: {}, skipped: [] });
  }
  return added;
}

// Deterministic shuffle helper (Fisher-Yates with an injectable rng) used by the seed and the Hosting tab.
export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
