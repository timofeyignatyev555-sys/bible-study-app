# Group link + simpler hosting — design (2026-10-02)

Builds on `2026-09-18-bible-study-app-design.md`. Tim's asks, in his words: the app is hard to navigate; share a link with the group that only shows hosting + the calendar; members own their hosting (if they can't, they find someone and record it) and add their own address; their changes sync to Tim, Tim's calendar changes show to them; adding a person drops them into the hosting line automatically; simplify Hosting and This Week; show sibling households as "Anna & Maria (Smith)".

Tim said "build and proceed", so this went straight from spec to build; open questions are listed at the end.

## 1. Group page (members)

- URL: `…/bible-study-app/group/?k=<groupKey>`. Query string, not hash, and no manifest, so "Add to Home Screen" on iPhone keeps the key in the saved URL. Key is also kept in localStorage.
- First open: "Who are you?" — pick your name (or "Just looking"). Stored on the device, changeable. Not real auth: it only decides which card is "yours" and is written into the change log.
- Screen, top to bottom:
  1. **Your turn** card (if you're in a household): your next hosting date or "not scheduled yet, N ahead of you"; your address (edit + save); "Can't host that week?" — find someone, then record it: pick who takes it → confirm.
  2. **This week**: date, time, host, address (Maps link), event name/topic.
  3. **Schedule**: every meeting this season by month: date, host / place, address, event name. Off weeks show "No meeting". Past weeks collapsed.
  4. **Next in line**: households not scheduled this season, in order.
- View only for everything else. Refreshes on open, on focus, and every 2 min while visible.
- Members never see phones, notes, attendance, leaders' notes, or rotation internals.

## 2. Worker additions (`bible-study-sync`)

- Group key lives in KV (`groupKey`), not a wrangler secret, so Tim can reset the link from the app.
- `GET /admin/group-key`, `POST /admin/group-key/reset` — admin token. Creates the key on first call.
- `GET /group` — `X-Group-Key`. Returns a projection: group name, today (America/Chicago), households (id, label, address, status, until, first names), people (id, name, householdId) for the picker, meetings (date, time, status, kind, title, host id, location, topic, pinned), next-in-line, last 10 log entries.
- `POST /group/act` — `X-Group-Key`. Actions, applied to the stored state server-side, then re-planned with the shared `plan()` and saved with a new `updatedAt`:
  - `address {householdId, address, by}` — max 200 chars.
  - `swap {meetingId, toHouseholdId, by}` — same rule as Tim's "Someone else hosts" (below).
- Every member action appends `{id, at, by, text}` to `state.log` (cap 100).
- CORS: add `POST` and `X-Group-Key`.

## 3. Sync without losing edits

Today a PUT with a newer `updatedAt` overwrites the stored copy, so a member's change made while Tim had unsynced edits would be lost. Fix:

- The app keeps `bs.base` = the last server copy it agreed with. PUT sends `base: base.updatedAt`.
- Worker: if the stored `updatedAt` ≠ `base` → 409 with the stored copy (old rule kept when `base` is absent).
- On 409 or on a pull that finds the server changed while the device also changed: `merge3(base, local, server)` — per entity (people, households, meetings by id; settings and rotation as objects; log = union by id), per field: a field the device changed wins, otherwise take the server's. Then re-plan and push.

## 4. Shared rules (`js/rotation.js`, used by app + worker)

- `householdLabel(state, h)`: 2+ active members → first names joined with " & " + ` (Surname)`; else the household name. Surname = household name when it is one word, else the last word of the first member's name.
- `reassignHost(state, meetingId, toHouseholdId, today)`: the "someone else hosts" rule.
  - If the new household already has a future date this season → **trade**: each pinned to the other's date.
  - Otherwise → the new household is pinned to this date; the original host takes the next open week (same as "can't host").
  - Rejects: past meeting, meeting off / at another place, same household, unknown household, a `never` household.

## 5. Tim's app

- **Labels** everywhere use `householdLabel`. One-time data fix (run from the private sync repo): one sibling household renamed to its surname and a first-name-only person given the surname.
- **This Week**: hero = when (Tonight / This Friday / Next meeting), host, address, time, topic; two buttons: **Attendance** and **Change this week** (opens the week sheet), plus a small "Copy for group chat". Then "Next 4 weeks" (tap → week sheet), then "From the group" (member changes, last 14 days). Stats row removed.
- **Week sheet** (one sheet for a week, used by This Week, Hosting and Calendar host rows): host + address, then plain actions: Someone else hosts (one list; it says "trade with Nov 20" for scheduled people), Can't host → they take next week, Back to automatic (when pinned), No meeting this week / Meeting is on, Edit details.
- **Hosting**: header with **Share group link**. "Schedule" = every upcoming week (date, host, address or "needs address" chip); tap → week sheet. "Next in line" = who comes after the season, numbered. "Not hosting right now" = unavailable / never. "Already hosted" collapsed. Tap any household → household sheet, which now also has "Move earlier / later in line". Queue arrows and the stats row are gone; Shuffle moves to the bottom of "Next in line".
- **Undo / Redo** move to the header so they work from every tab.
- **Add person**: name, phone, "Lives with" (someone already in the group, or nobody), address when they're their own household, and an "Add several" mode (one name per line). After saving, the toast says where they landed: "hosts Dec 18" or "in line, #3 after the season".
- **Settings**: "Group link" card — copy, share, reset.

## Testing

- `tools/test.mjs`: label rule, `reassignHost` (trade, cover, rejections), `merge3` (both sides edit different fields, same field, adds, deletes, log union).
- Worker run locally with `wrangler dev` + both pages on localhost (`bs.worker` pref overrides the worker URL) for the end-to-end flow before deploy.
- After deploy: drive the live app + live group page in a phone-sized browser; record a member change and see it in Tim's app, and the reverse.

## Open questions (asked after the build)

- Phones on the group page so members can reach each other?
- Should members be able to say "unavailable until" themselves, or stays Tim-only?
