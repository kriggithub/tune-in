# tune-in

Spectrum-guessing party game (own name, cards and look): pass-the-phone or
online rooms, shared deck library. Cloudflare Worker serving `public/` + Durable Objects
(one per room, one `Library` for all decks).
Deploys from `main` via Cloudflare Workers Builds. No secrets.

- `public/logic.js` — all rules (scoring, steals, catch-up, win/sudden death, co-op). Pure; tested by `node test.mjs`.
- `public/app.js` — screens, dial, decks, online sync. The whole game state is one
  JSON object; online, every change sends the full state and the room relays it (last write wins).
  `clean()` is the trust boundary for incoming state — keep it when adding fields.
- `public/cards.js` — built-in deck. Write original pairs; don't copy another game's card list.
- `public/sw.js` — offline cache (stale-while-revalidate: a push shows up on the *second* open). Add new files to `FILES`.
- `worker.js` — room relay (latest state per room, forwards to others, wipes rooms idle a week) and the
  deck API `/api/decks[/id]` (GET list/deck, POST create or `{op: add|remove|rename}`, DELETE). No auth by
  Kurt's choice; inputs are clipped there. Deck edits queue on the phone (`tunein.ops`) so offline edits land later.
- `public/cards.js` also seeds the `Classic` deck on the server once; editing it later doesn't change Classic.

Test: `node test.mjs`, and for online changes `npx wrangler dev` + two browser sessions.
Finished work lands on `main` (Kurt's solo repo) — that deploys it.
