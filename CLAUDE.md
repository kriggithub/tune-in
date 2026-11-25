# tune-in

Pass-the-phone spectrum-guessing party game (own name, cards and look). Static
PWA on GitHub Pages (branch `main`, root). No backend, no secrets, no build.

- `logic.js` — all rules (scoring, steals, catch-up, win/sudden death, co-op). Pure; tested by `node test.mjs`.
- `app.js` — screens + dial. Game state saves to localStorage so a reload resumes mid-round.
- `cards.js` — the deck. Write original pairs; don't copy another game's card list.
- `sw.js` — offline cache (stale-while-revalidate: a push shows up on the *second* open). Add new files to its `FILES`.

Rules: run `node test.mjs` after touching `logic.js`. Finished work lands on `main` (Kurt's solo repo).
