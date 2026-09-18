// Cloud mirror through the bible-study-sync worker. Local is the source of truth; the cloud copy is for the other device.
import { getPref, setPref } from './store.js';

export const WORKER_URL = 'https://bible-study-sync.ophir-marketing-agency.workers.dev';

const listeners = new Set();
export const status = { state: 'local', detail: '', lastSync: null, dirty: false };
export function onStatus(fn) { listeners.add(fn); }
function set(s, detail = '') { status.state = s; status.detail = detail; listeners.forEach(fn => fn(status)); }

export function token() { return getPref('token'); }
export function setToken(t) { setPref('token', t ? t.trim() : null); if (!t) set('local'); }

async function call(method, body) {
  const t = token();
  if (!t) throw Object.assign(new Error('no token'), { code: 'notoken' });
  const res = await fetch(WORKER_URL + '/state', { method, headers: { 'Content-Type': 'application/json', 'X-App-Token': t }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw Object.assign(new Error('bad token'), { code: 'forbidden' });
  if (res.status === 409) return { conflict: true, state: data.state };
  if (!res.ok) throw Object.assign(new Error(data.error || ('http ' + res.status)), { code: 'http' });
  return data;
}

// Returns the newer server state (to adopt) or null when local is current. Throws on auth/network problems.
export async function pull(local) {
  if (!token()) return null;
  set('syncing');
  try {
    const r = await call('GET');
    status.lastSync = new Date().toISOString();
    if (!r.state) { set('ok', 'cloud empty'); return { empty: true }; }
    if (!local || (r.state.updatedAt || '') > (local.updatedAt || '')) { set('ok'); return { state: r.state }; }
    set('ok'); return (local.updatedAt || '') > (r.state.updatedAt || '') ? { stale: true } : null;
  } catch (e) { fail(e); throw e; }
}

let timer = null, pending = null, inflight = false;
// Debounced push. onConflict(serverState) is called when the cloud copy is newer.
export function push(state, onConflict) {
  if (!token()) return;
  pending = { state, onConflict }; status.dirty = true;
  clearTimeout(timer);
  timer = setTimeout(flush, 700);
}
async function flush() {
  if (inflight || !pending) return;
  const { state, onConflict } = pending; pending = null; inflight = true;
  set('syncing');
  try {
    const r = await call('PUT', { state });
    status.lastSync = new Date().toISOString();
    if (r.conflict) { status.dirty = false; set('ok', 'newer copy pulled'); onConflict && onConflict(r.state); }
    else { status.dirty = false; set('ok'); }
  } catch (e) { fail(e); }
  finally { inflight = false; if (pending) flush(); }
}
export function flushNow() { clearTimeout(timer); return flush(); }

function fail(e) {
  if (e.code === 'forbidden') set('forbidden', 'token rejected');
  else if (e.code === 'notoken') set('local');
  else set('offline', 'will retry');
}

export async function verify(t) {
  const res = await fetch(WORKER_URL + '/state', { headers: { 'X-App-Token': t.trim() } });
  if (res.status === 403) return { ok: false, why: 'That token was rejected.' };
  if (!res.ok) return { ok: false, why: 'Sync server error ' + res.status };
  const data = await res.json();
  return { ok: true, state: data.state };
}
