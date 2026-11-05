// Generator tests. Run: node tools/test.mjs
import assert from 'node:assert/strict';
import { plan, datesOfWeekday, hostStats, attendanceStats, fillSeason, currentQueue, shuffle, householdLabel, reassignHost, nextInLine, setHold, devoQueue, devoNextInLine, devoStats, reassignDevo, setDevoHold, devoApplies, recentChanges, untouchedWeek } from '../js/rotation.js';
import { merge3, normalize } from '../js/store.js';
import { personShort, birthdaysIn, fmtBirthday, calendarHTML, foldPoint } from '../js/calgrid.js';

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

const H = ids => ids.map(id => ({ id, name: id, address: '', hostStatus: 'available', unavailableUntil: null }));
const P = ids => ids.map(id => ({ id: 'p' + id, name: 'P' + id, householdId: id, active: true }));
const M = (dates, extra = {}) => dates.map((date, i) => ({ id: 'm' + (i + 1), date, status: 'on', kind: 'study', time: '19:00', hostHouseholdId: null, hostMode: 'auto', location: null, attendance: {}, skipped: [], ...(extra[i + 1] || {}) }));
const D = ['2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23'];
const mk = (ids, extra, order) => ({ settings: { weekday: 5, seasonStart: D[0], seasonEnd: D[5], defaultTime: '19:00' }, people: P(ids), households: H(ids), rotation: { order: order || ids }, meetings: M(D, extra) });
const hosts = r => r.meetings.map(m => m.hostHouseholdId);
const TODAY = '2026-09-18';

