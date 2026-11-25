# Tune In

A party game about reading each other's minds. One player sees a hidden target
on a dial and gives a clue for where it sits between two opposites
("Light ↔ Heavy"); their team turns the dial to find it. Two teams (first to 10)
or co-op.

- **On one phone:** pass it around.
- **Online:** tap *Play online*, share the 4-letter code or link; everyone plays
  on their own phone or browser and moves sync live.
- **Your own cards:** *Cards* on the menu: add cards, remove built-ins you don't like
  (or tap *Don't show this card again* after a round). Online, everyone's custom cards and removals are
  added to the room.

**Install on a phone:** open the site → Share → **Add to Home Screen**.

## Hosting

One Cloudflare Worker (free plan) serves `public/` and relays online games
through a Durable Object per room (`worker.js`, `wrangler.jsonc`). Deploys from
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
