// Month calendar shared by the leader app and the group page. Pure: plain meeting rows in, HTML out.
// Both pages build the rows from the same synced data as their lists, so a swap, a new person or an
// address change shows up here the moment the list changes.
// rows: [{ id, date, status: 'on'|'off', kind: 'study'|'event', short, past, noAddr }]
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// "Anna & David (Bak)" -> "Bak", "Rebecca Isacova" -> "Rebecca": what fits in a calendar cell.
export function shortName(label) {
  const m = /\(([^)]+)\)\s*$/.exec(label || '');
  return m ? m[1] : (label || '').trim().split(/\s+/)[0];
}
export function shiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// The month to open on: this month, or the first month with a meeting if the season has not started.
export function startMonth(rows, today) {
  const ym = today.slice(0, 7);
  if (!rows.length || rows.some(r => r.date.slice(0, 7) === ym)) return ym;
  const next = rows.find(r => r.date >= today);
  return (next || rows[rows.length - 1]).date.slice(0, 7);
}

export function calendarHTML(ym, rows, today) {
  const [y, m] = ym.split('-').map(Number);
  const lead = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const byDate = new Map(rows.map(r => [r.date, r]));
  const months = rows.map(r => r.date.slice(0, 7));
  const min = months.length ? months.reduce((a, b) => (a < b ? a : b)) : ym, max = months.length ? months.reduce((a, b) => (a > b ? a : b)) : ym;
  // the meeting weekday gets a wider column so host names fit
  const counts = [0, 0, 0, 0, 0, 0, 0];
  rows.forEach(r => { const [yy, mm, dd] = r.date.split('-').map(Number); counts[new Date(yy, mm - 1, dd).getDay()]++; });
  const wide = counts.indexOf(Math.max(...counts));
  const cols = counts.map((_, i) => (i === wide && rows.length ? 'minmax(0,2.2fr)' : 'minmax(0,1fr)')).join(' ');
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="day blank"></div>';
  for (let d = 1; d <= days; d++) {
    const iso = `${ym}-${String(d).padStart(2, '0')}`;
    const r = byDate.get(iso);
    const cls = ['day', iso === today ? 'today' : ''];
    if (!r) { cells += `<div class="${cls.join(' ')}"><span class="num">${d}</span></div>`; continue; }
    cls.push('meet', r.status === 'off' ? 'off' : (r.kind === 'event' ? 'event' : ''), r.past ? 'past' : '');
    const label = r.status === 'off' ? 'No meeting' : r.short;
    cells += `<button class="${cls.join(' ')}" data-act="calday" data-id="${esc(r.id)}" aria-label="${esc(iso + ': ' + label)}"><span class="num">${d}</span><span class="hn">${esc(label)}</span>${r.noAddr && !r.past ? '<span class="noaddr" title="no address yet"></span>' : ''}</button>`;
  }
  return `<div class="cal">
    <div class="nav"><button class="btn sm ghost icon" data-act="calnav" data-dir="-1" ${ym <= min ? 'disabled' : ''} aria-label="Previous month">‹</button><h3>${MONL[m - 1]} ${y}</h3><button class="btn sm ghost icon" data-act="calnav" data-dir="1" ${ym >= max ? 'disabled' : ''} aria-label="Next month">›</button></div>
    <div class="grid" style="grid-template-columns:${cols}">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('')}${cells}</div>
    <div class="legend"><span><i style="background:var(--accent-soft)"></i>at a home</span><span><i style="background:var(--info-soft)"></i>event</span><span><i style="background:var(--surface-3)"></i>no meeting</span><span><i style="background:var(--warn);border-radius:50%;width:7px;height:7px"></i>no address yet</span></div>
  </div>`;
}
