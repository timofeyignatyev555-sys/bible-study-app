// Generator tests. Run: node tools/test.mjs
import assert from 'node:assert/strict';
import { plan, datesOfWeekday, hostStats, attendanceStats, fillSeason, currentQueue, shuffle } from '../js/rotation.js';

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
console.log(`\n${n} tests passed`);
