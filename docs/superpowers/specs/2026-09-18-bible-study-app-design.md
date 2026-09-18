# Bible Study app — design (2026-09-18)

Tim leads a weekly Friday Bible study (30 people). He wants a phone-first, synced tracker for the roster, the week-by-week calendar, attendance, and a hosting rotation that plans the whole season ahead and re-plans itself when someone can't host.

## Decisions (from the brainstorm)

- Host unit = sibling household. Pairs: Anna + David Bak, Timofey + Arina Ignatyev, Diana Maltseva + Karolina, Lidia + Tavifa Loghinova, Elijah + Samuel Lelyukh. Liza and Alex Dumyan are cousins, separate. Everyone else is a household of one. Attendance is always per person.
- Meets every Friday, default 7:00 PM, season Sep 18 → Dec 31, 2026 (extendable in Settings).
- Rotation: David Rachkovskiy hosts tonight (Sep 18). After that a one-time random order, editable. The plan is generated for the whole season; skips shift people forward, they do not go to the back.
- "Can't host this week": next household takes the date, the skipped household gets the next Friday, everyone after shifts one week.
- "Unavailable until <date>" / "unavailable indefinitely" (Tim: remodeling + moving) / "never hosts": generator skips them, they re-enter at the first open Friday once eligible.
- Off weeks and events at a non-household location consume nobody's turn.
- Per meeting: topic/passage, who led, notes, attendance. No guest headcount.
- Devices: phone + laptop, synced through a Cloudflare Worker + KV, private to Tim. Name: "Bible Study".

## Stack

Static PWA (vanilla HTML/CSS/JS ES modules, no build) on GitHub Pages at `timofeyignatyev555-sys/bible-study-app`, plus a Cloudflare Worker `bible-study-sync` with one KV key. Same shape as The System.

Privacy: the public repo contains no names or addresses. The seed roster is written straight to KV. Each device gets the token once via `https://…/bible-study-app/#token=…` (stored in localStorage, stripped from the URL). Without a token the app shows a connect screen.

## Data model (one JSON document)

```
state = {
  version: 1, updatedAt: ISO,
  settings: { name, weekday: 5, defaultTime: '19:00', seasonStart: 'YYYY-MM-DD', seasonEnd: 'YYYY-MM-DD' },
  people:     [{ id, name, householdId, phone, notes, active, createdAt }],
  households: [{ id, name, address, hostStatus: 'available'|'unavailable'|'never', unavailableUntil: null|'YYYY-MM-DD', note }],
  rotation:   { order: [householdId, ...] },
  meetings:   [{ id, date, status: 'on'|'off', kind: 'study'|'event', title, time,
                 hostHouseholdId, hostMode: 'auto'|'pinned', location: null|{ name, address },
                 topic, leaderId, notes, attendance: { personId: true }, skipped: [householdId] }]
}
```

Derived, never stored: hosted count, last hosted, next planned, attendance %.

## Generator (`js/rotation.js`, pure)

`plan(state, today)` returns new meetings + the current queue. It never mutates input.

1. Sort meetings by date. A meeting is **past** when `date < today` or it has any attendance recorded. Past meetings are frozen.
2. Queue = `rotation.order` (existing households only) + any household missing from it (by name). Households with no active people are dropped.
3. Replay: for each past meeting that counts as hosting (`status on`, has host, no custom location) move that host to the back.
4. Pinned future hosts are moved to the back first, in date order, so a volunteer for Dec 18 is not also auto-assigned October.
5. For each future meeting in date order:
   - `status off` → host cleared, queue untouched.
   - custom location → host null, queue untouched.
   - pinned → keep host.
   - auto → first **eligible** household in the queue takes it and moves to the back; none eligible → host null ("no host available").
6. Eligible(h, date, meeting): `hostStatus` not `never`; if `unavailable` then `unavailableUntil` is set and `date >= unavailableUntil`; `h.id` not in `meeting.skipped`.

Actions map onto the model: Can't host → push host id to `meeting.skipped`, unpin, re-plan. Change host → `hostMode: 'pinned'`. Cancel week → `status: 'off'`. Opt out → household `hostStatus/unavailableUntil`. Reorder → `rotation.order`. Re-plan runs after every change; there is no regenerate button.

## Screens (bottom tabs, phone-first, dark by default)

1. **This Week** — next meeting card (date, time, host, address → Maps link, topic, leader), actions: Attendance, Can't host, Change host, Cancel week, Edit. "Copy summary" puts one line on the clipboard for the group chat. Then the next 4 weeks.
2. **Calendar** — every meeting to season end; status, host, topic; tap to edit; toggle On/Off; "+ Event" adds any date.
3. **People** — grouped by household with attendance % (season); tap to edit name/phone/household/notes/active; add person; remove.
4. **Hosting** — the queue in order with ▲▼ / top / shuffle-remaining; per household: address, status (available / unavailable until / indefinite / never), hosted count, last, next.
5. **Settings** — name, day, default time, season start/end (extends the calendar), sync (token, status, last sync, pull now), export / import JSON, reset.

## Sync (`js/sync.js` + worker)

- Local first: every change saves to localStorage, then a debounced `PUT /state {state}`.
- On open and on tab focus: `GET /state`; adopt the server copy if its `updatedAt` is newer.
- Worker rejects a PUT whose `updatedAt` is older than the stored copy (409 + server state); the client adopts the newer copy and toasts "Updated from your other device".
- Auth `X-App-Token`; CORS limited to the github.io origin and localhost.

## Deploy + verification

- Worker: `wrangler deploy`, secret `APP_TOKEN`, KV binding `STATE`. Seed pushed with `tools/seed.mjs`.
- App: Pages from `main`. `tools/test.mjs` covers the generator rules; `tools/smoke.mjs` drives the deployed app in a 390×844 headless Chrome with the token, exercises every tab and the skip / pin / opt-out flows, and screenshots each screen.
