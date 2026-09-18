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
    people: [], households: [], rotation: { order: [] }, meetings: []
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
  out.meetings = (s.meetings || []).map(m => ({ status: 'on', kind: 'study', title: '', time: out.settings.defaultTime, hostHouseholdId: null, hostMode: 'auto', location: null, topic: '', leaderId: null, notes: '', attendance: {}, skipped: [], ...m }));
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
