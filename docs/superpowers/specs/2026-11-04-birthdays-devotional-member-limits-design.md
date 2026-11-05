# Birthdays, Friday devotional, member limits (2026-11-04)

Builds on `2026-10-02-group-link-and-simpler-hosting-design.md`. The leader asked for three things, all edited in the admin app and visible to members:

1. Everyone's birthday on the calendar and inside each name.
2. Members limited to their own things; anything that is the admin's job stays admin only.
3. A "Men" category in the admin app, one man scheduled for the devotional every Friday, shown on the members' calendar, with the same move / swap / hold abilities hosts have.

He asked for it to be built without a round of questions, so the calls below are the builder's and are listed for him to overrule. No names or birthdays go in this repo; the roster data is applied by a script in the private `bible-study-sync` repo.

## Birthdays

- `person.birthday = 'MM-DD'`, no year. Edited only in the admin person sheet (month + day selects).
- Admin: People rows show it under the name. Members: inside each name's sheet.
- Calendar (both pages): a cake mark and short name in the day cell, a "Birthdays in <month>" list under the grid, and the day sheet names them. The calendar now pages 12 months ahead, because birthdays run all year while meetings stop at the season end. Feb 29 shows on Feb 28 in other years.

## Friday devotional

- `person.gender` is `'m' | 'f' | unset`, admin only and never sent to members. Active men form the line.
- Own line, separate from hosting: `state.devotion.order`. Hosting holds do not affect it, so a man who cannot host can still give a devotional.
- Per meeting: `devoId`, `devoMode` (`auto | pinned`), `devoSkipped`, `devoOff`. Per man: `devoStatus` (`available | unavailable | never`), `devoUntil`.
- `plan()` assigns devotionals with the same rules as hosts: past weeks are frozen and replayed, pinned weeks stay, a skipped man takes the next week, off weeks consume no turn. A trade or cover works like `reassignHost`.
- A week has a devotional when the meeting is on, not switched off, and is a regular study or falls on the meeting weekday. A one-off Saturday party has none.
- A long schedule folds "Later weeks" once everyone on it has appeared, on the group page, the hosting list and the Men view, so what sits below stays within reach. The Men view always has a plain list of every man.
- Extending the season gives later men a Friday and adds hosting weeks with it. Shrinking it drops only untouched weeks (`untouchedWeek`); a week with a hand-set devotional stays, same as one with a hand-set host.
- Admin: fourth view "Men" laid out like the Hosting list (schedule, next in line, on hold, already gave it, not marked yet). A week sheet offers someone else, can't do it, back to the normal order, no devotional this week. A man's sheet offers hold / never and earlier / later in the line.
- Members: the "this week" card and the calendar show only who has the devotional that Friday. The men's list and line are not in the page data at all. A man taps his name to swap or put himself on hold, same as hosting; his own sheet fetches his status and the men who can take a week (`POST /group/devo`, signed in, by name, never the line). A household with no man gets no list of men. The hosting list stays about hosting.

## Member limits

The group link is shared, so until now anyone holding it could change anyone's address or phone, put anyone on hold or take them off, and move anyone's week. That is the admin's power, so:

- Looking stays open: the link shows everything it showed, with no sign-in.
- To change anything a member taps their own name, taps "This is me", and types a 4-digit PIN they picked the first time. The device remembers. Another name on that device is read-only.
- Enforced by the worker, not the page. `/group/act` needs `{ me: { id, token } }`, checks it against `pin:<personId>` in KV, and only acts on the member's own household. `by` in the log comes from the server. Swaps can only give away your own week, and only to someone who is not on hold.
- Household is the unit: siblings can act for each other, including each man's devotional.
- Five wrong PINs lock that name for an hour. The admin can reset a PIN from the person sheet (`GET /admin/pin`, `POST /admin/pin/reset`).
- Keys are `pin:<id>` (written only when first set, so a failed guess can never overwrite it or bring back one that was reset), `pinfails:<id>` and `pinlock:<id>` (expires by itself; a wrong try never touches it). KV is not atomic, so a burst of parallel guesses could undercount wrong tries; the `PIN_LIMIT` rate-limit binding (5 attempts a minute per name) caps how fast guesses can arrive at all.
- **Known tradeoff, the leader's call:** whoever taps a name first sets its PIN, so someone holding the link could claim a name that has no PIN yet. Every first claim is visible to the leader only: the `pin:<id>` record is written before the token goes out, `GET /admin/pins` lists them, and the admin app merges them into Recent changes for display. They are never written to the shared document, because a request with no PIN must not rewrite it from a possibly stale copy, and a full activity log cannot push one out. Everything done under a name is logged, and a reset gives the name back. The airtight alternative is a one-time code per person, sent by the leader, which means about 30 messages. A 4-digit PIN is a fence for a group of friends, not bank security.
- **Accepted, not fixed:** the limiter is per Cloudflare location and KV is eventually consistent, so someone with the link, proxies in many cities and real motive could still eventually guess a PIN. The prize is changing one friend's details, logged and reversible, so a Durable Object and a slow KDF (which cannot save a 4-digit space anyway) are not worth it here. Member saves (`/group/act`) have been last-write-wins since 2026-10-02: two saves in the same moment can lose one. A Durable Object is the fix if that ever bites.
- Admin only, with no member path at all: people, birthdays, men's list and line order, events, cancelling weeks, attendance, notes, settings, "never" statuses, the group link.

## Sync

`normalize` fills the new fields. `merge3` blanks auto devotionals like auto hosts and merges `state.devotion`. Older clients keep unknown fields, so an old app cannot wipe them.

## Testing

- `tools/test.mjs`: devotional planning, trades, holds, merge, calendar helpers.
- `bible-study-sync/tools/test-group.mjs`: PIN flow, ownership rejections, and what the projection hides.
- `tools/e2e-local.mjs`: both pages against local `wrangler dev` with a copy of the real state.
- After deploy: live reads of both pages; write attempts without a PIN must be refused and change nothing.
