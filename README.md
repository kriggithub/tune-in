# Tune In

A party game about reading each other's minds. One player sees a hidden target
on a dial and gives a clue for where it sits between two opposites
("Light ↔ Heavy"); their team turns the dial to find it. Two teams (first to 10)
or co-op.

- **On one phone:** pass it around.
- **Online:** tap *Play online*, share the 4-letter code or link; everyone plays
  on their own phone or browser and moves sync live.
- **Decks:** *Classic* (the 130 built-in cards) is open to everyone. Every other
  deck lives in the *Private* folder, which needs the folder password; a private
  deck can also have its own password. Without them a private deck can't be
  listed, read, copied or changed, online games playing it need the same
  passwords to join, and wrong guesses are limited to 10 an hour.
- **Each round:** the card is picked first (swap, rewrite, remove or write a new
  one); the target only appears once someone taps *I'm the psychic*.
- **Mid-game:** the psychic can tap the card to rewrite it (saved as a new card)
  or ✕ to remove it; the *Cards* button adds or removes cards. All of it saves
  to the deck being played.

**Install on a phone:** open the site → Share → **Add to Home Screen**.

## Hosting

One Cloudflare Worker (free plan) serves `public/`, relays online games through
a Durable Object per room, and keeps the deck library in one more Durable Object
(`worker.js`, `wrangler.jsonc`). Deploys from
`main` via Cloudflare Workers Builds (the repo is connected in the Cloudflare
dashboard), so pushing is deploying.

## Deploy (one time)

Cloudflare dashboard → Workers & Pages → Create → Import a repository →
`kriggithub/tune-in`. Keep the name `tune-in` (it must match `wrangler.jsonc`), no
build command, deploy command `npx wrangler deploy`. After that every push to
`main` deploys.

## Develop

    npx wrangler dev        # http://localhost:8787, online rooms included
    node test.mjs           # scoring rules

Plain HTML/JS, no build step.
