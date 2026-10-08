# Bible Study

Phone-first PWA for leading a weekly Bible study: roster, week-by-week calendar, attendance, and a hosting rotation that plans the season ahead and re-plans itself when someone can't host. Plus a group page members open from a shared link: the hosting schedule and calendar, their own address, and recording a swap.

- `index.html`, `css/`, `js/`: the leader app (no build step). `js/rotation.js` is the pure generator, shared with the sync worker.
- `group/`, `js/group.js`: the members' page (`group/?k=<group key>`). No manifest on purpose, so Add to Home Screen keeps the key.
- `sw.js`, `manifest.webmanifest`, `icons/`: offline shell + home-screen install. Bump `VERSION` in `sw.js` and `js/app.js` on every deploy.
- `tools/test.mjs`: generator, swap and merge tests (`node tools/test.mjs`).
- `tools/e2e-local.mjs`: drives the leader app and the group page together in a phone-sized headless Chrome against a local `wrangler dev` (never the live worker; it writes).
- `tools/make-icons.mjs`: renders the PNG icons (`node tools/make-icons.mjs [admin|members]`). The leader app is "Bible Admin" with a gold tile + gear (`tools/icon-admin.html`); the group page keeps "Bible Study" and the dark tile (`tools/icon.html`).
- `docs/superpowers/specs/`: design specs.

Data lives in the browser (localStorage) and is mirrored to a private Cloudflare Worker + KV (`bible-study-sync`, separate repo) behind a token entered once per device. Members reach the same copy through the group key, which only exposes hosting + calendar. Pushes carry the server copy they were built on, and the app merges field by field when a member changed something in between. No names or addresses are in this repo.

Local: `python -m http.server 8124`, then open `http://127.0.0.1:8124/index.html`. Point the app at a local worker with `localStorage['bs.worker'] = 'http://localhost:8787'`.
