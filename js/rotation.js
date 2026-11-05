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
  const meetings = sortMeetings(state.meetings).map(m => ({ ...m, skipped: [...(m.skipped || [])], attendance: { ...(m.attendance || {}) }, devoSkipped: [...(m.devoSkipped || [])] }));

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
  assignDevos(state, meetings, today);
  return { meetings, queue: upNext };
}

// ---------- Friday devotional: one man per meeting, in his own line, on the same rules as hosting.
export function activeMen(state) {
  return state.people.filter(p => p.gender === 'm' && p.active !== false);
}

// Should this week have a devotional at all? A regular study does (even if moved to another day), and so does anything on the meeting weekday. A one-off Saturday party does not.
export function devoWeek(m, state) {
  return m.status === 'on' && (m.kind !== 'event' || weekdayOf(m.date) === state.settings?.weekday);
}
export function devoApplies(m, state) {
  return devoWeek(m, state) && !m.devoOff;
}

export function devoEligible(p, date, meeting) {
  if (!p || p.devoStatus === 'never') return false;
  if (p.devoStatus === 'unavailable' && (!p.devoUntil || date < p.devoUntil)) return false;
  return !(meeting.devoSkipped || []).includes(p.id);
}

// The men's line as it stands "now": their order, plus any man missing from it, with everyone who already gave one at the back.
export function devoQueue(state, today) {
  const men = activeMen(state);
  const ids = new Set(men.map(p => p.id));
  const queue = (state.devotion?.order || []).filter(id => ids.has(id));
  const seen = new Set(queue);
  men.filter(p => !seen.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)).forEach(p => queue.push(p.id));
  for (const m of sortMeetings(state.meetings)) {
    if (isPast(m, today) && m.devoId && devoApplies(m, state)) moveToBack(queue, m.devoId);
  }
  return queue;
}

function assignDevos(state, meetings, today) {
  const byId = Object.fromEntries(activeMen(state).map(p => [p.id, p]));
  const queue = devoQueue(state, today);
  // pinned men go to the back first so they are not also auto-assigned an earlier week
  for (const m of meetings) {
    if (!isPast(m, today) && devoApplies(m, state) && m.devoMode === 'pinned' && m.devoId) moveToBack(queue, m.devoId);
  }
  for (const m of meetings) {
    if (isPast(m, today)) continue;
    if (!devoApplies(m, state)) { if (m.devoMode !== 'pinned') m.devoId = null; continue; }
    if (m.devoMode === 'pinned' && m.devoId && byId[m.devoId]) { moveToBack(queue, m.devoId); continue; }
    m.devoMode = 'auto';
    const pick = queue.find(id => devoEligible(byId[id], m.date, m));
    if (pick) { m.devoId = pick; moveToBack(queue, pick); }
    else m.devoId = null;
  }
}

// Per-man numbers for the Men view.
export function devoStats(state, today) {
  const out = {};
  for (const p of activeMen(state)) out[p.id] = { given: 0, last: null, next: null };
  for (const m of sortMeetings(state.meetings)) {
    if (!m.devoId || !devoApplies(m, state)) continue;
    const s = out[m.devoId]; if (!s) continue;
    if (isPast(m, today)) { s.given++; s.last = m.date; }
    else if (!s.next) s.next = m.date;
  }
  return out;
}

// Men waiting for a turn after everything already planned: in line order, able to give one at some point.
export function devoNextInLine(state, today) {
  const planned = new Set(state.meetings.filter(m => !isPast(m, today) && m.devoId && devoApplies(m, state)).map(m => m.devoId));
  const byId = Object.fromEntries(activeMen(state).map(p => [p.id, p]));
  return devoQueue(state, today).filter(id => !planned.has(id) && byId[id].devoStatus !== 'never' && !(byId[id].devoStatus === 'unavailable' && !byId[id].devoUntil));
}

// "Someone else gives the devotional". Mutates state.meetings; the caller re-plans afterwards.
// If the new man already has a week planned, the two trade and both are pinned. Otherwise he is pinned here and the original man takes the next open week.
export function reassignDevo(state, meetingId, toId, today) {
  const m = state.meetings.find(x => x.id === meetingId);
  if (!m) return { error: 'That week no longer exists.' };
  if (isPast(m, today)) return { error: 'That week is already over.' };
  if (!devoApplies(m, state)) return { error: 'There is no devotional that week.' };
  const to = activeMen(state).find(p => p.id === toId);
  if (!to) return { error: 'Pick one of the men.' };
  if (to.devoStatus === 'never') return { error: 'They are not in the devotional line.' };
  const from = m.devoId || null;
  if (from === toId) return { error: 'They already have that week.' };
  const other = from ? sortMeetings(state.meetings).find(x => x.id !== m.id && !isPast(x, today) && devoApplies(x, state) && x.devoId === toId) : null;
  m.devoId = toId; m.devoMode = 'pinned';
  m.devoSkipped = (m.devoSkipped || []).filter(id => id !== toId);
  if (other) {
    other.devoId = from; other.devoMode = 'pinned';
    other.devoSkipped = (other.devoSkipped || []).filter(id => id !== from);
    return { kind: 'trade', from, to: toId, date: m.date, otherDate: other.date };
  }
  return { kind: 'cover', from, to: toId, date: m.date };
}

