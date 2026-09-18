# Bible Study

Phone-first PWA for leading a weekly Bible study: roster, week-by-week calendar, attendance, and a hosting rotation that plans the season ahead and re-plans itself when someone can't host.

- `index.html`, `css/`, `js/` — the app (no build step). `js/rotation.js` is the pure generator.
- `sw.js`, `manifest.webmanifest`, `icons/` — offline shell + home-screen install.
- `tools/test.mjs` — generator tests (`node tools/test.mjs`).
- `tools/smoke.mjs` — drives the app in a phone-sized headless Chrome (`node tools/smoke.mjs <url> <token>`).
- `tools/make-icons.mjs` — renders `tools/icon.html` to the PNG icons.
- `docs/superpowers/specs/` — design spec.

Data lives in the browser (localStorage) and is mirrored to a private Cloudflare Worker + KV (`bible-study-sync`, separate repo) behind a token entered once per device. No names or addresses are in this repo.

Local: `python -m http.server 8124` then open `http://127.0.0.1:8124/index.html`.
