// Local persistence: one state document in localStorage. No network here.
const KEY = 'bs.state';

export function uid(prefix = 'x') {
  return prefix + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function emptyState(today) {
  const y = today.slice(0, 4);
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    settings: { name: 'Bible Study', weekday: 5, defaultTime: '19:00', seasonStart: today, seasonEnd: `${y}-12-31` },
    people: [], households: [], rotation: { order: [] }, meetings: [], log: []
  };
}

// Fill in anything an older document might be missing so the UI can rely on shape.
export function normalize(s, today) {
  const base = emptyState(today);
  const out = { ...base, ...s };
  out.settings = { ...base.settings, ...(s.settings || {}) };
  out.rotation = { order: [...((s.rotation && s.rotation.order) || [])] };
  out.people = (s.people || []).map(p => ({ phone: '', notes: '', active: true, ...p }));
  out.households = (s.households || []).map(h => ({ address: '', hostStatus: 'available', unavailableUntil: null, note: '', ...h }));
  out.log = [...(s.log || [])];
  out.meetings = (s.meetings || []).map(m => ({ status: 'on', kind: 'study', title: '', time: out.settings.defaultTime, hostHouseholdId: null, hostMode: 'auto', location: null, topic: '', leaderId: null, notes: '', attendance: {}, skipped: [], ...m }));
  return out;
}

// Three-way merge for sync: whatever this device changed since `base` wins field by field, everything else comes from the server.
// Auto-assigned future hosts are derived data, so they are blanked first and the caller re-plans.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function mergeObj(b, l, s) {
  const out = {};
  for (const k of new Set([...Object.keys(b || {}), ...Object.keys(l || {}), ...Object.keys(s || {})])) {
    const v = same(l?.[k], b?.[k]) ? s?.[k] : l?.[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
function mergeList(b = [], l = [], s = []) {
  const B = new Map(b.map(x => [x.id, x])), S = new Map(s.map(x => [x.id, x])), L = new Map(l.map(x => [x.id, x]));
  const out = [];
  for (const id of [...L.keys(), ...[...S.keys()].filter(id => !L.has(id))]) {
    const bi = B.get(id), li = L.get(id), si = S.get(id);
    if (li && si) out.push(bi ? mergeObj(bi, li, si) : li);
    else if (li) { if (!bi || !same(li, bi)) out.push(li); }     // added here, or edited here after the server deleted it
    else if (si && !bi) out.push(si);                             // added on the server; server copies of things deleted here stay deleted
  }
  return out;
}
export function merge3(base, local, server, today) {
  const strip = s => ({ ...s, meetings: (s.meetings || []).map(m => (m.hostMode === 'pinned' || m.date < today || (m.attendance && Object.keys(m.attendance).length)) ? m : { ...m, hostHouseholdId: null }) });
  const [b, l, s] = [base, local, server].map(strip);
  const out = mergeObj(b, l, s);
  out.settings = mergeObj(b.settings, l.settings, s.settings);
  out.rotation = mergeObj(b.rotation, l.rotation, s.rotation);
  for (const k of ['people', 'households', 'meetings']) out[k] = mergeList(b[k], l[k], s[k]);
  const log = new Map([...(s.log || []), ...(l.log || [])].map(e => [e.id, e]));
  out.log = [...log.values()].sort((x, y) => (x.at < y.at ? -1 : 1)).slice(-100);
  return out;
}

export function load() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch {}
}

export function getPref(k, d = null) { try { const v = localStorage.getItem('bs.' + k); return v === null ? d : v; } catch { return d; } }
export function setPref(k, v) { try { if (v === null || v === undefined) localStorage.removeItem('bs.' + k); else localStorage.setItem('bs.' + k, String(v)); } catch {} }
