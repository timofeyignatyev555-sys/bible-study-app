// Generator tests. Run: node tools/test.mjs
import assert from 'node:assert/strict';
import { plan, datesOfWeekday, hostStats, attendanceStats, fillSeason, currentQueue, shuffle, householdLabel, reassignHost, nextInLine } from '../js/rotation.js';
import { merge3 } from '../js/store.js';

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
  const s = { people: [{ id: 'p1', name: 'Anna Smith', householdId: 'h', active: true }, { id: 'p2', name: 'Maria Smith', householdId: 'h', active: true }, { id: 'p3', name: 'Liza Dumyan', householdId: 'l', active: true }], households: [] };
  assert.equal(householdLabel(s, { id: 'h', name: 'Smith' }), 'Anna & Maria (Smith)');
  assert.equal(householdLabel(s, { id: 'l', name: 'Liza Dumyan' }), 'Liza Dumyan');
  s.people.push({ id: 'p4', name: 'Anna Dumyan', householdId: 'l', active: true });
  assert.equal(householdLabel(s, { id: 'l', name: 'Liza Dumyan' }), 'Liza & Anna (Dumyan)');
  s.people[3].active = false;
  assert.equal(householdLabel(s, { id: 'l', name: 'Liza Dumyan' }), 'Liza Dumyan');
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
console.log(`\n${n} tests passed`);
