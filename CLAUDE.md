# tune-in

Spectrum-guessing party game (own name, cards and look): pass-the-phone or
online rooms. Cloudflare Worker serving `public/` + one Durable Object per room.
Deploys from `main` via Cloudflare Workers Builds. No secrets.

- `public/logic.js` — all rules (scoring, steals, catch-up, win/sudden death, co-op). Pure; tested by `node test.mjs`.
- `public/app.js` — screens, dial, custom cards (localStorage), online sync. The whole game state is one
  JSON object; online, every change sends the full state and the room relays it (last write wins).
  `clean()` is the trust boundary for incoming state — keep it when adding fields.
- `public/cards.js` — built-in deck. Write original pairs; don't copy another game's card list.
- `public/sw.js` — offline cache (stale-while-revalidate: a push shows up on the *second* open). Add new files to `FILES`.
- `worker.js` — relay: stores the latest state per room, forwards to others, wipes rooms idle a week.

Test: `node test.mjs`, and for online changes `npx wrangler dev` + two browser sessions.
Finished work lands on `main` (Kurt's solo repo) — that deploys it.