// Put a man on hold from devotionals (until a date, or until further notice) or take him off hold.
// Weeks pinned to him from today on go back to the normal order, so the next man takes them.
export function setDevoHold(state, pid, onHold, until = null, today) {
  const p = activeMen(state).find(x => x.id === pid);
  if (!p) return { error: 'Only the men are in the devotional line.' };
  if (p.devoStatus === 'never') return { error: 'Only the leader can change this.' };
  if (onHold) {
    if (until && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= today)) return { error: 'Pick a date after today.' };
    p.devoStatus = 'unavailable'; p.devoUntil = until || null;
    for (const m of state.meetings) {
      if (m.devoId === pid && m.devoMode === 'pinned' && !isPast(m, today) && (!until || m.date < until)) m.devoMode = 'auto';
    }
  } else { p.devoStatus = 'available'; p.devoUntil = null; }
  return { ok: true };
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

// Display name for a household: "Anna & Ben (Reed)" when siblings share it, the person's name otherwise.
export function householdLabel(state, h) {
  if (!h) return '';
  const names = state.people.filter(p => p.householdId === h.id && p.active !== false).map(p => p.name);
  if (names.length < 2) return h.name;
  const surname = /\s/.test(h.name.trim()) ? names[0].trim().split(/\s+/).pop() : h.name.trim();
  return `${names.map(n => n.trim().split(/\s+/)[0]).join(' & ')} (${surname})`;
}

// Households waiting for a turn after everything already planned: in line order, able to host at some point.
export function nextInLine(state, today) {
  const planned = new Set(state.meetings.filter(m => !isPast(m, today) && countsAsHost(m)).map(m => m.hostHouseholdId));
  const byId = Object.fromEntries(state.households.map(h => [h.id, h]));
  return currentQueue(state, today).filter(id => !planned.has(id) && byId[id].hostStatus !== 'never' && !(byId[id].hostStatus === 'unavailable' && !byId[id].unavailableUntil));
}

// "Someone else hosts this week". Mutates state.meetings; the caller re-plans afterwards.
// If the new household already has a later (or earlier) week planned, the two trade weeks and both are pinned.
// Otherwise the new household is pinned here and the original host takes the next open week, like "can't host".
export function reassignHost(state, meetingId, toId, today) {
  const m = state.meetings.find(x => x.id === meetingId);
  if (!m) return { error: 'That week no longer exists.' };
  if (isPast(m, today)) return { error: 'That week is already over.' };
  if (m.status !== 'on') return { error: 'There is no meeting that week.' };
  if (m.location) return { error: 'That week is not at someone’s home.' };
  const to = liveHouseholds(state).find(h => h.id === toId);
  if (!to) return { error: 'Pick someone from the group.' };
  if (to.hostStatus === 'never') return { error: 'They are marked as never hosting.' };
  const from = m.hostHouseholdId;
  if (from === toId) return { error: 'They already host that week.' };
  const other = from ? sortMeetings(state.meetings).find(x => x.id !== m.id && !isPast(x, today) && countsAsHost(x) && x.hostHouseholdId === toId) : null;
  m.hostHouseholdId = toId; m.hostMode = 'pinned';
  m.skipped = (m.skipped || []).filter(id => id !== toId);
  if (other) {
    other.hostHouseholdId = from; other.hostMode = 'pinned';
    other.skipped = (other.skipped || []).filter(id => id !== from);
    return { kind: 'trade', from, to: toId, date: m.date, otherDate: other.date };
  }
  return { kind: 'cover', from, to: toId, date: m.date };
}

// Put a household on hold (until a date, or until further notice) or take it off hold.
// Weeks pinned to it (swaps) from today on go back to the normal order, so the next person takes them.
export function setHold(state, hid, onHold, until = null, today) {
  const h = state.households.find(x => x.id === hid);
  if (!h) return { error: 'Unknown household.' };
  if (h.hostStatus === 'never') return { error: 'Only the leader can change this household.' };
  if (onHold) {
    if (until && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= today)) return { error: 'Pick a date after today.' };
    h.hostStatus = 'unavailable'; h.unavailableUntil = until || null;
    for (const m of state.meetings) {
      if (m.hostHouseholdId === hid && m.hostMode === 'pinned' && !isPast(m, today) && (!until || m.date < until)) m.hostMode = 'auto';
    }
  } else { h.hostStatus = 'available'; h.unavailableUntil = null; }
  return { ok: true };
}

// Deterministic shuffle helper (Fisher-Yates with an injectable rng) used by the seed and the Hosting tab.
export function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