t('15 Fridays from Sep 18 to Dec 31 2026', () => {
  const f = datesOfWeekday('2026-09-18', '2026-12-31', 5);
  assert.equal(f.length, 15); assert.equal(f[0], '2026-09-18'); assert.equal(f[14], '2026-12-25');
});
t('start date not on the weekday rolls forward', () => {
  assert.deepEqual(datesOfWeekday('2026-09-16', '2026-09-30', 5), ['2026-09-18', '2026-09-25']);
});
t('plain cycle', () => {
  assert.deepEqual(hosts(plan(mk(['A', 'B', 'C', 'D']), TODAY)), ['A', 'B', 'C', 'D', 'A', 'B']);
});
t('cannot host: skipped household takes the very next week, everyone shifts', () => {
  const s = mk(['A', 'B', 'C', 'D'], { 1: { skipped: ['A'] } });
  assert.deepEqual(hosts(plan(s, TODAY)), ['B', 'A', 'C', 'D', 'B', 'A']);
});
t('unavailable until a date re-enters at the first open week', () => {
  const s = mk(['A', 'B', 'C', 'D']);
  s.households[1].hostStatus = 'unavailable'; s.households[1].unavailableUntil = D[3];
  assert.deepEqual(hosts(plan(s, TODAY)), ['A', 'C', 'D', 'B', 'A', 'C']);
});
t('unavailable indefinitely never picked', () => {
  const s = mk(['A', 'B', 'C', 'D']);
  s.households[1].hostStatus = 'unavailable'; s.households[1].unavailableUntil = null;
  assert.deepEqual(hosts(plan(s, TODAY)), ['A', 'C', 'D', 'A', 'C', 'D']);
});
t('never hosts', () => {
  const s = mk(['A', 'B', 'C', 'D']); s.households[1].hostStatus = 'never';
  assert.deepEqual(hosts(plan(s, TODAY)), ['A', 'C', 'D', 'A', 'C', 'D']);
});
t('pinned host is kept and moves to the back', () => {
  const s = mk(['A', 'B', 'C', 'D'], { 2: { hostHouseholdId: 'D', hostMode: 'pinned' } });
  assert.deepEqual(hosts(plan(s, TODAY)), ['A', 'D', 'B', 'C', 'A', 'D']);
});
t('pinned far ahead is not also auto-assigned earlier', () => {
  const s = mk(['A', 'B', 'C', 'D', 'E', 'F'], { 6: { hostHouseholdId: 'C', hostMode: 'pinned' } });
  assert.deepEqual(hosts(plan(s, TODAY)), ['A', 'B', 'D', 'E', 'F', 'C']);
});
t('off week consumes no turn; the would-be host gets next week', () => {
  const s = mk(['A', 'B', 'C', 'D'], { 2: { status: 'off', hostHouseholdId: 'B' } });
  assert.deepEqual(hosts(plan(s, TODAY)), ['A', null, 'B', 'C', 'D', 'A']);
});
t('custom location consumes no turn', () => {
  const s = mk(['A', 'B', 'C', 'D'], { 2: { location: { name: 'Church', address: '' } } });
  assert.deepEqual(hosts(plan(s, TODAY)), ['A', null, 'B', 'C', 'D', 'A']);
});
t('past meetings are frozen and replayed', () => {
  const s = mk(['A', 'B', 'C', 'D'], { 1: { hostHouseholdId: 'Z' }, 2: { hostHouseholdId: 'A' } });
  const r = plan(s, D[2]);
  assert.deepEqual(hosts(r), ['Z', 'A', 'B', 'C', 'D', 'A']);
});
t('attendance taken today freezes today', () => {
  const s = mk(['A', 'B', 'C', 'D'], { 1: { hostHouseholdId: 'C', attendance: { pA: true } } });
  assert.deepEqual(hosts(plan(s, TODAY)), ['C', 'A', 'B', 'D', 'C', 'A']);
});
t('household with no active people is dropped', () => {
  const s = mk(['A', 'B', 'C', 'D']); s.people[1].active = false;
  assert.deepEqual(hosts(plan(s, TODAY)), ['A', 'C', 'D', 'A', 'C', 'D']);
});
t('household missing from the order is appended', () => {
  const s = mk(['A', 'B', 'C', 'D'], {}, ['B', 'A']);
  assert.deepEqual(hosts(plan(s, TODAY)), ['B', 'A', 'C', 'D', 'B', 'A']);
  assert.deepEqual(currentQueue(s, TODAY), ['B', 'A', 'C', 'D']);
});
t('nobody eligible leaves the slot empty', () => {
  const s = mk(['A', 'B']); s.households.forEach(h => h.hostStatus = 'never');
  assert.deepEqual(hosts(plan(s, TODAY)), [null, null, null, null, null, null]);
});
t('plan does not mutate input', () => {
  const s = mk(['A', 'B', 'C', 'D']); const before = JSON.stringify(s); plan(s, TODAY); assert.equal(JSON.stringify(s), before);
});
t('hostStats counts past hosts and next planned', () => {
  const s = mk(['A', 'B', 'C', 'D'], { 1: { hostHouseholdId: 'A' }, 2: { hostHouseholdId: 'B' } });
  const r = plan(s, D[2]); s.meetings = r.meetings;
  const st = hostStats(s, D[2]);
  assert.equal(st.A.hosted, 1); assert.equal(st.A.lastHosted, D[0]); assert.equal(st.A.next, D[4]);
  assert.equal(st.C.hosted, 0); assert.equal(st.C.next, D[2]);
});
t('attendanceStats only counts meetings where attendance was taken', () => {
  const s = mk(['A', 'B'], { 1: { attendance: { pA: true } }, 2: { attendance: { pA: true, pB: true } } });
  const st = attendanceStats(s);
  assert.deepEqual(st.pA, { present: 2, total: 2, pct: 100 }); assert.deepEqual(st.pB, { present: 1, total: 2, pct: 50 });
});
t('fillSeason adds only missing weeks', () => {
  const s = mk(['A']); s.settings.seasonEnd = '2026-11-06';
  const added = fillSeason(s);
  assert.deepEqual(added.map(m => m.date), ['2026-10-30', '2026-11-06']);
});
t('shuffle keeps every element', () => {
  let i = 0; const rng = () => ((i += 7) % 10) / 10;
  assert.deepEqual([...shuffle(['a', 'b', 'c', 'd'], rng)].sort(), ['a', 'b', 'c', 'd']);
});
const replanned = s => { s.meetings = plan(s, TODAY).meetings; return s; };
t('label: siblings show first names and surname', () => {
  const s = { people: [{ id: 'p1', name: 'Anna Smith', householdId: 'h', active: true }, { id: 'p2', name: 'Maria Smith', householdId: 'h', active: true }, { id: 'p3', name: 'Lena Cole', householdId: 'l', active: true }], households: [] };
  assert.equal(householdLabel(s, { id: 'h', name: 'Smith' }), 'Anna & Maria (Smith)');
  assert.equal(householdLabel(s, { id: 'l', name: 'Lena Cole' }), 'Lena Cole');
  s.people.push({ id: 'p4', name: 'Anna Cole', householdId: 'l', active: true });
  assert.equal(householdLabel(s, { id: 'l', name: 'Lena Cole' }), 'Lena & Anna (Cole)');
  s.people[3].active = false;
  assert.equal(householdLabel(s, { id: 'l', name: 'Lena Cole' }), 'Lena Cole');
});
t('someone else hosts: a scheduled household trades weeks, both pinned', () => {
  const s = replanned(mk(['A', 'B', 'C', 'D']));
  const r = reassignHost(s, 'm1', 'C', TODAY);
  assert.equal(r.kind, 'trade'); assert.equal(r.otherDate, D[2]);
  assert.deepEqual(hosts(replanned(s)), ['C', 'B', 'A', 'D', 'C', 'B']);
  assert.equal(s.meetings[0].hostMode, 'pinned'); assert.equal(s.meetings[2].hostMode, 'pinned');
});
t('someone else hosts: an unscheduled household covers, the original host takes next week', () => {
  const s = replanned(mk(['A', 'B', 'C', 'D', 'E', 'F', 'G']));
  assert.deepEqual(nextInLine(s, TODAY), ['G']);
  const r = reassignHost(s, 'm1', 'G', TODAY);
  assert.equal(r.kind, 'cover');
  assert.deepEqual(hosts(replanned(s)), ['G', 'A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(nextInLine(s, TODAY), ['F']);
});
t('someone else hosts: rejects past weeks, off weeks, same host, never-hosts', () => {
  const s = replanned(mk(['A', 'B', 'C', 'D'], { 2: { status: 'off' } }));
  assert.ok(reassignHost(s, 'm1', 'A', TODAY).error);
  assert.ok(reassignHost(s, 'm2', 'C', TODAY).error);
  assert.ok(reassignHost(s, 'm1', 'C', D[1]).error);
  s.households[3].hostStatus = 'never';
  assert.ok(reassignHost(s, 'm1', 'D', TODAY).error);
  assert.ok(reassignHost(s, 'm1', 'nope', TODAY).error);
});
t('merge3: each side keeps its own edits, server adds survive, local deletes stick', () => {
  const base = replanned(mk(['A', 'B', 'C', 'D'])); base.log = [];
  const local = JSON.parse(JSON.stringify(base)), server = JSON.parse(JSON.stringify(base));
  local.meetings[3].topic = 'Romans 8'; local.households[0].note = 'gate code';
  server.households[1].address = '1 Main St'; server.households[0].address = '9 Elm';
  server.log.push({ id: 'l1', at: '2026-09-19T00:00:00Z', by: 'B', text: 'address' });
  reassignHost(server, 'm1', 'C', TODAY); server.meetings = plan(server, TODAY).meetings;
  server.people.push({ id: 'pE', name: 'PE', householdId: 'E', active: true }); server.households.push({ id: 'E', name: 'E', address: '', hostStatus: 'available', unavailableUntil: null });
  local.people = local.people.filter(p => p.id !== 'pD');
  const m = merge3(base, local, server, TODAY);
  assert.equal(m.meetings[3].topic, 'Romans 8'); assert.equal(m.households[0].note, 'gate code');
  assert.equal(m.households[0].address, '9 Elm'); assert.equal(m.households[1].address, '1 Main St');
  assert.equal(m.meetings[0].hostHouseholdId, 'C'); assert.equal(m.meetings[0].hostMode, 'pinned');
  assert.equal(m.meetings[1].hostHouseholdId, null);
  assert.ok(m.people.some(p => p.id === 'pE')); assert.ok(!m.people.some(p => p.id === 'pD'));
  assert.equal(m.log.length, 1);
});
t('merge3: same field edited on both sides, this device wins', () => {
  const base = mk(['A', 'B']); base.log = [];
  const local = JSON.parse(JSON.stringify(base)), server = JSON.parse(JSON.stringify(base));
  local.households[0].address = 'mine'; server.households[0].address = 'theirs';
  assert.equal(merge3(base, local, server, TODAY).households[0].address, 'mine');
});
t('hold: household drops out of the plan, its swapped week goes back to the order, then returns', () => {
  const s = replanned(mk(['A', 'B', 'C', 'D']));
  reassignHost(s, 'm1', 'C', TODAY); replanned(s);
  assert.equal(setHold(s, 'C', true, null, TODAY).ok, true); replanned(s);
  assert.ok(!hosts(s).includes('C'));
  assert.deepEqual(hosts(s), ['B', 'D', 'A', 'B', 'D', 'A']);
  setHold(s, 'C', false, null, TODAY); replanned(s);
  assert.ok(hosts(s).includes('C'));
});
t('hold until a date: back in the plan from that date', () => {
  const s = replanned(mk(['A', 'B', 'C', 'D']));
  setHold(s, 'A', true, D[3], TODAY); replanned(s);
  assert.deepEqual(hosts(s).slice(0, 3), ['B', 'C', 'D']); assert.equal(hosts(s)[3], 'A');
  assert.ok(setHold(s, 'A', true, '2020-01-01', TODAY).error);
  s.households[1].hostStatus = 'never'; assert.ok(setHold(s, 'B', false, null, TODAY).error);
});

// ---------- Friday devotional
const mkM = (ids, extra) => { const s = mk(ids, extra); s.people.forEach(p => { p.gender = 'm'; }); s.devotion = { order: ids.map(i => 'p' + i) }; return s; };
const devos = r => r.meetings.map(m => m.devoId);
t('devotional: every meeting gets the next man, then the line repeats', () => {
  assert.deepEqual(devos(plan(mkM(['A', 'B', 'C', 'D']), TODAY)), ['pA', 'pB', 'pC', 'pD', 'pA', 'pB']);
});
t('devotional: women, unmarked and inactive people are never picked', () => {
  const s = mkM(['A', 'B', 'C', 'D']); s.people[1].gender = 'f'; delete s.people[2].gender; s.people[3].active = false;
  assert.deepEqual(devos(plan(s, TODAY)), ['pA', 'pA', 'pA', 'pA', 'pA', 'pA']);
});
t('devotional: no men means nobody, and hosting still plans', () => {
  const s = mk(['A', 'B']);
  const r = plan(s, TODAY);
  assert.deepEqual(devos(r), [null, null, null, null, null, null]);
  assert.deepEqual(hosts(r), ['A', 'B', 'A', 'B', 'A', 'B']);
});
t('devotional: its line is separate from hosting (a host on hold can still give one)', () => {
  const s = mkM(['A', 'B', 'C', 'D']); s.households[0].hostStatus = 'unavailable';
  const r = plan(s, TODAY);
  assert.ok(!hosts(r).includes('A'));
  assert.equal(devos(r)[0], 'pA');
});
t('devotional: can\'t do it, the skipped man takes the very next week, everyone shifts', () => {
  const s = mkM(['A', 'B', 'C', 'D'], { 1: { devoSkipped: ['pA'] } });
  assert.deepEqual(devos(plan(s, TODAY)), ['pB', 'pA', 'pC', 'pD', 'pB', 'pA']);
});
t('devotional: hold until a date re-enters at the first open week; open hold and never are out', () => {
  let s = mkM(['A', 'B', 'C', 'D']); s.people[1].devoStatus = 'unavailable'; s.people[1].devoUntil = D[3];
  assert.deepEqual(devos(plan(s, TODAY)), ['pA', 'pC', 'pD', 'pB', 'pA', 'pC']);
  s = mkM(['A', 'B', 'C']); s.people[1].devoStatus = 'unavailable'; s.people[1].devoUntil = null;
  assert.deepEqual(devos(plan(s, TODAY)), ['pA', 'pC', 'pA', 'pC', 'pA', 'pC']);
  s = mkM(['A', 'B', 'C']); s.people[1].devoStatus = 'never';
  assert.deepEqual(devos(plan(s, TODAY)), ['pA', 'pC', 'pA', 'pC', 'pA', 'pC']);
});
t('devotional: off weeks and "no devotional" weeks use no turn', () => {
  const s = mkM(['A', 'B', 'C', 'D'], { 2: { status: 'off' }, 3: { devoOff: true } });
  assert.deepEqual(devos(plan(s, TODAY)), ['pA', null, null, 'pB', 'pC', 'pD']);
});
t('devotional: a place other than a home still has one; a one-off non-meeting-day event does not', () => {
  const s = mkM(['A', 'B', 'C'], { 2: { location: { name: 'Church', address: '' } } });
  assert.equal(devos(plan(s, TODAY))[1], 'pB');
  const e = mkM(['A', 'B', 'C']); e.meetings[1].kind = 'event'; e.meetings[1].date = '2026-09-26';
  assert.equal(devoApplies(e.meetings[1], e), false);
  const f = mkM(['A', 'B', 'C']); f.meetings[1].kind = 'event';
  assert.equal(devoApplies(f.meetings[1], f), true, 'an event on the meeting weekday keeps it');
  const moved = mkM(['A', 'B', 'C']); moved.meetings[1].date = '2026-09-24';
  assert.equal(devoApplies(moved.meetings[1], moved), true, 'a study moved to another day keeps it');
});
t('devotional: pinned is kept, and is not also auto-assigned earlier', () => {
  const s = mkM(['A', 'B', 'C', 'D', 'E', 'F'], { 6: { devoId: 'pC', devoMode: 'pinned' } });
  assert.deepEqual(devos(plan(s, TODAY)), ['pA', 'pB', 'pD', 'pE', 'pF', 'pC']);
});
t('devotional: past weeks are frozen and replayed; attendance freezes today', () => {
  const s = mkM(['A', 'B', 'C', 'D'], { 1: { devoId: 'pZ' }, 2: { devoId: 'pA' } });
  assert.deepEqual(devos(plan(s, D[2])), ['pZ', 'pA', 'pB', 'pC', 'pD', 'pA']);
  const a = mkM(['A', 'B', 'C', 'D'], { 1: { devoId: 'pC', attendance: { pA: true } } });
  assert.deepEqual(devos(plan(a, TODAY)), ['pC', 'pA', 'pB', 'pD', 'pC', 'pA']);
});
t('devotional: a man missing from the order joins, and plan does not mutate its input', () => {
  const s = mkM(['A', 'B', 'C']); s.devotion.order = ['pB'];
  assert.deepEqual(devoQueue(s, TODAY), ['pB', 'pA', 'pC']);
  const before = JSON.stringify(s); plan(s, TODAY); assert.equal(JSON.stringify(s), before);
  const none = mk(['A']); assert.deepEqual(devoQueue(none, TODAY), []);
});
const replannedM = s => { s.meetings = plan(s, TODAY).meetings; return s; };
t('devotional someone else: a man with a date trades, both pinned', () => {
  const s = replannedM(mkM(['A', 'B', 'C', 'D']));
  const r = reassignDevo(s, 'm1', 'pC', TODAY);
  assert.equal(r.kind, 'trade'); assert.equal(r.otherDate, D[2]);
  assert.deepEqual(devos(replannedM(s)), ['pC', 'pB', 'pA', 'pD', 'pC', 'pB']);
  assert.equal(s.meetings[0].devoMode, 'pinned'); assert.equal(s.meetings[2].devoMode, 'pinned');
});
t('devotional someone else: a man without a date covers, the original takes the next week', () => {
  const s = replannedM(mkM(['A', 'B', 'C', 'D', 'E', 'F', 'G']));
  assert.deepEqual(devoNextInLine(s, TODAY), ['pG']);
  const r = reassignDevo(s, 'm1', 'pG', TODAY);
  assert.equal(r.kind, 'cover');
  assert.deepEqual(devos(replannedM(s)), ['pG', 'pA', 'pB', 'pC', 'pD', 'pE']);
  assert.deepEqual(devoNextInLine(s, TODAY), ['pF']);
});
t('devotional someone else: rejects past, off, same man, a woman, never', () => {
  const s = replannedM(mkM(['A', 'B', 'C', 'D', 'E'], { 2: { status: 'off' } }));
  assert.ok(reassignDevo(s, 'm1', 'pA', TODAY).error);
  assert.ok(reassignDevo(s, 'm2', 'pC', TODAY).error);
  assert.ok(reassignDevo(s, 'm1', 'pC', D[1]).error);
  s.people[3].gender = 'f'; assert.ok(reassignDevo(s, 'm1', 'pD', TODAY).error);
  s.people[4].devoStatus = 'never'; assert.ok(reassignDevo(s, 'm1', 'pE', TODAY).error);
  assert.ok(reassignDevo(s, 'nope', 'pB', TODAY).error);
});
t('devotional hold: he drops out, his swapped week goes back to the order, then he returns', () => {
  const s = replannedM(mkM(['A', 'B', 'C', 'D']));
  reassignDevo(s, 'm1', 'pC', TODAY); replannedM(s);
  assert.equal(setDevoHold(s, 'pC', true, null, TODAY).ok, true); replannedM(s);
  assert.ok(!devos(s).includes('pC'));
  setDevoHold(s, 'pC', false, null, TODAY); replannedM(s);
  assert.ok(devos(s).includes('pC'));
});
t('devotional hold: until a date; rejects bad dates, "never" and non-men', () => {
  const s = replannedM(mkM(['A', 'B', 'C', 'D']));
  setDevoHold(s, 'pA', true, D[3], TODAY); replannedM(s);
  assert.deepEqual(devos(s).slice(0, 3), ['pB', 'pC', 'pD']); assert.equal(devos(s)[3], 'pA');
  assert.ok(setDevoHold(s, 'pA', true, '2020-01-01', TODAY).error);
  s.people[1].devoStatus = 'never'; assert.ok(setDevoHold(s, 'pB', false, null, TODAY).error);
  s.people[2].gender = 'f'; assert.ok(setDevoHold(s, 'pC', true, null, TODAY).error);
  assert.ok(setDevoHold(s, 'nope', true, null, TODAY).error);
});
t('devoStats: given, last and next', () => {
  const s = mkM(['A', 'B', 'C', 'D'], { 1: { devoId: 'pA' }, 2: { devoId: 'pB' } });
  s.meetings = plan(s, D[2]).meetings;
  const st = devoStats(s, D[2]);
  assert.equal(st.pA.given, 1); assert.equal(st.pA.last, D[0]); assert.equal(st.pA.next, D[4]);
  assert.equal(st.pC.given, 0); assert.equal(st.pC.next, D[2]);
});
t('merge3: a member\'s devotional swap survives a device edit, auto picks are re-planned, the line merges', () => {
  const base = replannedM(mkM(['A', 'B', 'C', 'D'])); base.log = [];
  const local = JSON.parse(JSON.stringify(base)), server = JSON.parse(JSON.stringify(base));
  reassignDevo(server, 'm1', 'pC', TODAY); server.meetings = plan(server, TODAY).meetings;
  local.meetings[3].topic = 'Romans 8'; local.devotion.order = ['pD', 'pC', 'pB', 'pA'];
  const m = merge3(base, local, server, TODAY);
  assert.equal(m.meetings[0].devoId, 'pC'); assert.equal(m.meetings[0].devoMode, 'pinned');
  assert.equal(m.meetings[1].devoId, null);
  assert.equal(m.meetings[3].topic, 'Romans 8');
  assert.deepEqual(m.devotion.order, ['pD', 'pC', 'pB', 'pA']);
});
t('merge3: a server line change comes through when this device did not touch it', () => {
  const base = replannedM(mkM(['A', 'B'])); base.log = [];
  const local = JSON.parse(JSON.stringify(base)), server = JSON.parse(JSON.stringify(base));
  server.devotion.order = ['pB', 'pA'];
  assert.deepEqual(merge3(base, local, server, TODAY).devotion.order, ['pB', 'pA']);
});
t('normalize: older documents get the new fields without losing anything', () => {
  const n = normalize({ settings: {}, people: [{ id: 'p', name: 'P', householdId: 'h', gender: 'm', birthday: '01-15' }], households: [], meetings: [{ id: 'm', date: D[0] }], rotation: { order: [] } }, TODAY);
  assert.deepEqual(n.devotion, { order: [] });
  assert.equal(n.people[0].birthday, '01-15'); assert.equal(n.people[0].gender, 'm'); assert.equal(n.people[0].devoStatus, 'available');
  assert.equal(n.meetings[0].devoId, null); assert.equal(n.meetings[0].devoMode, 'auto'); assert.deepEqual(n.meetings[0].devoSkipped, []); assert.equal(n.meetings[0].devoOff, false);
  const keep = normalize({ settings: {}, people: [], households: [], meetings: [], rotation: { order: [] }, devotion: { order: ['x'] } }, TODAY);
  assert.deepEqual(keep.devotion.order, ['x']);
});

t('recent changes: the leader sees first PINs merged with the log, newest first, without touching the document', () => {
  const s = mk(['A', 'B']); s.log = [{ id: 'l1', at: '2026-11-01T10:00:00Z', text: 'older change' }, { id: 'l2', at: '2026-11-03T10:00:00Z', text: 'newer change' }];
  const before = JSON.stringify(s);
  const r = recentChanges(s, [{ personId: 'pA', at: '2026-11-02T10:00:00Z' }, { personId: 'gone', at: '2026-11-04T10:00:00Z' }]);
  assert.deepEqual(r.map(e => e.text), ['newer change', 'PA set their group page PIN', 'older change']);
  assert.equal(JSON.stringify(s), before);
  assert.equal(recentChanges(s, [], 1).length, 1);
  assert.deepEqual(recentChanges({ ...s, log: undefined }).length, 0);
  assert.deepEqual(recentChanges(s).map(e => e.id), ['l2', 'l1'], 'works before any claims have loaded');
});

t('shrinking the season only drops untouched weeks: anything set by hand stays, hosting or devotional', () => {
  const week = extra => ({ id: 'm', date: D[0], status: 'on', kind: 'study', hostMode: 'auto', location: null, attendance: {}, skipped: [], devoMode: 'auto', devoSkipped: [], devoOff: false, ...extra });
  assert.equal(untouchedWeek(week({ devoId: 'pA', hostHouseholdId: 'A' })), true, 'an auto week can go');
  assert.equal(untouchedWeek({ id: 'm', date: D[0], status: 'on', kind: 'study' }), true, 'a freshly added week can go');
  for (const [why, extra] of [['a swapped devotional', { devoMode: 'pinned' }], ['a man who could not do it', { devoSkipped: ['pA'] }], ['no devotional this week', { devoOff: true }], ['a swapped host', { hostMode: 'pinned' }], ['a host who could not', { skipped: ['A'] }], ['a topic', { topic: 'Romans 8' }], ['notes', { notes: 'x' }], ['a leader', { leaderId: 'pA' }], ['attendance', { attendance: { pA: true } }], ['another place', { location: { name: 'Church' } }], ['an event', { kind: 'event' }], ['a cancelled week', { status: 'off' }]])
    assert.equal(untouchedWeek(week(extra)), false, why + ' keeps the week');
});

// ---------- calendar helpers
t('a long season folds once everyone on it has appeared', () => {
  assert.equal(foldPoint(['a', 'b', 'c', 'a', 'b', 'c', 'a']), 3);
  assert.equal(foldPoint(['a', null, 'b', 'a', 'c', 'b']), 5, 'weeks with nobody do not count, but stay in order');
  assert.equal(foldPoint(['a', 'b', 'a', 'b', 'c']), 5, 'a late first appearance stays visible');
  assert.equal(foldPoint(['a', 'b', 'c']), 3, 'a short season never folds');
  assert.equal(foldPoint([null, null]), 0); assert.equal(foldPoint([]), 0);
});
t('short names: first name unless someone shares it', () => {
  const names = ['Anna Smith', 'Dan Bell', 'Dan Lowe', 'Sam Reed', 'JJ'];
  assert.equal(personShort('Anna Smith', names), 'Anna');
  assert.equal(personShort('Dan Bell', names), 'Dan B.');
  assert.equal(personShort('Dan Lowe', names), 'Dan L.');
  assert.equal(personShort('JJ', names), 'JJ');
});
t('birthdays: month view, sorted by day, Feb 29 falls on Feb 28 in other years', () => {
  const ppl = [{ id: 'a', name: 'Zed Y', birthday: '11-29', householdId: 'h1' }, { id: 'b', name: 'Amy X', birthday: '11-01', householdId: 'h2' }, { id: 'c', name: 'No Date', birthday: '', householdId: 'h3' }, { id: 'd', name: 'Leap Kid', birthday: '02-29', householdId: 'h4' }];
  assert.deepEqual(birthdaysIn('2026-11', ppl).map(b => [b.date, b.name, b.short, b.householdId]), [['2026-11-01', 'Amy X', 'Amy', 'h2'], ['2026-11-29', 'Zed Y', 'Zed', 'h1']]);
  assert.equal(birthdaysIn('2027-02', ppl)[0].date, '2027-02-28');
  assert.equal(birthdaysIn('2028-02', ppl)[0].date, '2028-02-29');
  assert.equal(fmtBirthday('08-18'), 'Aug 18'); assert.equal(fmtBirthday(''), '');
});
t('calendar: shows the devotional and birthdays, pages a year ahead past the last meeting', () => {
  const rows = [{ id: 'm1', date: '2026-11-06', status: 'on', kind: 'study', short: 'Host', devo: 'Mark', past: false, noAddr: false }];
  const bds = birthdaysIn('2026-11', [{ id: 'a', name: 'Amy X', birthday: '11-06', householdId: 'h' }, { id: 'b', name: 'Bo Y', birthday: '11-10', householdId: 'h' }]);
  const html = calendarHTML('2026-11', rows, '2026-11-05', bds);
  assert.match(html, /Mark/); assert.match(html, /Amy/); assert.match(html, /data-act="calbday" data-date="2026-11-10"/);
  assert.match(html, /devotional/i); assert.match(html, /birthday/i);
  assert.ok(!/data-dir="1" disabled/.test(html), 'next month is open');
  assert.match(calendarHTML('2027-11', rows, '2026-11-05'), /data-dir="1" disabled/);
  assert.ok(!/Mark/.test(calendarHTML('2026-11', [{ ...rows[0], status: 'off' }], '2026-11-05')), 'no devotional shows on a cancelled week');
});
console.log(`\n${n} tests passed`);
