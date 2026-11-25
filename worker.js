// Serves the app (public/), relays online games, and keeps the shared deck library.
// Rooms: one Durable Object per 4-letter code; keeps the latest game state and forwards updates.
// Library: one Durable Object holding every deck. Open decks: anyone with the link can read/edit.
// A deck with a password can't be read, copied or changed without it (wrong guesses are rate-limited),
// and an online room playing it needs the same password to join.
import { DurableObject } from 'cloudflare:workers';
import { CARDS } from './public/cards.js';

const WEEK = 7 * 24 * 60 * 60 * 1000, HOUR = 60 * 60 * 1000, MAX_FAILS = 10;
const enc = new TextEncoder();
const hash = async (salt, pin) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${pin}`)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');
const newLock = async pin => { const salt = crypto.randomUUID(); return { salt, hash: await hash(salt, pin) }; };

// wrong-password counter: MAX_FAILS per hour per key (an IP, or a room)
async function tooMany(storage, k) { const f = await storage.get(k); return !!f && f.until > Date.now() && f.n >= MAX_FAILS; }
async function failed(storage, k) {
  const f = (await storage.get(k)) || { n: 0, until: 0 };
  if (f.until < Date.now()) { f.n = 0; f.until = Date.now() + HOUR; }
  f.n++; await storage.put(k, f);
}

export class Room extends DurableObject {
  async fetch(req) {
    const s = this.ctx.storage, q = new URL(req.url).searchParams, key = q.get('key') || '';
    let lock = await s.get('lock');
    // the host of a game with a password-protected deck locks the room with that password
    if (!lock && key && q.get('new') === '1') { lock = await newLock(key); await s.put('lock', lock); }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    if (lock && (await tooMany(s, 'fails') || (await hash(lock.salt, key)) !== lock.hash)) {
      await failed(s, 'fails');
      server.send('"locked"'); server.close(4001, 'locked');
    } else {
      server.serializeAttachment({ ok: true });
      server.send((await s.get('s')) ?? 'null');
    }
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, msg) {
    if (!ws.deserializeAttachment()?.ok || typeof msg !== 'string' || msg.length > 200_000) return;
    await this.ctx.storage.put('s', msg);
    await this.ctx.storage.setAlarm(Date.now() + WEEK); // rooms idle for a week are wiped
    for (const other of this.ctx.getWebSockets()) if (other !== ws && other.deserializeAttachment()?.ok) other.send(msg);
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

const clip = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const key = c => c.join('|');
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const pub = d => ({ id: d.id, name: d.name, cards: d.cards, locked: !!d.lock }); // never send the lock itself

export class Library extends DurableObject {
  // true if the deck is open or the request carries its password
  async unlocked(req, d) {
    if (!d?.lock) return true;
    const ip = 'fail:' + (req.headers.get('cf-connecting-ip') || 'unknown');
    if (await tooMany(this.ctx.storage, ip)) return false;
    let key = req.headers.get('x-deck-key') || '';
    try { key = decodeURIComponent(key); } catch {} // sent encoded: headers can't carry every character
    if ((await hash(d.lock.salt, key)) === d.lock.hash) return true;
    await failed(this.ctx.storage, ip);
    return false;
  }
  async fetch(req) {
    const s = this.ctx.storage, id = new URL(req.url).pathname.split('/')[3] || '';
    if (!(await s.get('seeded'))) await s.put({ 'deck:classic': { id: 'classic', name: 'Classic', cards: CARDS }, seeded: true });
    let body = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); } }

    if (!id) {
      const all = await s.list({ prefix: 'deck:' });
      if (req.method === 'GET') return json([...all.values()]
        .sort((a, b) => (b.id === 'classic') - (a.id === 'classic') || a.name.localeCompare(b.name))
        .map(d => ({ id: d.id, name: d.name, count: d.cards.length, locked: !!d.lock })));
      if (req.method === 'POST') { // create: { name, from: 'builtin' | deck id | '' }
        const name = clip(body.name, 30);
        if (!name) return json({ error: 'name' }, 400);
        if (all.size >= 100) return json({ error: 'too many decks' }, 400);
        const src = body.from && body.from !== 'builtin' ? await s.get('deck:' + clip(body.from, 20)) : null;
        if (!(await this.unlocked(req, src))) return json({ error: 'password' }, 401); // copying needs the source's password
        const d = { id: crypto.randomUUID().slice(0, 8), name, cards: body.from === 'builtin' ? CARDS : src?.cards || [] };
        await s.put('deck:' + d.id, d);
        return json(pub(d));
      }
    }
    const d = await s.get('deck:' + id);
    if (!d) return json({ error: 'not found' }, 404);
    if (!(await this.unlocked(req, d))) return json({ error: 'password' }, 401);
    if (req.method === 'GET') return json(pub(d));
    if (req.method === 'DELETE') { await s.delete('deck:' + id); return json({ ok: true }); }
    if (req.method === 'POST') { // edit: { op: 'add' | 'remove', card: [l, r] }, { op: 'rename', name }, { op: 'lock', pin }, { op: 'unlock' }
      const c = Array.isArray(body.card) && body.card.length === 2 ? body.card.map(t => clip(t, 40)) : null;
      const i = c ? d.cards.findIndex(x => key(x) === key(c)) : -1;
      if (body.op === 'add' && c && c[0] && c[1] && i < 0 && d.cards.length < 2000) d.cards.push(c);
      else if (body.op === 'remove' && i >= 0) d.cards.splice(i, 1);
      else if (body.op === 'rename' && clip(body.name, 30)) d.name = clip(body.name, 30);
      else if (body.op === 'lock' && clip(body.pin, 30)) d.lock = await newLock(clip(body.pin, 30));
      else if (body.op === 'unlock') delete d.lock;
      await s.put('deck:' + id, d);
      return json(pub(d));
    }
    return json({ error: 'method' }, 405);
  }
}

export default {
  fetch(req, env) {
    const path = new URL(req.url).pathname;
    const room = path.match(/^\/room\/([A-Z]{4})$/);
    if (room && req.headers.get('Upgrade') === 'websocket') return env.ROOM.get(env.ROOM.idFromName(room[1])).fetch(req);
    if (/^\/api\/decks(\/[\w-]{1,20})?$/.test(path)) return env.LIBRARY.get(env.LIBRARY.idFromName('library')).fetch(req);
    return env.ASSETS.fetch(req);
  },
};
