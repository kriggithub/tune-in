// Serves the app (public/), relays online games, and keeps the shared deck library.
// Rooms: one Durable Object per 4-letter code; keeps the latest game state and forwards updates.
// Library: one Durable Object holding every deck; no login, anyone with the link can edit.
import { DurableObject } from 'cloudflare:workers';
import { CARDS } from './public/cards.js';

const WEEK = 7 * 24 * 60 * 60 * 1000;

export class Room extends DurableObject {
  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send((await this.ctx.storage.get('s')) ?? 'null');
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 200_000) return;
    await this.ctx.storage.put('s', msg);
    await this.ctx.storage.setAlarm(Date.now() + WEEK); // rooms idle for a week are wiped
    for (const other of this.ctx.getWebSockets()) if (other !== ws) other.send(msg);
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

const clip = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const key = c => c.join('|');
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export class Library extends DurableObject {
  async fetch(req) {
    const s = this.ctx.storage, id = new URL(req.url).pathname.split('/')[3] || '';
    if (!(await s.get('seeded'))) await s.put({ 'deck:classic': { id: 'classic', name: 'Classic', cards: CARDS }, seeded: true });
    let body = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); } }

    if (!id) {
      const all = await s.list({ prefix: 'deck:' });
      if (req.method === 'GET') return json([...all.values()]
        .sort((a, b) => (b.id === 'classic') - (a.id === 'classic') || a.name.localeCompare(b.name))
        .map(d => ({ id: d.id, name: d.name, count: d.cards.length })));
      if (req.method === 'POST') { // create: { name, from: 'builtin' | deck id | '' }
        const name = clip(body.name, 30);
        if (!name) return json({ error: 'name' }, 400);
        if (all.size >= 100) return json({ error: 'too many decks' }, 400);
        const from = body.from === 'builtin' ? CARDS : (await s.get('deck:' + clip(body.from, 20)))?.cards || [];
        const d = { id: crypto.randomUUID().slice(0, 8), name, cards: from };
        await s.put('deck:' + d.id, d);
        return json(d);
      }
    }
    const d = await s.get('deck:' + id);
    if (!d) return json({ error: 'not found' }, 404);
    if (req.method === 'GET') return json(d);
    if (req.method === 'DELETE') { await s.delete('deck:' + id); return json({ ok: true }); }
    if (req.method === 'POST') { // edit: { op: 'add' | 'remove', card: [l, r] } or { op: 'rename', name }
      const c = Array.isArray(body.card) && body.card.length === 2 ? body.card.map(t => clip(t, 40)) : null;
      const i = c ? d.cards.findIndex(x => key(x) === key(c)) : -1;
      if (body.op === 'add' && c && c[0] && c[1] && i < 0 && d.cards.length < 2000) d.cards.push(c);
      else if (body.op === 'remove' && i >= 0) d.cards.splice(i, 1);
      else if (body.op === 'rename' && clip(body.name, 30)) d.name = clip(body.name, 30);
      await s.put('deck:' + id, d);
      return json(d);
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
