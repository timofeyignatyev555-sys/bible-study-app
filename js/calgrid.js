// Month calendar shared by the leader app and the group page. Pure: plain meeting rows in, HTML out.
// Both pages build the rows from the same synced data as their lists, so a swap, a new person or an
// address change shows up here the moment the list changes.
// rows: [{ id, date, status: 'on'|'off', kind: 'study'|'event', short, devo, past, noAddr }]
// birthdays: what birthdaysIn() returns for the month on screen
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BOOK = '<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.6C6.6 2.5 4.6 2.2 2 2.4v10c2.6-.2 4.6.1 6 1.2 1.4-1.1 3.4-1.4 6-1.2v-10c-2.6-.2-4.6.1-6 1.2zM8 3.6v10"/></svg>';
const CAKE = '<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 14h11V9a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 9zM2.5 10.6c1.4 1 2.4 1 3.7 0 1.2 1 2.4 1 3.6 0 1.3 1 2.3 1 3.7 0M8 7.5V4.6"/><path class="flame" d="M8 1.2c.7.9 1 1.4 1 2a1 1 0 0 1-2 0c0-.6.3-1.1 1-2z"/></svg>';

// "Anna & Ben (Reed)" -> "Reed", "Sara Cole" -> "Sara": what fits in a calendar cell.
export function shortName(label) {
  const m = /\(([^)]+)\)\s*$/.exec(label || '');
  return m ? m[1] : (label || '').trim().split(/\s+/)[0];
}
// One person: "Sam Reed" -> "Sam", but "Dan Bell" -> "Dan B." when someone else is also a Dan.
export function personShort(name, names) {
  const words = String(name ?? '').trim().split(/\s+/);
  const first = words[0];
  const shared = names.filter(n => String(n ?? '').trim().split(/\s+/)[0].toLowerCase() === first.toLowerCase()).length > 1;
  return shared && words.length > 1 ? `${first} ${words[words.length - 1][0]}.` : first;
}
export function fmtBirthday(md) {
  if (!md) return '';
  const [m, d] = md.split('-').map(Number);
  return `${MON[m - 1]} ${d}`;
}
// Birthdays falling in a month, by day. Feb 29 shows on Feb 28 in other years.
export function birthdaysIn(ym, people) {
  const [y, mo] = ym.split('-').map(Number);
  const leap = new Date(y, 1, 29).getMonth() === 1;
  const names = people.map(p => p.name);
  return people
    .filter(p => p.birthday && Number(p.birthday.slice(0, 2)) === mo)
    .map(p => {
      const dd = p.birthday === '02-29' && !leap ? '28' : p.birthday.slice(3);
      return { id: p.id, name: p.name, short: personShort(p.name, names), householdId: p.householdId, date: `${ym}-${dd}` };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
}
// A long season folds away once everyone on it has appeared, so whatever sits below the list stays within reach.
// ids: who has each upcoming week, in date order. Returns how many weeks to show (0 when nobody is scheduled).
export function foldPoint(ids) {
  const seen = new Set();
  let cut = 0;
  ids.forEach((id, i) => { if (id && !seen.has(id)) { seen.add(id); cut = i + 1; } });
  return cut;
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

export function calendarHTML(ym, rows, today, birthdays = []) {
  const [y, m] = ym.split('-').map(Number);
  const lead = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const byDate = new Map(rows.map(r => [r.date, r]));
  const months = rows.map(r => r.date.slice(0, 7));
  const thisMonth = today.slice(0, 7);
  // birthdays run all year while meetings stop at the season end, so the calendar always pages a year ahead
  const min = months.reduce((a, b) => (a < b ? a : b), thisMonth), max = months.reduce((a, b) => (a > b ? a : b), shiftMonth(thisMonth, 12));
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
    const bds = birthdays.filter(b => b.date === iso);
    const bdHTML = bds.length ? `<span class="bd">${CAKE}<span class="nm">${esc(bds[0].short)}${bds.length > 1 ? ' +' + (bds.length - 1) : ''}</span></span>` : '';
    const bdLabel = bds.length ? ', birthday: ' + bds.map(b => b.name).join(', ') : '';
    const cls = ['day', iso === today ? 'today' : ''];
    if (!r) {
      cells += bds.length
        ? `<button class="${[...cls, 'bday'].join(' ')}" data-act="calbday" data-date="${iso}" aria-label="${esc(iso + bdLabel)}"><span class="num">${d}</span>${bdHTML}</button>`
        : `<div class="${cls.join(' ')}"><span class="num">${d}</span></div>`;
      continue;
    }
    cls.push('meet', r.status === 'off' ? 'off' : (r.kind === 'event' ? 'event' : ''), r.past ? 'past' : '');
    const label = r.status === 'off' ? 'No meeting' : r.short;
    const devo = r.status === 'off' ? '' : (r.devo || '');
    cells += `<button class="${cls.join(' ')}" data-act="calday" data-id="${esc(r.id)}" aria-label="${esc(iso + ': ' + label + (devo ? ', devotional: ' + devo : '') + bdLabel)}"><span class="num">${d}</span><span class="hn">${esc(label)}</span>${devo ? `<span class="dv">${BOOK}<span class="nm">${esc(devo)}</span></span>` : ''}${bdHTML}${r.noAddr && !r.past ? '<span class="noaddr" title="no address yet"></span>' : ''}</button>`;
  }
  return `<div class="cal">
    <div class="nav"><button class="btn sm ghost icon" data-act="calnav" data-dir="-1" ${ym <= min ? 'disabled' : ''} aria-label="Previous month">‹</button><h3>${MONL[m - 1]} ${y}</h3><button class="btn sm ghost icon" data-act="calnav" data-dir="1" ${ym >= max ? 'disabled' : ''} aria-label="Next month">›</button></div>
    <div class="grid" style="grid-template-columns:${cols}">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('')}${cells}</div>
    <div class="legend"><span><i style="background:var(--accent-soft)"></i>at a home</span><span><i style="background:var(--info-soft)"></i>event</span><span><i style="background:var(--surface-3)"></i>no meeting</span><span><i style="background:var(--warn);border-radius:50%;width:7px;height:7px"></i>no address yet</span><span class="lg-dv">${BOOK}devotional</span><span class="lg-bd">${CAKE}birthday</span></div>
  </div>`;
}
