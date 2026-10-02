// Cloud mirror through the bible-study-sync worker. Local is the source of truth; the cloud copy is shared with the other device
// and with the group page, so every push says which server copy it was built on (`base`) and the app merges when that moved.
import { getPref, setPref } from './store.js';

export const WORKER_URL = getPref('worker') || 'https://bible-study-sync.ophir-marketing-agency.workers.dev';
export const GROUP_PAGE = new URL('group/', location.href).href;

const listeners = new Set();
export const status = { state: 'local', detail: '', lastSync: null, dirty: false };
export function onStatus(fn) { listeners.add(fn); }
function set(s, detail = '') { status.state = s; status.detail = detail; listeners.forEach(fn => fn(status)); }

export function token() { return getPref('token'); }
export function setToken(t) { setPref('token', t ? t.trim() : null); if (!t) { set('local'); setBase(null); } }

// The last server copy this device agreed with (JSON string), the common ancestor for merges.
export function base() { try { const raw = localStorage.getItem('bs.base'); return raw ? JSON.parse(raw) : null; } catch { return null; } }
export function setBase(s) { try { if (!s) localStorage.removeItem('bs.base'); else localStorage.setItem('bs.base', typeof s === 'string' ? s : JSON.stringify(s)); } catch {} }

async function call(path, method, body) {
  const t = token();
  if (!t) throw Object.assign(new Error('no token'), { code: 'notoken' });
  const res = await fetch(WORKER_URL + path, { method, headers: { 'Content-Type': 'application/json', 'X-App-Token': t }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) throw Object.assign(new Error('bad token'), { code: 'forbidden' });
  if (res.status === 409) return { conflict: true, state: data.state };
  if (!res.ok) throw Object.assign(new Error(data.error || ('http ' + res.status)), { code: 'http' });
  return data;
}

// Returns the server copy ({ state: null } when the cloud is empty). Throws on auth/network problems.
export async function pull() {
  if (!token()) return null;
  set('syncing');
  try {
    const r = await call('/state', 'GET');
    status.lastSync = new Date().toISOString();
    set('ok');
    return { state: r.state || null };
  } catch (e) { fail(e); throw e; }
}

let timer = null, pending = null, inflight = false;
// Debounced push. onConflict(serverState) is called when the cloud copy moved since our base.
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
    const sent = JSON.stringify(state);
    const b = base();
    const r = await call('/state', 'PUT', `{"state":${sent},"base":${JSON.stringify(b ? b.updatedAt || '' : null)}}`);
    status.lastSync = new Date().toISOString();
    status.dirty = false;
    if (r.conflict) { set('ok', 'merging'); onConflict && onConflict(r.state); }
    else { setBase(sent); set('ok'); }
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

// The link Tim shares with the group. The key lives in the worker so it can be reset from here.
export async function groupLink(reset = false) {
  const r = await call(reset ? '/admin/group-key/reset' : '/admin/group-key', reset ? 'POST' : 'GET');
  setPref('groupKey', r.key);
  return GROUP_PAGE + '?k=' + encodeURIComponent(r.key);
}
export function cachedGroupLink() { const k = getPref('groupKey'); return k ? GROUP_PAGE + '?k=' + encodeURIComponent(k) : null; }
